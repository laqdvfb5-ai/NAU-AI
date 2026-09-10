# API v1

Base URL `/api/v1`. Các mutation dùng `Content-Type: application/json`. Cookie `nau_session` HttpOnly, SameSite=Lax, Secure ở production, phiên 8 giờ. Mutation khác `WEB_ORIGIN` hoặc `Sec-Fetch-Site: cross-site` bị từ chối. Nội dung body có field lạ bị từ chối bằng schema strict.

| Endpoint                                           | Quyền          | Nội dung                                                              |
| -------------------------------------------------- | -------------- | --------------------------------------------------------------------- |
| GET `/health`                                      | Công khai      | Chế độ dữ liệu/model/embedding, readiness DB                          |
| GET `/auth/session`                                | Công khai      | Tạo phiên khách hoặc trả danh tính hiện tại                           |
| POST `/auth/login`                                 | Demo đã bật    | `{username,password}`, đổi session ID                                 |
| POST `/auth/logout`                                | Phiên hiện tại | Thu hồi phiên ở máy chủ                                               |
| GET `/auth/oidc`, `/auth/oidc/callback`            | OIDC           | Đăng nhập SSO đã cấu hình                                             |
| GET `/me`, `/me/academics`                         | Sinh viên      | Hồ sơ và giải thích của người đăng nhập                               |
| POST `/chat`                                       | Khách/SV       | `{message, conversationId?, embed?}`                                  |
| GET `/conversations`, `/conversations/:id`         | Chủ sở hữu     | Lịch sử của chính mình                                                |
| DELETE `/conversations/:id`                        | Chủ sở hữu     | Xóa hội thoại và messages                                             |
| POST `/feedback`                                   | Chủ hội thoại  | `{conversationId,messageId,rating:1                                   | -1,note?}` |
| GET `/sources`, `/actions`                         | Công khai      | Nguồn và trạng thái tác vụ                                            |
| POST `/actions/:id/prepare`                        | Sinh viên      | Kiểm tra khả năng thực hiện                                           |
| POST `/actions/:id/execute`                        | Sinh viên      | `{confirmation}`, 409 khi chưa có handler                             |
| GET `/admin/stats`, `/admin/usage`, `/admin/audit` | Admin          | Thống kê thực tế, token/chi phí và audit                              |
| GET/POST `/admin/sources`                          | Admin          | Nguồn đầy đủ / thêm URL chính thức                                    |
| POST `/admin/discover`                             | Admin          | `{url?,limit?}`, khám phá tối đa 100 liên kết công khai, chờ duyệt    |
| POST `/admin/sources/:id/refresh`                  | Admin          | Đưa vào hàng đợi tải/đọc/OCR                                          |
| POST `/admin/sources/:id/approve`                  | Admin          | `{excerpt,version,page?,article?,confirmedOriginal:true}`             |
| GET `/admin/rules`                                 | Admin          | Pack và phạm vi đã lưu                                                |
| PATCH `/admin/rules/:id`                           | Admin          | `{institutionApproved,reviewNote}`                                    |
| PATCH `/admin/actions/:id`                         | Admin          | `{enabled}`, không tạo handler                                        |
| POST `/admin/reindex`                              | Admin          | Tạo embedding nguồn đã duyệt                                          |
| GET `/admin/api-pool`                              | Admin          | Cấu hình không chứa key, preset, lựa chọn chat, thống kê tháng        |
| POST `/admin/api-pool/profiles`                    | Admin          | Tạo cấu hình API; `ApiProfileConfig` và `apiKey?`                     |
| PATCH `/admin/api-pool/profiles/:id`               | Admin          | Toàn bộ cấu hình, `revision`, `apiKey?` hoặc `clearKey?`              |
| DELETE `/admin/api-pool/profiles/:id`              | Admin          | Xóa khi không được chọn trong nhóm chat và không đang xử lý           |
| POST `/admin/api-pool/profiles/:id/models`         | Admin          | Gọi `/models` trên server đã cấu hình                                 |
| POST `/admin/api-pool/profiles/:id/test`           | Admin          | `{question}`; thử completion thật qua SSE                             |
| POST `/admin/api-pool/routing`                     | Admin          | `{enabled,strategy:manual\|round_robin,simple:UUID[],complex:UUID[]}` |

