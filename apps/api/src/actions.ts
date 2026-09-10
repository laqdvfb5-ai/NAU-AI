import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ActionRegistry, ActionDefinition, Identity } from '@nau/domain';
import { Database } from './database.js';
export class DisabledActionRegistry implements ActionRegistry {
  private definitions: ActionDefinition[] = [
    {
      id: 'register-course',
      name: 'Đăng ký học phần',
      description: 'Gửi yêu cầu đăng ký học phần qua hệ thống trường.',
      enabled: false,
      role: 'student',
      handlerAvailable: false,
    },
    {
      id: 'cancel-course',
      name: 'Hủy học phần',
      description: 'Gửi yêu cầu hủy đăng ký học phần.',
      enabled: false,
      role: 'student',
      handlerAvailable: false,
    },
    {
      id: 'submit-request',
      name: 'Gửi hồ sơ sinh viên',
      description: 'Chuyển hồ sơ tới đơn vị phụ trách.',
      enabled: false,
      role: 'student',
      handlerAvailable: false,
    },
  ];
  constructor(private db: Database) {}
  async init() {
    const rows = await this.db.query("SELECT key,value FROM settings WHERE key LIKE 'action:%'");
    for (const r of rows) {
      const a = this.definitions.find((a) => 'action:' + a.id === r.key);
      if (a) a.enabled = r.value === true;
    }
  }
  list() {
    return this.definitions.map((x) => ({ ...x }));
  }
  prepare(id: string, identity: Identity) {
    const action = this.definitions.find((a) => a.id === id);
    if (!action) throw new NotFoundException('Không có tác vụ này.');
    if (identity.role !== action.role)
      throw new ForbiddenException('Không có quyền thực hiện tác vụ.');
    return {
      available: action.enabled && action.handlerAvailable,
      reason: !action.handlerAvailable
        ? 'Chưa có kết nối xử lý với hệ thống trường. Không có yêu cầu nào được gửi.'
        : !action.enabled
          ? 'Tác vụ đang tắt.'
          : 'Cần xác nhận trước khi thực hiện.',
    };
  }
  async execute(id: string, identity: Identity, _confirmation: string) {
    this.prepare(id, identity);
    throw new ConflictException({
      code: 'ACTION_NOT_CONFIGURED',
      message: 'Tác vụ chưa có bộ xử lý. Không có thay đổi nào được thực hiện.',
    });
  }
  async toggle(id: string, enabled: boolean, actor: string) {
    const action = this.definitions.find((a) => a.id === id);
    if (!action) throw new NotFoundException();
    await this.db.query(
      'INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      ['action:' + id, JSON.stringify(enabled)],
    );
    action.enabled = enabled;
    await this.db.audit(actor, 'action_toggled', { id, enabled });
    return action;
  }
}
