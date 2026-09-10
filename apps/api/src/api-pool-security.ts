import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { Agent, fetch as networkFetch } from 'undici';
import ipaddr from 'ipaddr.js';

export class PoolError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PoolError';
  }
}
export function validateApiBaseUrl(value: string, network: 'cloud' | 'local'): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PoolError('INVALID_URL', 'Base URL không hợp lệ.');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new PoolError(
      'INVALID_URL',
      'Dùng base URL HTTP(S), không chứa thông tin đăng nhập, query hoặc fragment.',
    );
  if (network === 'cloud' && url.protocol !== 'https:')
    throw new PoolError('HTTPS_REQUIRED', 'API bên ngoài phải dùng HTTPS.');
  if (/\/(chat\/completions|models|responses|embeddings)\/?$/.test(url.pathname))
    throw new PoolError(
      'INVALID_BASE_URL',
      'Nhập base URL, ví dụ https://api.openai.com/v1, thay vì đường dẫn /chat/completions hoặc /models.',
    );
  return url;
}
export function checkApiAddress(address: string, network: 'cloud' | 'local') {
  let ip: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    ip = ipaddr.process(address);
  } catch {
    throw new PoolError('NETWORK_BLOCKED', 'Địa chỉ máy chủ không hợp lệ.');
  }
  const range = ip.range();
  const local = ['loopback', 'private', 'uniqueLocal'].includes(range);
  if (network === 'local' && !local)
    throw new PoolError(
      'NETWORK_BLOCKED',
      'Cấu hình nội bộ chỉ được kết nối loopback hoặc mạng riêng.',
    );
  if (network === 'cloud' && range !== 'unicast')
    throw new PoolError(
      'NETWORK_BLOCKED',
      'API bên ngoài không được trỏ vào mạng riêng hoặc địa chỉ dành riêng.',
    );
}
export function encryptApiKey(
  key: string,
  profileId: string,
  secret = process.env.SESSION_SECRET || '',
) {
  if (secret.length < 32)
    throw new PoolError('KEY_STORAGE', 'Thiếu khóa máy chủ để mã hóa API key.');
  const derived = Buffer.from(hkdfSync('sha256', secret, 'nau-ai-api-pool', 'api-key-v1', 32));
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', derived, iv);
  cipher.setAAD(Buffer.from(profileId));
  const encrypted = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}