SSE chat trả event `status` với `{stage,message}` theo bước xử lý thực tế: `reasoning` chuẩn bị câu hỏi/ngữ cảnh, `searching` tìm trong kho nguồn, `checking` đối chiếu hồ sơ, `generating` gọi model và `validating` kiểm tra diễn giải PI, phạm vi tư vấn hoặc danh tính khi cần. Không phải lượt nào cũng có mọi bước; đây là tiến trình ứng dụng, không phải chuỗi suy luận nội bộ của model. Client chỉ thêm bước khi nhận event, không chạy tiến trình giả theo bộ đếm giờ. Event `delta` mang văn bản model, heartbeat giữ kết nối khi chờ, `answer` chứa văn bản/citations/evaluations/conversationId, rồi `done`. Lỗi sau khi mở stream là event `error`, không phải câu trả lời của trợ lý và không được lưu như assistant. Client xóa bản nháp, cho thử lại và không coi HTTP 200 đơn thuần là thành công. Nút dừng hủy yêu cầu đang chờ; chuyển hội thoại loại bỏ kết quả đến muộn.

`embed:true` luôn dùng khách không lưu hội thoại, dù trình duyệt gửi kèm cookie đăng nhập. Muốn xem thông tin riêng phải mở website chính. Hội thoại người dùng đăng nhập được sở hữu bằng HMAC của account ID lấy từ phiên, còn khách theo hash phiên. Client không gửi owner ID.

Mọi câu trả lời, gồm lời chào, yêu cầu làm rõ, thiếu nguồn/dữ liệu, từ chối truy cập hoặc yêu cầu đăng nhập, đều gọi model một lần và dùng đúng văn bản model trả về. Không có nhánh trả lời mẫu hoặc fallback evidence. Khi chưa cấu hình model, chat báo lỗi cấu hình. Máy chủ chuẩn bị căn cứ dạng `{kind,facts}`, kiểm tra quyền và chọn nguồn trước khi gọi; model không được chọn sinh viên hay thay đổi kết quả nghiệp vụ. Câu hỏi tiếp nối dùng chủ đề đã lưu phía máy chủ. Model nhận tối đa 8 tin nhắn gần nhất, tổng 6.000 ký tự, mỗi tin tối đa 1.500 ký tự của chính chủ hội thoại; lịch sử không phải căn cứ nghiệp vụ. Client không được gửi lịch sử hoặc chủ đề tùy ý. Khung nhúng không nhập lịch sử từ conversation ID.

`modelMessages()` là điểm dựng message chung cho cả provider môi trường và toàn bộ pool. Mỗi completion chat hoặc gửi thử có đúng một system message dùng `MODEL_SYSTEM_PROMPT`, chứa danh tính NAU AI, Trường Đại học Nghệ An, hai đại thi hào thuộc K12A3 là Lê Anh Quốc và Nguyễn Văn Thương; sau đó mới đến user payload có câu hỏi/ngữ cảnh/căn cứ. Các model thêm vào pool tự đi qua đường này, không có prompt riêng theo provider. Liệt kê model và embedding không sinh câu trả lời nên không dùng system prompt chat.

Câu hỏi “mày/mayf là model gì”, “bạn dùng mô hình nào”, “ai tạo/phát triển NAU AI” và các biến thể có từ đệm được phân loại là hội thoại danh tính và không chạy tìm nguồn trường. Model phải giữ danh tính sản phẩm là NAU AI, không tự xưng bằng model/provider nền; cách diễn đạt, ngắt câu, độ dài và xưng hô do model tạo theo câu hỏi. Output của lượt hỏi danh tính/model/nguồn gốc được buffer cho đến khi validator xác nhận riêng từng dữ kiện NAU AI, Trường Đại học Nghệ An, đại thi hào, K12A3, Lê Anh Quốc và Nguyễn Văn Thương, đồng thời không chứa tên model/provider cố định hoặc tên upstream động của lượt gọi. Nếu không đạt, API gửi `error`, không gửi `delta` và không lưu assistant. API vẫn trả `model`/`providerName` dưới dạng metadata kỹ thuật cho giao diện quản trị.

