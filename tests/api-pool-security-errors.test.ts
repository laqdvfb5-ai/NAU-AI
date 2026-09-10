import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PoolError, publicPoolError } from '../apps/api/src/api-pool-security.js';

const messageFor = {
  AUTH_FAILED: 'API từ chối xác thực. Kiểm tra key và quyền truy cập model.',
  RATE_LIMIT: 'Nhà cung cấp báo giới hạn lượt gọi hoặc hết quota.',
  TIMEOUT: 'Yêu cầu hết thời gian chờ hoặc đã bị hủy.',
  UPSTREAM_ERROR: 'Máy chủ API đang báo lỗi. Có thể thử lại sau.',
  NOT_FOUND: 'Không tìm thấy endpoint hoặc model. Kiểm tra base URL và model ID.',
  INCOMPATIBLE_REQUEST:
    'API không chấp nhận tham số. Kiểm tra model, giới hạn token và các tùy chọn tương thích.',
  CONNECTION_FAILED:
    'Không kết nối hoặc không đọc được phản hồi API. Kiểm tra địa chỉ, DNS, cổng, chứng chỉ và dịch vụ đang chạy.',
} as const;

function expectCode(error: unknown, code: keyof typeof messageFor) {
  assert.deepEqual(publicPoolError(error), { code, message: messageFor[code] });
}

test('classifies upstream errors carried by an HTTP-200 event stream', () => {
  expectCode(
    {
      type: 'upstream_error',
      message: 'Our servers are currently overloaded. Please try again later.',
    },
    'UPSTREAM_ERROR',
  );
  expectCode({ error: { code: 'service_unavailable' } }, 'UPSTREAM_ERROR');
  expectCode({ cause: { type: 'overloaded_error' } }, 'UPSTREAM_ERROR');
  expectCode(new Error('The upstream service is temporarily unavailable'), 'UPSTREAM_ERROR');
  expectCode(new Error('upstream_error'), 'UPSTREAM_ERROR');
  expectCode(new Error('service_unavailable'), 'UPSTREAM_ERROR');
});

test('classifies authentication, rate-limit and timeout errors without an HTTP status', () => {
  expectCode({ error: { type: 'authentication_error', code: 'invalid_api_key' } }, 'AUTH_FAILED');
  expectCode(new Error('authentication_error'), 'AUTH_FAILED');
  expectCode({ type: 'rate_limit_error' }, 'RATE_LIMIT');
  expectCode(new Error('rate_limit_exceeded'), 'RATE_LIMIT');
  expectCode(new Error('Quota exceeded for this project'), 'RATE_LIMIT');
  expectCode({ cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } }, 'TIMEOUT');
  expectCode({ name: 'AbortError', message: 'The operation was aborted' }, 'TIMEOUT');
  expectCode({ name: 'APIConnectionTimeoutError' }, 'TIMEOUT');
  expectCode(new Error('timeout_error'), 'TIMEOUT');
});

test('keeps HTTP status mapping authoritative', () => {
  expectCode({ status: 401 }, 'AUTH_FAILED');
  expectCode({ response: { status: 404 } }, 'NOT_FOUND');
  expectCode({ status: 429 }, 'RATE_LIMIT');
  expectCode({ status: 422 }, 'INCOMPATIBLE_REQUEST');
  expectCode({ status: 503 }, 'UPSTREAM_ERROR');
  expectCode({ status: 400, type: 'upstream_error' }, 'INCOMPATIBLE_REQUEST');
});

test('recognizes statusCode and numeric-string HTTP statuses from SDK error shapes', () => {
  expectCode({ statusCode: 503 }, 'UPSTREAM_ERROR');
  expectCode({ response: { statusCode: '401' } }, 'AUTH_FAILED');
  expectCode({ status: '429' }, 'RATE_LIMIT');
  expectCode({ cause: { response: { status: ' 422 ' } } }, 'INCOMPATIBLE_REQUEST');
});

test('maps known request identifiers and leaves unknown errors as connection failures', () => {
  expectCode({ error: { code: 'model_not_found' } }, 'NOT_FOUND');
  expectCode({ type: 'invalid_request_error' }, 'INCOMPATIBLE_REQUEST');
  expectCode(new Error('socket closed unexpectedly'), 'CONNECTION_FAILED');
  expectCode({ code: 'some_future_provider_error' }, 'CONNECTION_FAILED');
});

test('preserves an intentional PoolError and never exposes provider error text', () => {
  assert.deepEqual(publicPoolError(new PoolError('DISABLED', 'Cấu hình đang tắt.')), {
    code: 'DISABLED',
    message: 'Cấu hình đang tắt.',
  });
  assert.deepEqual(
    publicPoolError({ cause: { cause: new PoolError('DISABLED', 'Cấu hình đang tắt.') } }),
    { code: 'DISABLED', message: 'Cấu hình đang tắt.' },
  );
  const providerSecret = 'provider-secret-details-must-not-leak';
  const result = publicPoolError({ type: 'upstream_error', message: providerSecret });
  assert.equal(result.code, 'UPSTREAM_ERROR');
  assert.equal(result.message, messageFor.UPSTREAM_ERROR);
  assert.doesNotMatch(result.message, new RegExp(providerSecret));
});

test('handles cyclic and primitive error values', () => {
  const cyclic: Record<string, unknown> = { code: 'service_unavailable' };
  cyclic.cause = cyclic;
  expectCode(cyclic, 'UPSTREAM_ERROR');
  expectCode(null, 'CONNECTION_FAILED');
  expectCode('plain failure', 'CONNECTION_FAILED');
});
