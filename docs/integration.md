# Hợp đồng tích hợp nhà trường

## Dữ liệu học tập

`StudentDataProvider` là mô hình chuẩn của NAU AI, không phải mô tả API hiện có của trường. Bản fake dùng `Database`; triển khai thật cung cấp module riêng theo hợp đồng:

```ts
import type { StudentDataProvider, Student } from '@nau/domain';
export async function createProvider(): Promise<StudentDataProvider> {
  return {
    async getStudent(canonicalStudentId: string): Promise<Student | null> {
      // Gọi API được trường cấp; xác thực máy chủ, kiểm tra lỗi và ánh xạ trường.
      // student.id phải đúng canonicalStudentId; synthetic phải false.
      // Không dùng studentId từ nội dung chat. Không trả hồ sơ khác khi không tìm thấy.
      throw new Error('Chưa triển khai theo tài liệu API trường');
    },
    async count(): Promise<number> {
      throw new Error('Chưa triển khai theo tài liệu API trường');
    },
  };
}
```

Biên dịch module ngoài thành `.mjs`/ESM rồi chỉ định đường dẫn tuyệt đối `STUDENT_PROVIDER_MODULE`. Máy chủ từ chối chế độ thật nếu thiếu adapter/SSO mapping; lỗi adapter không chuyển sang mock. Cần schema validation đầy đủ tại adapter cho dữ liệu nguồn thực tế, thời gian timeout, retry có giới hạn, SLA cập nhật và dữ liệu thiếu/null.

Các nhóm cần ánh xạ: hồ sơ/ngày tuyển sinh/hệ đào tạo; chương trình và đề cương theo phiên bản; cốt lõi tách khỏi bắt buộc; học phần/tín chỉ/tiên quyết/tương đương; lớp học phần/học kỳ/lần học/lần thi; điểm thành phần/trọng số/điểm thô và đã chốt; CLO→PI→PLO; số tiết điểm danh; bài thực hành bắt buộc; trạng thái dự thi; GPA/tín chỉ/nợ môn/cảnh báo/chứng chỉ; khoản thu/thanh toán/miễn giảm/học bổng; rèn luyện.

Không đưa tên sinh viên thật hay danh sách điểm tải từ website vào kho công khai. API `/me` nhận danh tính từ phiên phía máy chủ. Không có endpoint ứng dụng cho sinh viên nhập ID người khác; không cho model tự viết SQL hoặc chọn `studentId`.

## SSO OIDC

`AuthService` sử dụng discovery, authorization code + PKCE S256, state và nonce. State lưu hash trong PostgreSQL, chỉ dùng một lần, hết hạn 10 phút; cookie HttpOnly/SameSite=Lax. Callback: `https://TEN-MIEN/api/v1/auth/oidc/callback`.

```dotenv
DATA_MODE=real
ALLOW_DEMO_LOGIN=false
OIDC_ISSUER=https://issuer-do-truong-cung-cap
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
OIDC_MAPPING_FILE=/run/secrets/nau-identity-map.json
STUDENT_PROVIDER_MODULE=/opt/nau-adapter/provider.mjs
```

File ánh xạ được quản lý phía máy chủ, ví dụ minh họa:

```json
[
  {
    "issuer": "https://issuer-do-truong-cung-cap",
    "subject": "immutable-subject-from-issuer",
    "identity": {
      "accountId": "internal-account-id",
      "studentId": "canonical-student-id",
      "displayName": "Tên được cấp quyền",
      "role": "student"
    }
  }
]
```

Không tự nâng quyền theo email hoặc tham số trình duyệt. Vai trò admin phải nằm trong mapping quản trị được trường duyệt. Kiểm thử SSO end-to-end cần issuer thật hoặc issuer thử nghiệm của trường; bản này chưa có các thông tin đó.

## Quy chế

Quy tắc ban đầu: [Quyết định 620 ngày 26/06/2025](<https://nau.edu.vn/Images/userfiles/71/files/Q%C4%90%20620%20Ban%20h%C3%A0nh%20Quy%20ch%E1%BA%BF%20%C4%91%C3%A0o%20t%E1%BA%A1o%20tr%C3%ACnh%20%C4%91%E1%BB%99%20%C4%90%E1%BA%A1i%20h%E1%BB%8Dc(1).pdf>).

- Điều 12 khoản 3/4: điểm học phần, PI học phần cốt lõi và bài bắt buộc.
- Điều 12 khoản 9: vắng dưới 30%, từ 30% đến dưới 50%, từ 50% số tiết.
- Điều 13: làm tròn và đối chiếu điểm chữ; trọng số từ đề cương.
- Điều 28 khoản 4: tuyển sinh sau thời điểm ban hành; khóa trước cần quy chế chuyển tiếp.

Không suy điểm PI từ điểm tổng. Thi lại/cải thiện hiện trả thiếu căn cứ lựa chọn lần học/lần thi; không tự chọn điểm cao nhất. Ngành/chương trình/đề cương giả không được coi là đã xác minh. Khi `synthetic=false`, bộ đối chiếu chỉ dùng rule pack có `institutionApproved=true`, chương trình và đề cương đã xác minh. Ghi chú đối soát quy chế được lưu audit.

Khi thay quy tắc số học, bổ sung pack trong domain, kèm URL/trang/điều/phạm vi và golden tests. Quản trị không sửa số học tự do bằng một đoạn chat. Danh sách học phần cốt lõi, PI cần đạt và yêu cầu thực hành phải được giảng viên/phòng đào tạo đối soát riêng.

## Tác vụ

`ActionRegistry` tách cờ `enabled` khỏi `handlerAvailable`. Ba tác vụ ban đầu chưa có handler. `/prepare` trả lý do, `/execute` luôn 409 `ACTION_NOT_CONFIGURED` kể cả khi bật cờ. Chưa có yêu cầu nào được gửi ra hệ thống trường. Khi triển khai handler thật cần token xác nhận một lần, kiểm tra quyền, idempotency, chống replay, thời hạn xác nhận và nhật ký kết quả thực tế.
