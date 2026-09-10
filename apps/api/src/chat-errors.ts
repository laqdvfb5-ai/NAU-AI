import { BadGatewayException, HttpException } from '@nestjs/common';
import { publicPoolError } from './api-pool-security.js';

export interface PublicChatError {
  code: string;
  message: string;
  retryable: boolean;
}

const retryableCodes = new Set([
  'UPSTREAM_ERROR',
  'RATE_LIMIT',
  'TIMEOUT',
  'CONNECTION_FAILED',
  'BUSY',
  'COOLDOWN',
  'NO_API_AVAILABLE',
  'EMPTY_RESPONSE',
]);

const temporarilyUnavailableMessage =
  'Các kết nối model AI đang bận hoặc tạm nghỉ. Vui lòng thử lại sau.';
const configurationMessage = 'Model AI chưa sẵn sàng. Quản trị viên cần kiểm tra cấu hình API.';

const publicModelMessages: Readonly<Record<string, string>> = {
  UPSTREAM_ERROR: 'Máy chủ API đang báo lỗi. Có thể thử lại sau.',
  RATE_LIMIT: 'Nhà cung cấp báo giới hạn lượt gọi hoặc hết quota.',
  TIMEOUT: 'Yêu cầu hết thời gian chờ hoặc đã bị hủy.',
  CONNECTION_FAILED:
    'Không kết nối hoặc không đọc được phản hồi API. Kiểm tra địa chỉ, DNS, cổng, chứng chỉ và dịch vụ đang chạy.',
  BUSY: temporarilyUnavailableMessage,
  COOLDOWN: temporarilyUnavailableMessage,
  NO_API_AVAILABLE: temporarilyUnavailableMessage,
  EMPTY_RESPONSE: 'Model AI chưa trả về nội dung. Vui lòng thử lại sau.',
  BUDGET_LIMIT:
    'Ngân sách sử dụng model AI hiện không đủ. Quản trị viên cần kiểm tra cấu hình chi phí.',
};

function publicModelMessage(code: string) {
  return publicModelMessages[code] || configurationMessage;
}

/**
 * Carries only the pool's normalized error fields across the chat boundary.
 * The original SDK error is deliberately not retained as a property or cause.
 */
export class ChatModelException extends BadGatewayException {
  readonly code: string;
  readonly retryable: boolean;

  constructor(error: unknown) {
    const safe = publicPoolError(error);
    super(publicModelMessage(safe.code));
    this.name = 'ChatModelException';
    this.code = safe.code;
    this.retryable = retryableCodes.has(safe.code);
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
