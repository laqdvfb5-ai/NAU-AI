import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  Module,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  Res,
  Inject,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  HttpException,
  type ExceptionFilter,
  type ArgumentsHost,
  Catch,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z, ZodError } from 'zod';
import { randomUUID } from 'node:crypto';
import { env, assertConfig } from './config.js';
import { Database } from './database.js';
import { AuthService } from './auth.js';
import { Budget, EvidenceProvider, ConfigurableLLM, ConfigurableEmbedding } from './providers.js';
import { KnowledgeService } from './knowledge.js';
import { IngestionService, validateSourceUrl } from './ingestion.js';
import { DisabledActionRegistry } from './actions.js';
import { ChatService } from './chat.js';
import type { RulePack } from '@nau/domain';
import { createStudentProvider } from './student-provider.js';
import { ApiPoolService, PooledLLM } from './api-pool.js';
import { ApiPoolController } from './api-pool-controller.js';
import { PoolError } from './api-pool-security.js';

assertConfig();
const db = new Database();
await db.initialize();
const students = await createStudentProvider(db);
const auth = new AuthService(db, students),
  budget = new Budget(db),
  apiPool = new ApiPoolService(db, budget),
  knowledge = new KnowledgeService(
    db,
    env.embedding !== 'none' ? new ConfigurableEmbedding(budget) : undefined,
  ),
  ingestion = new IngestionService(db),
  actions = new DisabledActionRegistry(db),
  chat = new ChatService(
    db,
    knowledge,
    new PooledLLM(
      apiPool,
      env.llm === 'evidence' ? new EvidenceProvider() : new ConfigurableLLM(budget),
    ),
    students,
  );