export function decryptApiKey(
  value: string,
  profileId: string,
  secret = process.env.SESSION_SECRET || '',
) {
  try {
    if (secret.length < 32) throw new Error();
    const [version, iv, tag, encrypted] = value.split('.');
    if (version !== 'v1') throw new Error();
    const derived = Buffer.from(hkdfSync('sha256', secret, 'nau-ai-api-pool', 'api-key-v1', 32));
    const decipher = createDecipheriv('aes-256-gcm', derived, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(profileId));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new PoolError(
      'KEY_STORAGE',
      'Không đọc được API key đã lưu. Nhập lại key nếu khóa mã hóa máy chủ đã thay đổi.',
    );
  }
}
/** Pinned DNS and no redirects: stored credentials are sent only to the configured API origin. */
export function createApiTransport(baseUrl: string, network: 'cloud' | 'local') {
  const base = validateApiBaseUrl(baseUrl, network);
  const dispatcher = new Agent({
    connect: {
      lookup: (hostname, options, callback) => {
        void lookup(hostname, { all: true })
          .then((addresses) => {
            for (const entry of addresses) checkApiAddress(entry.address, network);
            if (!addresses.length)
              throw new PoolError('DNS_ERROR', 'Không phân giải được tên máy chủ.');
            if (options.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
          })
          .catch((error) => callback(error, '', 4));
      },
    },
  });
  const fetcher: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/')
    )
      throw new PoolError('NETWORK_BLOCKED', 'Yêu cầu nằm ngoài API đã cấu hình.');
    // Literal IP requests may bypass lookup in the HTTP agent.
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    if (ipaddr.isValid(hostname)) checkApiAddress(hostname, network);
    const response = await networkFetch(url, {
      ...init,
      dispatcher,
      redirect: 'error',
    } as Parameters<typeof networkFetch>[1]);
    return response as unknown as Response;
  };
  return { fetch: fetcher, close: () => dispatcher.close() };
}
export function publicPoolError(error: unknown): { code: string; message: string } {
  if (error instanceof PoolError) return { code: error.code, message: error.message };

  /*
   * Some OpenAI-compatible APIs report an error inside an otherwise successful
   * HTTP 200 event stream. In that case the SDK has no HTTP status to expose and
   * only keeps fields such as `type`, `code` and `message` on the thrown error.
   * Inspect a small, known part of the error chain so those failures do not get
   * mislabeled as DNS/connection failures. Provider text is used only for
   * classification and is never returned to the client.
   */
  const details = collectErrorDetails(error);
  if (details.poolError)
    return { code: details.poolError.code, message: details.poolError.message };
  const status = details.statuses[0];

  if (status === 401 || status === 403)
    return {
      code: 'AUTH_FAILED',
      message: 'API từ chối xác thực. Kiểm tra key và quyền truy cập model.',
    };
  if (status === 404)
    return {
      code: 'NOT_FOUND',
      message: 'Không tìm thấy endpoint hoặc model. Kiểm tra base URL và model ID.',
    };
  if (status === 429)
    return { code: 'RATE_LIMIT', message: 'Nhà cung cấp báo giới hạn lượt gọi hoặc hết quota.' };
  if (status === 400 || status === 422)
    return {
      code: 'INCOMPATIBLE_REQUEST',
      message:
        'API không chấp nhận tham số. Kiểm tra model, giới hạn token và các tùy chọn tương thích.',
    };
  if (status && status >= 500)
    return { code: 'UPSTREAM_ERROR', message: 'Máy chủ API đang báo lỗi. Có thể thử lại sau.' };

  if (
    details.identifiers.some((value) =>
      matchesIdentifier(value, [
        'authentication_error',
        'authentication_failed',
        'invalid_api_key',
        'invalid_authentication',
        'unauthorized',
        'forbidden',
        'permission_denied',
        'access_denied',
      ]),
    ) ||
    details.messages.some((value) =>
      /\b(?:unauthori[sz]ed|forbidden|permission[ _-]+denied|access[ _-]+denied|authentication[ _-]+(?:error|failed|required)|(?:invalid|incorrect|missing|expired|revoked)[ _-]+(?:api[ _-]?key|token|credentials?))\b/i.test(
        value,
      ),
    )
  )
    return {
      code: 'AUTH_FAILED',
      message: 'API từ chối xác thực. Kiểm tra key và quyền truy cập model.',
    };

  if (
    details.identifiers.some((value) =>
      matchesIdentifier(value, [
        'rate_limit',
        'rate_limit_error',
        'rate_limit_exceeded',
        'too_many_requests',
        'quota_exceeded',
        'insufficient_quota',
        'billing_hard_limit_reached',
      ]),
    ) ||
    details.messages.some((value) =>
      /\b(?:rate[ _-]?limit(?:ed|[ _-]+(?:error|exceeded))?|too[ _-]+many[ _-]+requests|quota[ _-]+(?:(?:has[ _-]+been)[ _-]+)?(?:exceeded|exhausted)|insufficient[ _-]+quota)\b/i.test(
        value,
      ),
    )
  )
    return { code: 'RATE_LIMIT', message: 'Nhà cung cấp báo giới hạn lượt gọi hoặc hết quota.' };

  if (
    details.identifiers.some(
      (value) =>
        matchesIdentifier(value, [
          'abort_error',
          'timeout',
          'timeout_error',
          'request_timeout',
          'etimedout',
          'econnaborted',
          'und_err_connect_timeout',
          'und_err_headers_timeout',
          'und_err_body_timeout',
        ]) ||
        value.endsWith('_timeout_error') ||
        value.endsWith('_abort_error'),
    ) ||
    details.messages.some((value) =>
      /\b(?:timed[ _-]+out|timeout(?:[ _-]+error)?|deadline[ _-]+exceeded|request[ _-]+(?:was[ _-]+)?aborted)\b/i.test(
        value,
      ),
    )
  )
    return { code: 'TIMEOUT', message: 'Yêu cầu hết thời gian chờ hoặc đã bị hủy.' };

  if (
    details.identifiers.some((value) =>
      matchesIdentifier(value, [
        'upstream_error',
        'server_error',
        'internal_server_error',
        'service_unavailable',
        'temporarily_unavailable',
        'overloaded',
        'overloaded_error',
        'capacity_exceeded',
        'engine_overloaded',
      ]),
    ) ||
    details.messages.some((value) =>
      /\b(?:upstream[ _-]+error|service(?:[ _-]+is)?(?:[ _-]+temporarily)?[ _-]+unavailable|temporarily[ _-]+unavailable|servers?[ _-]+(?:(?:are|is)[ _-]+)?(?:currently[ _-]+)?overloaded|overloaded|capacity[ _-]+exceeded)\b/i.test(
        value,
      ),
    )
  )
    return { code: 'UPSTREAM_ERROR', message: 'Máy chủ API đang báo lỗi. Có thể thử lại sau.' };

  if (
    details.identifiers.some((value) =>
      matchesIdentifier(value, ['not_found', 'not_found_error', 'model_not_found']),
    )
  )
    return {
      code: 'NOT_FOUND',
      message: 'Không tìm thấy endpoint hoặc model. Kiểm tra base URL và model ID.',
    };

  if (
    details.identifiers.some((value) =>
      matchesIdentifier(value, [
        'bad_request',
        'bad_request_error',
        'invalid_request',
        'invalid_request_error',
        'unprocessable_entity',
      ]),
    )
  )
    return {
      code: 'INCOMPATIBLE_REQUEST',
      message:
        'API không chấp nhận tham số. Kiểm tra model, giới hạn token và các tùy chọn tương thích.',
    };

  return {
    code: 'CONNECTION_FAILED',
    message:
      'Không kết nối hoặc không đọc được phản hồi API. Kiểm tra địa chỉ, DNS, cổng, chứng chỉ và dịch vụ đang chạy.',
  };
}

