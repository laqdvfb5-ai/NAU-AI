import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Req,
  Res,
  Body,
  Param,
  Inject,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuthService } from './auth.js';
import { ApiPoolService } from './api-pool.js';

@Controller('api/v1/admin/api-pool')
export class ApiPoolController {
  constructor(
    @Inject('AUTH') private auth: AuthService,
    @Inject('API_POOL') private pool: ApiPoolService,
  ) {}
  @Get() async overview(@Req() req: Request) {
    await this.auth.require(req, 'admin');
    return this.pool.overview();
  }
  @Post('profiles') async create(@Req() req: Request, @Body() body: unknown) {
    const session = await this.auth.require(req, 'admin');
    return this.pool.save(body, session.identity.accountId);
  }
  @Patch('profiles/:id') async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const session = await this.auth.require(req, 'admin');
    return this.pool.save(body, session.identity.accountId, z.uuid().parse(id));
  }
  @Delete('profiles/:id') async remove(@Req() req: Request, @Param('id') id: string) {
    const session = await this.auth.require(req, 'admin');
    return this.pool.remove(z.uuid().parse(id), session.identity.accountId);
  }
  @Post('profiles/:id/models') async models(@Req() req: Request, @Param('id') id: string) {
    const session = await this.auth.require(req, 'admin');
    return this.pool.models(z.uuid().parse(id), session.identity.accountId);
  }
  @Post('routing') async routing(@Req() req: Request, @Body() body: unknown) {
    const session = await this.auth.require(req, 'admin');
    return this.pool.setRouting(body, session.identity.accountId);
  }
  @Post('profiles/:id/test') async test(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const session = await this.auth.require(req, 'admin');
    z.uuid().parse(id);
    const input = z
      .object({ question: z.string().trim().min(1).max(2000) })
      .strict()
      .parse(body);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    const send = (event: string, data: unknown) => {
      if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send('status', { message: 'Đang gửi yêu cầu tới API đã chọn…' });
    const heartbeat = setInterval(() => {
      if (!res.destroyed) res.write(': keepalive\n\n');
    }, 8000);
    try {
      const result = await this.pool.test(
        id,
        input.question,
        session.identity.accountId,
        abort.signal,
        (text) => send('delta', { text }),
      );
      send('result', result);
    } catch {
      send('error', {
        message:
          'Không đọc được cấu hình hoặc không lưu được kết quả kiểm thử. Hãy tải lại kho API.',
      });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  }
}