await actions.init();
await apiPool.refresh();
@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return response.end();
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : error instanceof ZodError || error instanceof PoolError
          ? 400
          : 500;
    const message =
      error instanceof ZodError
        ? 'Dữ liệu yêu cầu không hợp lệ.'
        : error instanceof HttpException || error instanceof PoolError
          ? error.message
          : 'Không xử lý được yêu cầu. Vui lòng thử lại.';
    if (status === 500)
      console.error('API error:', error instanceof Error ? error.message : 'unknown');
    response.status(status).json({
      statusCode: status,
      message,
      ...(error instanceof PoolError ? { code: error.code } : {}),
    });
  }
}
@Controller('api/v1')
class ApiController {
  constructor(@Inject('DB') private database: Database) {}
  @Get('health') async health() {
    await this.database.query('SELECT 1');
    await apiPool.refresh();
    return {
      status: 'ok',
      dataMode: env.synthetic ? 'synthetic' : 'real',
      llmProvider: apiPool.currentRouting.enabled ? 'pool' : env.llm,
      embeddingProvider: env.embedding,
      demoLogin: env.demo,
      demoPasswordPreset: env.demo && process.env.DEMO_PASSWORD === 'NauDemo2026!',
      retentionDays: env.retention,
      ssoConfigured: Boolean(process.env.OIDC_ISSUER && process.env.OIDC_MAPPING_FILE),
    };
  }
  @Get('auth/session') async session(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return { identity: (await auth.session(req, res)).identity };
  }
  @Post('auth/login') async login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const b = z
      .object({ username: z.string().min(1).max(60), password: z.string().min(1).max(200) })
      .strict()
      .parse(body);
    return { identity: await auth.login(req, res, b.username, b.password) };
  }
  @Post('auth/logout') async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await auth.logout(req, res);
    return { ok: true };
  }
  @Get('auth/oidc') async oidc(@Res() res: Response) {
    try {
      res.redirect(await auth.ssoStart(res));
    } catch {
      res.status(503).json({ message: 'SSO chưa được cấu hình hoặc không kết nối được.' });
    }
  }
  @Get('auth/oidc/callback') async callback(@Req() req: Request, @Res() res: Response) {
    await auth.ssoCallback(req, res);
    res.redirect(env.appUrl + '/student');
  }
  @Get('me') async me(@Req() req: Request) {
    const s = await auth.require(req, 'student');
    const student = await students.getStudent(s.identity.studentId!);
    if (!student) throw new NotFoundException('Chưa có hồ sơ sinh viên.');
    await db.audit(s.identity.accountId, 'read_profile');
    return student;
  }
  @Get('me/academics') async academics(@Req() req: Request) {
    const s = await auth.require(req, 'student');
    const student = await students.getStudent(s.identity.studentId!);
    if (!student) throw new NotFoundException();
    await db.audit(s.identity.accountId, 'read_academics');
    return { evaluations: await chat.evaluations(student) };
  }
  @Get('conversations') async conversations(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return chat.conversations(await auth.session(req, res));
  }
  @Get('conversations/:id') async conversation(@Param('id') id: string, @Req() req: Request) {
    return chat.history(z.uuid().parse(id), await auth.session(req));
  }
  @Delete('conversations/:id') async removeConversation(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const session = await auth.session(req);
    await chat.assertConversation(z.uuid().parse(id), session);
    await db.query('DELETE FROM conversations WHERE id=$1', [id]);
    return { ok: true };
  }
  @Post('chat') async respond(@Req() req: Request, @Res() res: Response, @Body() body: unknown) {
    const b = z
      .object({
        message: z.string().trim().min(1).max(2000),
        conversationId: z.uuid().optional(),
        embed: z.boolean().optional(),
      })
      .strict()
      .parse(body);
    const session = b.embed ? { hash: 'ephemeral', identity: null } : await auth.session(req, res);
    if (b.conversationId && !b.embed) await chat.assertConversation(b.conversationId, session);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    const send = (event: string, data: unknown) => {
      if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      if (!res.destroyed) res.write(': keepalive\n\n');
    }, 8000);
    try {
      const answer = await chat.answer(
        b.message,
        session,
        b.conversationId,
        b.embed,
        abort.signal,
        (delta) => send('delta', { text: delta }),
        (progress) => send('status', progress),
      );
      send('answer', answer);
      send('done', {});
    } catch (error) {
      send('error', {
        message:
          error instanceof HttpException
            ? error.message
            : 'Không thể trả lời lúc này. Vui lòng thử lại.',
      });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }
  @Post('feedback') async feedback(@Req() req: Request, @Body() body: unknown) {
    const b = z
      .object({
        conversationId: z.uuid(),
        messageId: z.uuid(),
        rating: z.union([z.literal(1), z.literal(-1)]),
        note: z.string().max(1000).default(''),
      })
      .strict()
      .parse(body);
    await chat.assertConversation(b.conversationId, await auth.session(req));
    const [message] = await db.query(
      "SELECT id FROM messages WHERE id=$1 AND conversation_id=$2 AND role='assistant'",
      [b.messageId, b.conversationId],
    );
    if (!message) throw new NotFoundException();
    await db.query(
      'INSERT INTO feedback(id,conversation_id,message_id,rating,note) VALUES($1,$2,$3,$4,$5) ON CONFLICT(conversation_id,message_id) DO UPDATE SET rating=excluded.rating,note=excluded.note',
      [randomUUID(), b.conversationId, b.messageId, b.rating, b.note],
    );
    return { ok: true };
  }
  @Get('sources') async sources() {
    return (await knowledge.sources()).map(({ pendingText, error, ...s }) => s);
  }
  @Get('actions') actionList() {
    return actions.list();
  }
  @Post('actions/:id/prepare') async prepare(@Param('id') id: string, @Req() req: Request) {
    return actions.prepare(id, (await auth.require(req)).identity);
  }
  @Post('actions/:id/execute') async execute(
    @Param('id') id: string,
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const b = z
      .object({ confirmation: z.string().max(200) })
      .strict()
      .parse(body);
    return actions.execute(id, (await auth.require(req)).identity, b.confirmation);
  }
  @Get('admin/stats') async stats(@Req() req: Request) {
    await auth.require(req, 'admin');
    await apiPool.refresh();
    const [usage] = await db.query(
      "SELECT coalesce(sum(input_tokens),0) AS input_tokens,coalesce(sum(output_tokens),0) AS output_tokens,coalesce(sum(cost_usd),0) AS cost_usd,coalesce(sum(reserved_usd),0) AS reserved_usd,count(*) AS calls FROM usage WHERE created_at>=date_trunc('month',now())",
    );
    const [convos] = await db.query('SELECT count(*) AS count FROM conversations');
    const [ratings] = await db.query(
      'SELECT count(*) AS total,count(*) FILTER (WHERE rating=1) AS positive FROM feedback',
    );
    const sources = await knowledge.sources();
    return {
      students: await db.count(),
      conversations: Number(convos.count),
      usage,
      budgetUsd: env.budget,
      budgetWarning: Number(usage.cost_usd) + Number(usage.reserved_usd) >= env.budget * 0.8,
      feedback: ratings,
      sources: {
        total: sources.length,
        active: sources.filter((s) => s.status === 'active').length,
        pending: sources.filter((s) => s.status === 'pending').length,
        errors: sources.filter((s) => ['error', 'unreadable'].includes(s.status)).length,
      },
      provider: apiPool.currentRouting.enabled ? 'pool' : env.llm,
      embedding: env.embedding,
      retentionDays: env.retention,
      dataMode: env.synthetic ? 'synthetic' : 'real',
    };
  }
  @Get('admin/sources') async adminSources(@Req() req: Request) {
    await auth.require(req, 'admin');
    return knowledge.sources();
  }
  @Post('admin/discover') async discover(@Req() req: Request, @Body() body: unknown) {
    const s = await auth.require(req, 'admin');
    const b = z
      .object({
        url: z.url().default('https://nau.edu.vn/'),
        limit: z.number().int().min(1).max(100).default(40),
      })
      .strict()
      .parse(body);
    try {
      const result = await ingestion.discover(b.url, b.limit);
      await db.audit(s.identity.accountId, 'sources_discovered', result);
      return result;
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
  @Post('admin/sources') async addSource(@Req() req: Request, @Body() body: unknown) {
    const s = await auth.require(req, 'admin');
    const b = z
      .object({
        title: z.string().min(3).max(200),
        url: z.url(),
        topic: z.string().min(1).max(100),
        kind: z.enum(['html', 'pdf']),
        admissionAfter: z.iso.date().nullable().default(null),
        effectiveFrom: z.iso.date().nullable().default(null),
      })
      .strict()
      .parse(body);
    try {
      validateSourceUrl(b.url);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const source = {
      ...b,
      id: randomUUID(),
      version: 'Chưa duyệt',
      updatedAt: new Date().toISOString().slice(0, 10),
      status: 'pending' as const,
      reviewed: false,
      excerpt: '',
    };
    await ingestion.save(source);
    await db.audit(s.identity.accountId, 'source_added', { id: source.id });
    return source;
  }
  @Post('admin/sources/:id/refresh') async refresh(@Param('id') id: string, @Req() req: Request) {
    const s = await auth.require(req, 'admin');
    const [row] = await db.query('SELECT id FROM sources WHERE id=$1', [id]);
    if (!row) throw new NotFoundException();
    await db.audit(s.identity.accountId, 'source_refresh_requested', { id });
    return ingestion.enqueue(id);
  }
  @Post('admin/sources/:id/approve') async approve(
    @Param('id') id: string,
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const s = await auth.require(req, 'admin');
    const b = z
      .object({
        excerpt: z.string().min(40).max(20000),
        version: z.string().min(3).max(100),
        page: z.number().int().positive().optional(),
        article: z.string().max(300).optional(),
        confirmedOriginal: z.literal(true),
      })
      .strict()
      .parse(body);
    try {
      return await ingestion.approve(
        id,
        b.excerpt,
        b.version,
        s.identity.accountId,
        b.page,
        b.article,
      );
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
  @Get('admin/rules') async rules(@Req() req: Request) {
    await auth.require(req, 'admin');
    return chat.rules();
  }
  @Patch('admin/rules/:id') async ruleApproval(
    @Param('id') id: string,
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const s = await auth.require(req, 'admin');
    const b = z
      .object({ institutionApproved: z.boolean(), reviewNote: z.string().min(20).max(1000) })
      .strict()
      .parse(body);
    const [row] = await db.query<{ data: RulePack }>('SELECT data FROM rules WHERE id=$1', [id]);
    if (!row) throw new NotFoundException();
    const rule = { ...row.data, institutionApproved: b.institutionApproved };
    await db.query('UPDATE rules SET data=$2 WHERE id=$1', [id, JSON.stringify(rule)]);
    await db.audit(s.identity.accountId, 'rule_reviewed', { id, ...b });
    return rule;
  }
  @Patch('admin/actions/:id') async toggle(
    @Param('id') id: string,
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    const s = await auth.require(req, 'admin');
    const b = z.object({ enabled: z.boolean() }).strict().parse(body);
    return actions.toggle(id, b.enabled, s.identity.accountId);
  }
  @Post('admin/reindex') async reindex(@Req() req: Request) {
    const s = await auth.require(req, 'admin');
    try {
      const count = await knowledge.reindex();
      await db.audit(s.identity.accountId, 'embedding_reindex', { count });
      return { count };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
  @Get('admin/audit') async audit(@Req() req: Request) {
    await auth.require(req, 'admin');
    return db.query(
      'SELECT event,actor,metadata,created_at FROM audit ORDER BY created_at DESC LIMIT 100',
    );
  }
  @Get('admin/usage') async usage(@Req() req: Request) {
    await auth.require(req, 'admin');
    return db.query(
      "SELECT model,count(*) AS calls,sum(input_tokens) AS input_tokens,sum(output_tokens) AS output_tokens,sum(cost_usd) AS cost_usd FROM usage WHERE created_at>=date_trunc('month',now()) GROUP BY model",
    );
  }
}
@Module({
  controllers: [ApiController, ApiPoolController],
  providers: [
    { provide: 'DB', useValue: db },
    { provide: 'AUTH', useValue: auth },
    { provide: 'API_POOL', useValue: apiPool },
  ],
})
class AppModule {}
const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
// Production Compose exposes only Caddy; trust precisely one proxy hop.
app
  .getHttpAdapter()
  .getInstance()
  .set('trust proxy', env.production ? 1 : false);
app.use(helmet({ contentSecurityPolicy: false }));
app.use((req: Request, res: Response, next: () => void) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin && origin !== env.origin) {
      res.status(403).json({ message: 'Nguồn yêu cầu không được phép.' });
      return;
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      res.status(403).json({ message: 'Yêu cầu khác website bị từ chối.' });
      return;
    }
    if (!req.is('application/json')) {
      res.status(415).json({ message: 'Yêu cầu phải dùng application/json.' });
      return;
    }
  }
  next();
});
app.use(
  '/api/v1/auth/login',
  rateLimit({
    windowMs: 15 * 60000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Quá nhiều lần đăng nhập. Thử lại sau.' },
  }),
);
app.use(
  '/api/v1/chat',
  rateLimit({
    windowMs: 60000,
    limit: env.synthetic ? Number(process.env.CHAT_RATE_LIMIT || 180) : 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'Bạn gửi câu hỏi quá nhanh. Vui lòng chờ một phút.' },
  }),
);
app.enableCors({ origin: env.origin, credentials: true });
app.useGlobalFilters(new Errors());
await ingestion.start();
await app.listen(env.port, '0.0.0.0');
console.log(
  `NAU AI API: http://localhost:${env.port}/api/v1/health (${env.synthetic ? 'synthetic' : 'real'}, ${env.llm})`,
);
const shutdown = async () => {
  await ingestion.stop();
  await app.close();
  await db.close();
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