type ErrorDetails = {
  statuses: number[];
  identifiers: string[];
  messages: string[];
  poolError?: PoolError;
};

function collectErrorDetails(error: unknown): ErrorDetails {
  const details: ErrorDetails = { statuses: [], identifiers: [], messages: [] };
  const queue: Array<{ value: unknown; depth: number }> = [{ value: error, depth: 0 }];
  const seen = new Set<object>();

  while (queue.length) {
    const current = queue.shift()!;
    if (
      !current.value ||
      (typeof current.value !== 'object' && typeof current.value !== 'function')
    )
      continue;
    const record = current.value as Record<string, unknown>;
    if (seen.has(record)) continue;
    seen.add(record);

    if (record instanceof PoolError)
      return {
        ...details,
        poolError: record,
      };

    const status = record.status;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599)
      details.statuses.push(status);

    for (const field of ['type', 'code', 'name'] as const) {
      const value = record[field];
      if (typeof value === 'string' && value.length <= 200)
        details.identifiers.push(normalize(value));
    }
    if (typeof record.message === 'string' && record.message.length <= 2_000)
      details.messages.push(record.message);

    if (current.depth < 4)
      for (const field of ['cause', 'error', 'response'] as const)
        queue.push({ value: record[field], depth: current.depth + 1 });
  }

  return details;
}

function normalize(value: string) {
  return value
    .trim()
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function matchesIdentifier(value: string, expected: string[]) {
  return expected.includes(value);
}
