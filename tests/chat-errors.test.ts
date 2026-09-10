import test from 'node:test';
import assert from 'node:assert/strict';
import { BadGatewayException } from '@nestjs/common';
import { PoolError } from '../apps/api/src/api-pool-security.js';
import { ChatService } from '../apps/api/src/chat.js';
import {
  ChatModelException,
  chatFailureLog,
  publicChatError,
} from '../apps/api/src/chat-errors.js';

test('chat model failures preserve only normalized pool details', () => {
  const exception = new ChatModelException(
    new PoolError('UPSTREAM_ERROR', 'provider.internal returned api_key=sk-secret'),
  );

  assert.equal(exception.getStatus(), 502);
  assert.deepEqual(publicChatError(exception), {
    code: 'UPSTREAM_ERROR',
    message: 'Máy chủ API đang báo lỗi. Có thể thử lại sau.',
    retryable: true,
  });
  assert.doesNotMatch(JSON.stringify(exception), /provider\.internal|sk-secret/);
});

test('configuration errors cannot expose profile names or arbitrary PoolError messages', () => {
  const exception = new ChatModelException(
    new PoolError(
      'TEST_REQUIRED',
      'Cấu hình "tenant-secret-profile" cần kiểm tra lại với key=sk-private.',
    ),
  );

  assert.deepEqual(publicChatError(exception), {
    code: 'TEST_REQUIRED',
    message: 'Model AI chưa sẵn sàng. Quản trị viên cần kiểm tra cấu hình API.',
    retryable: false,
  });
  assert.doesNotMatch(JSON.stringify(exception), /tenant-secret-profile|sk-private/);
});

test('only explicitly transient model failures are retryable', () => {
  const retryable = [
    'UPSTREAM_ERROR',
    'RATE_LIMIT',
    'TIMEOUT',
    'CONNECTION_FAILED',
    'BUSY',
    'COOLDOWN',
    'NO_API_AVAILABLE',
    'EMPTY_RESPONSE',
  ];
  const permanent = [
    'AUTH_FAILED',
    'BUDGET_LIMIT',
    'LOCAL_ONLY',
    'DISABLED',
    'KEY_REQUIRED',
    'PRICES_REQUIRED',
    'TEST_REQUIRED',
    'FUTURE_UNKNOWN_ERROR',
  ];

  for (const code of retryable)
    assert.equal(
      new ChatModelException(new PoolError(code, 'private detail')).retryable,
      true,
      code,
    );
  for (const code of permanent)
    assert.equal(
      new ChatModelException(new PoolError(code, 'private detail')).retryable,
      false,
      code,
    );
});

test('ChatService surfaces the pool code and emits only the structured safe log', async () => {
  const service = new ChatService({} as never, {} as never, {
    mode: 'pool',
    async generate() {
      throw new PoolError('UPSTREAM_ERROR', 'Máy chủ API đang báo lỗi. Có thể thử lại sau.');
    },
  });
  const logs: string[] = [];
  (service as unknown as { logger: { warn(value: string): void } }).logger = {
    warn: (value) => logs.push(value),
  };

  await assert.rejects(
    service.answer('xin chào', { hash: 'test-session', identity: null }, undefined, true),
    (error: unknown) => {
      assert.ok(error instanceof ChatModelException);
      assert.equal(error.code, 'UPSTREAM_ERROR');
      assert.equal(error.message, 'Máy chủ API đang báo lỗi. Có thể thử lại sau.');
      return true;
    },
  );
  assert.deepEqual(
    logs.map((value) => JSON.parse(value)),
    [
      {
        event: 'chat_request_failed',
        stage: 'model_generation',
        code: 'UPSTREAM_ERROR',
        retryable: true,
        mode: 'pool',
        role: 'guest',
        ephemeral: true,
      },
    ],
  );
});

test('unknown provider errors cannot leak raw messages or secrets', () => {
  const raw = new Error('request failed api_key=sk-secret provider.internal/private/path');
  const exception = new ChatModelException(raw);
  const payload = publicChatError(exception);

  assert.deepEqual(payload, {
    code: 'CONNECTION_FAILED',
    message:
      'Không kết nối hoặc không đọc được phản hồi API. Kiểm tra địa chỉ, DNS, cổng, chứng chỉ và dịch vụ đang chạy.',
    retryable: true,
  });
  assert.doesNotMatch(JSON.stringify(payload), /sk-secret|provider\.internal|private\/path/);
  assert.equal(exception.cause, undefined);
  assert.doesNotMatch(JSON.stringify(exception), /sk-secret|provider\.internal|private\/path/);
});

test('structured chat failure logs omit messages, prompts and provider identifiers', () => {
  const log = chatFailureLog(
    {
      code: 'AUTH_FAILED',
      message: 'API từ chối xác thực.',
      retryable: false,
    },
    { stage: 'model_generation', mode: 'pool', role: 'student', ephemeral: false },
  );

  assert.deepEqual(log, {
    event: 'chat_request_failed',
    stage: 'model_generation',
    code: 'AUTH_FAILED',
    retryable: false,
    mode: 'pool',
    role: 'student',
    ephemeral: false,
  });
  assert.equal('message' in log, false);
  assert.equal('providerId' in log, false);
});

test('non-model HTTP chat failures retain their safe user message', () => {
  assert.deepEqual(publicChatError(new BadGatewayException('Câu trả lời chưa hợp lệ.')), {
    code: 'CHAT_REQUEST_FAILED',
    message: 'Câu trả lời chưa hợp lệ.',
    retryable: true,
  });
  assert.deepEqual(publicChatError(new Error('database DSN and password')), {
    code: 'CHAT_REQUEST_FAILED',
    message: 'Không thể trả lời lúc này. Vui lòng thử lại.',
    retryable: true,
  });
});
