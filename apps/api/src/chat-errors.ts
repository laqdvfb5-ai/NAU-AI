import { BadGatewayException, HttpException } from '@nestjs/common';
import { publicPoolError } from './api-pool-security.js';

export interface PublicChatError {
  code: string;
  message: string;
  retryable: boolean;
}

const notRetryable = new Set([
  'AUTH_FAILED',
  'BUDGET_LIMIT',
  'EMPTY_ROUTE',
  'INCOMPATIBLE_REQUEST',
  'KEY_STORAGE',
  'MODEL_REQUIRED',
  'NOT_FOUND',
  'POOL_DISABLED',
  'TEST_REQUIRED',
]);

/**
 * Carries only the pool's normalized error fields across the chat boundary.
 * The original SDK error is deliberately not retained as a property or cause.
 */
export class ChatModelException extends BadGatewayException {
  readonly code: string;
  readonly retryable: boolean;

  constructor(error: unknown) {
    const safe = publicPoolError(error);
    super(safe.message);
    this.name = 'ChatModelException';
    this.code = safe.code;
    this.retryable = !notRetryable.has(safe.code);
  }

  publicPayload(): PublicChatError {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

export function publicChatError(error: unknown): PublicChatError {
  if (error instanceof ChatModelException) return error.publicPayload();
  if (error instanceof HttpException) {
    return {
      code: 'CHAT_REQUEST_FAILED',
      message: error.message,
      retryable: error.getStatus() >= 500,
    };
  }
  return {
    code: 'CHAT_REQUEST_FAILED',
    message: 'Không thể trả lời lúc này. Vui lòng thử lại.',
    retryable: true,
  };
}

export function chatFailureLog(
  failure: PublicChatError,
  context: {
    stage: 'model_generation' | 'chat_response';
    mode?: string;
    role?: 'guest' | 'student' | 'admin';
    ephemeral?: boolean;
  },
) {
  return {
    event: 'chat_request_failed',
    stage: context.stage,
    code: failure.code,
    retryable: failure.retryable,
    ...(context.mode ? { mode: context.mode } : {}),
    ...(context.role ? { role: context.role } : {}),
    ...(context.ephemeral === undefined ? {} : { ephemeral: context.ephemeral }),
  };
}
