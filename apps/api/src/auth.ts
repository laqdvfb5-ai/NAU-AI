import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { compare } from 'bcryptjs';
import * as oidc from 'openid-client';
import type { Request, Response } from 'express';
import type { Identity, IdentityProvider, StudentDataProvider } from '@nau/domain';
import { Database, tokenHash } from './database.js';
import { env } from './config.js';
export interface Session {
  hash: string;
  identity: Identity | null;
}
export function cookie(req: Request, name: string) {
  return req.headers.cookie
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(name + '='))
    ?.slice(name.length + 1);
}
export class DemoIdentityProvider implements IdentityProvider {
  constructor(private db: Database) {}
  async authenticate(username: string, password: string) {
    if (!env.demo || !env.synthetic) return null;
    const [row] = await this.db.query(
      'SELECT password_hash,identity FROM accounts WHERE username=$1',
      [username.toLowerCase()],
    );
    // A fixed bcrypt hash preserves the expensive comparison for unknown accounts.
    const ok = await compare(
      password,
      row?.password_hash || '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    );
    return ok && row ? (row.identity as Identity) : null;
  }
}
export class AuthService {
  demo: DemoIdentityProvider;
  constructor(
    private db: Database,
    private students: StudentDataProvider = db,
  ) {
    this.demo = new DemoIdentityProvider(db);
  }
  private setCookie(res: Response, raw: string) {
    res.cookie('nau_session', raw, {
      httpOnly: true,
      secure: env.production,
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 3600 * 1000,
    });
  }
  async session(req: Request, res?: Response): Promise<Session> {
    const raw = cookie(req, 'nau_session');
    if (raw && /^[a-f0-9]{64}$/.test(raw)) {
      const [row] = await this.db.query(
        'SELECT identity FROM sessions WHERE token_hash=$1 AND expires_at>now()',
        [tokenHash(raw)],
      );
      if (row) return { hash: tokenHash(raw), identity: row.identity };
    }
    if (!res) throw new UnauthorizedException('Vui lòng đăng nhập.');
    return this.createSession(res, null);
  }
  async createSession(res: Response, identity: Identity | null) {
    const raw = randomBytes(32).toString('hex'),
      hash = tokenHash(raw);
    await this.db.query(
      "INSERT INTO sessions(token_hash,identity,expires_at) VALUES($1,$2,now()+interval '8 hours')",
      [hash, identity ? JSON.stringify(identity) : null],
    );
    this.setCookie(res, raw);
    return { hash, identity };
  }
  async login(req: Request, res: Response, username: string, password: string) {
    const identity = await this.demo.authenticate(username, password);
    if (!identity)
      throw new UnauthorizedException(
        'Tài khoản hoặc mật khẩu không đúng, hoặc đăng nhập thử nghiệm đã tắt.',
      );
    await this.revoke(req);
    const session = await this.createSession(res, identity);
    await this.db.audit(identity.accountId, 'login');
    return session.identity;
  }
  async revoke(req: Request) {
    const raw = cookie(req, 'nau_session');
    if (raw) await this.db.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(raw)]);
  }
  async logout(req: Request, res: Response) {
    const raw = cookie(req, 'nau_session');
    if (raw) await this.db.audit(tokenHash(raw).slice(0, 12), 'logout');
    await this.revoke(req);
    res.clearCookie('nau_session', {
      httpOnly: true,
      secure: env.production,
      sameSite: 'lax',
      path: '/',
    });
  }
  async require(req: Request, role?: 'admin' | 'student') {
    const s = await this.session(req);
    if (!s.identity) throw new UnauthorizedException('Đăng nhập để xem dữ liệu cá nhân.');
    if (role && s.identity.role !== role)
      throw new ForbiddenException('Bạn không có quyền truy cập chức năng này.');
    return s as Session & { identity: Identity };
  }
  private async oidcConfig() {
    if (
      !process.env.OIDC_ISSUER ||
      !process.env.OIDC_CLIENT_ID ||
      !process.env.OIDC_CLIENT_SECRET ||
      !process.env.OIDC_MAPPING_FILE
    )
      throw new Error('SSO chưa được cấu hình.');
    return oidc.discovery(
      new URL(process.env.OIDC_ISSUER),
      process.env.OIDC_CLIENT_ID,
      process.env.OIDC_CLIENT_SECRET,
    );
  }
  async ssoStart(res: Response) {
    const config = await this.oidcConfig(),
      state = oidc.randomState(),
      nonce = oidc.randomNonce(),
      verifier = oidc.randomPKCECodeVerifier();
    const challenge = await oidc.calculatePKCECodeChallenge(verifier);
    await this.db.query(
      "INSERT INTO oidc_states(state_hash,data,expires_at) VALUES($1,$2,now()+interval '10 minutes')",
      [tokenHash(state), JSON.stringify({ verifier, nonce })],
    );
    res.cookie('nau_oidc', state, {
      httpOnly: true,
      secure: env.production,
      sameSite: 'lax',
      maxAge: 600000,
      path: '/api/v1/auth',
    });
    return oidc
      .buildAuthorizationUrl(config, {
        redirect_uri: env.appUrl + '/api/v1/auth/oidc/callback',
        scope: 'openid profile',
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })
      .toString();
  }
  async ssoCallback(req: Request, res: Response) {
    const current = new URL(req.originalUrl, env.appUrl),
      state = current.searchParams.get('state');
    if (!state || state !== cookie(req, 'nau_oidc'))
      throw new UnauthorizedException('Phiên SSO không hợp lệ.');
    const [row] = await this.db.query(
      'DELETE FROM oidc_states WHERE state_hash=$1 AND expires_at>now() RETURNING data',
      [tokenHash(state)],
    );
    if (!row) throw new UnauthorizedException('Phiên SSO hết hạn.');
    const config = await this.oidcConfig();
    const tokens = await oidc.authorizationCodeGrant(config, current, {
      pkceCodeVerifier: row.data.verifier,
      expectedState: state,
      expectedNonce: row.data.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) throw new UnauthorizedException('SSO không trả danh tính.');
    const mappings = JSON.parse(await readFile(process.env.OIDC_MAPPING_FILE!, 'utf8')) as {
      issuer: string;
      subject: string;
      identity: Identity;
    }[];
    const mapping = mappings.find((m) => m.issuer === claims.iss && m.subject === claims.sub);
    if (!mapping || !['student', 'admin'].includes(mapping.identity.role))
      throw new ForbiddenException('Tài khoản chưa được ánh xạ bởi nhà trường.');
    if (
      mapping.identity.role === 'student' &&
      (!mapping.identity.studentId || !(await this.students.getStudent(mapping.identity.studentId)))
    )
      throw new ForbiddenException('Chưa có hồ sơ được ánh xạ.');
    await this.revoke(req);
    await this.createSession(res, mapping.identity);
    res.clearCookie('nau_oidc', { path: '/api/v1/auth' });
    await this.db.audit(mapping.identity.accountId, 'sso_login');
  }
}