Phạm vi chat là tư vấn sinh viên NAU. Yêu cầu rõ ràng về viết/sửa code, website, ứng dụng hoặc sản phẩm phần mềm được gắn `kind:out_of_scope` trước các nhánh tìm nguồn và dữ liệu riêng; nhắc đến NAU, sinh viên hoặc môn học không mở rộng phạm vi. Trả lời chuyển hướng vẫn do model đang chọn tạo. Trạng thái `scope:out_of_scope` được lưu trên câu trả lời để các câu như “tiếp tục” không nối lại sản phẩm cũ; lịch sử cũ chưa có nhãn được nhận diện từ yêu cầu người dùng gần nhất. Một chủ đề tư vấn mới như học phí hay chọn ngành sẽ thoát trạng thái này.

Với yêu cầu ngoài phạm vi, khoảng trống nguồn và câu chưa rõ ý, văn bản model được giữ lại đến khi kiểm tra xong. Bộ lọc hẹp chặn code fence có ngôn ngữ, HTML có thể thực thi và một số cú pháp nguồn có tín hiệu cao. Khi bị chặn, API gửi `error`, không gửi `delta`, không lưu assistant và không thay bằng câu trả lời mẫu. Đây là hàng rào cho lỗi đã biết, không phải bộ phân loại ngữ nghĩa đầy đủ; chính sách hệ thống của model vẫn chịu trách nhiệm với các chủ đề ngoài phạm vi khác.

Chuyển sang hỏi quy chế/thông tin chung không mang theo yêu cầu xem điểm cá nhân trước đó. Môn được nêu trong câu hiện tại được ưu tiên hơn môn cũ. Câu giả định thiếu PI đưa tình trạng chưa đủ dữ liệu vào căn cứ cho model, không coi PI thực tế trong hồ sơ là dữ kiện của giả định. Câu trả lời có căn cứ về PI được giữ lại đến khi kiểm tra xong các mẫu diễn giải nhầm thiếu PI thành trượt; nếu phát hiện, trả event `error`, không lưu câu sai và không thay bằng căn cứ. Đây là bộ lọc lỗi diễn đạt đã biết, chưa phải kiểm chứng mọi khẳng định của model. Các câu trả lời cũ đã lưu không tự được viết lại.

SSE gửi thử pool dùng `status`, `delta`, `result` và có thể `error`. Client phải đọc `result.ok`; HTTP 200 không đảm bảo API upstream đã thành công. Chỉ lần test completion thành công đúng `revision` mới cho phép chọn cấu hình dùng cho chat. Kết quả chat có thêm `providerId`, `providerName` khi dùng pool, cùng `mode:pool` và `model`; lỗi không có event `answer`. Hợp đồng kiểu dữ liệu ở `packages/domain/src/api-pool.ts`, hướng dẫn và giới hạn tại [pool API](api-pool.md).

Thêm nguồn chấp nhận `title`, `url`, `topic`, `kind:html|pdf`, `admissionAfter` và `effectiveFrom` là ngày ISO hoặc null. Chỉ HTTPS từ danh sách host chính thức/được liên kết đã kiểm tra. Tải có kiểm tra DNS, pin IP công khai, kiểm tra mọi redirect, giới hạn 15 MB và 20 giây chờ mạng. Nội dung mới không tự được index. Mẫu danh sách/điểm/hồ sơ cá nhân bị loại. Đây là hàng rào kỹ thuật bổ sung; người duyệt vẫn phải kiểm tra nội dung gốc.
