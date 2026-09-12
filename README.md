# NAU AI — Trợ lý tư vấn sinh viên

Website tiếng Việt dành cho Trường Đại học Nghệ An, gồm chat công khai có nguồn, hồ sơ sinh viên, giải thích học vụ, quản trị và khung nhúng. **Bản hiện tại dùng dữ liệu giả; chưa kết nối hệ thống trường.**

Bản pilot đang chạy tại **https://foxllm.wtf**.

## Chạy trên máy cá nhân

Cần Node.js 24 trở lên. Không cần Docker hoặc khóa API để xem bản thử nghiệm.

```sh
npm ci
npm run setup
npm run dev
```

Mở **http://localhost:3000**. API: `http://localhost:4000/api/v1/health`.

Để chạy bản đã biên dịch: `npm run build`, sau đó `npm start`. Lệnh start web tự chép static/public vào thư mục Next standalone. Dùng `npm run dev` khi sửa mã để có cập nhật tự động.

| Tài khoản | Mật khẩu mặc định                 | Tình huống                                     |
| --------- | --------------------------------- | ---------------------------------------------- |
| `sv007`   | `NauDemo2026!`                    | CNTT khóa 2025; điểm 6,2 nhưng PI2.1 là F      |
| `sv019`   | `NauDemo2026!`                    | Đủ các điều kiện được mô phỏng                 |
| `sv031`   | `NauDemo2026!`                    | Thiếu PI, chưa đủ dữ liệu kết luận             |
| `sv001`   | `NauDemo2026!`                    | Khóa 2023, chưa xác minh quy chế chuyển tiếp   |
| `admin`   | Xem `ADMIN_PASSWORD` trong `.env` | Nguồn, quy chế, cờ tác vụ, thống kê và nhật ký |

Mật khẩu quản trị được sinh ngẫu nhiên khi chạy `setup`. `.env` không được đưa vào Git hoặc image Docker. Nếu đổi mật khẩu demo trong `.env`, dừng API rồi chạy lại lệnh seed.

## Các luồng đã có

- `/`: hỏi thông tin công khai, nguồn có thể bấm mở, hội thoại lưu theo chủ sở hữu, đánh giá câu trả lời, xóa hội thoại của mình.
- `/student`: điểm và điều kiện xét đạt; lịch học/thi; tài chính/rèn luyện; tiến độ/chứng chỉ và kiểm tra khả năng thực hiện tác vụ.
- `/knowledge`: nguồn đang dùng, nguồn chờ duyệt/chưa có, phạm vi và phiên bản.
- `/admin`: thêm nguồn, tải lại HTML/PDF, OCR qua worker, duyệt đoạn nội dung, tạo lại embedding, ghi nhận đối soát quy chế, bật/tắt cờ tác vụ, chi phí và nhật ký.
- `/admin/api-pool`: kho nhiều API/model với mẫu OpenAI, Gemini, OpenRouter, Ollama, vLLM và API tương thích. Lưu key mã hóa, tải model, gửi thử streaming, xem độ trễ/chi phí và điều phối thủ công, round-robin hoặc adaptive theo từng nhóm câu hỏi.
- `/embed`: chat công khai không cần cookie bên thứ ba. `public/widget.js` tạo nút nổi để nhúng. Đăng nhập mở website chính.
- `/api/v1`: NestJS API có phiên máy chủ, kiểm tra quyền ở mỗi yêu cầu, SSE, giới hạn lượt gọi và kiểm tra nguồn yêu cầu.

**Mọi câu trả lời trong chat đều do model AI tạo**, gồm lời chào, câu hỏi thiếu nguồn, thiếu dữ liệu, giới hạn truy cập và chuyển hướng yêu cầu ngoài phạm vi. NAU AI chỉ tư vấn về nhà trường, tuyển sinh, ngành học, học vụ và dịch vụ sinh viên; model không viết code, xây website, làm hộ bài chuyên môn hay sáng tác nội dung không liên quan. Yêu cầu tạo phần mềm được phân loại trước khi tìm nguồn hoặc đọc hồ sơ, kể cả khi nhắc tới NAU/sinh viên; câu tiếp nối không thể tiếp tục một sản phẩm ngoài phạm vi đã bị từ chối.

Mọi model sinh câu trả lời, từ provider môi trường đến các model hiện có hoặc thêm sau qua pool, đều đi qua `modelMessages()` và dùng chung `MODEL_SYSTEM_PROMPT`. Danh tính sản phẩm là **NAU AI, trợ lý AI của NAU – Trường Đại học Nghệ An, được nghiên cứu và phát triển bởi hai đại thi hào K12A3 Lê Anh Quốc và Nguyễn Văn Thương**. Khi hỏi danh tính, nguồn gốc hoặc model, câu trả lời vẫn do model đang chạy tự diễn đạt theo ngữ cảnh; máy chủ không trả một câu giới thiệu viết sẵn và tên model/provider nền không thay thế danh tính NAU AI. Riêng các lượt hỏi này, toàn bộ output được giữ lại để kiểm tra đủ danh tính và không lộ model/provider; câu sai không được stream hoặc lưu vào hội thoại.

Gắn API thật trong [pool API](docs/api-pool.md), hoặc cấu hình model môi trường theo [cấu hình AI](docs/ai-and-cost.md). Pool và adaptive gateway đều mặc định tắt; cần gửi thử thành công rồi chọn dùng cho chat. Gateway có `shadow` để tính điểm mà chưa đổi định tuyến và `active` để chọn theo độ tin cậy, độ trễ, chi phí, tải và chất lượng; phản hồi 👍/👎 cập nhật hậu nghiệm chất lượng của đúng provider/revision. Failover chỉ xảy ra với lỗi tạm thời trước delta văn bản đầu tiên; circuit, tải và lease được lưu trong database để nhiều tiến trình dùng chung. Yêu cầu có dữ liệu sinh viên chỉ đi qua provider được cho phép và không failover ra ngoài trust group. Profile để trống trust group được gán một nhóm riêng theo ID; chỉ các profile được nhập rõ cùng nhóm mới có thể failover dữ liệu cá nhân cho nhau. Health probe là tùy chọn, mặc định không chạy để tránh phát sinh chi phí bất ngờ.

Giá trị mặc định `LLM_PROVIDER=evidence` hiện chỉ giữ trạng thái chưa cấu hình model: hồ sơ/kho nguồn vẫn xem được, chat báo lỗi cấu hình cho đến khi có model. Khi API lỗi, chat báo lỗi và cho thử lại, không thay bằng câu mẫu hay trích xuất nguồn. Nội dung model ở các nhánh cần kiểm tra được giữ lại trước khi hiển thị; nếu model vẫn tạo mã nguồn, ứng dụng báo lỗi và không phát nội dung hoặc lưu câu trả lời đó. Giao diện có tiến trình theo các bước xử lý thật và streaming. Nguồn mặc định có 5 mục đang dùng và 2 khoảng trống kiến thức; đây chưa phải toàn bộ dữ liệu công khai của trường.

## Dữ liệu và nghiệp vụ

120 hồ sơ giả, 3 ngành × 4 khóa × 10 hồ sơ. Seeder xác định, có thể sinh 3.000 hồ sơ bằng cùng cơ chế. Số tiền, lịch, giảng viên, chương trình và đề cương là mô phỏng. Quy chế 620/2025 đã đối chiếu bản nguồn để làm mẫu, nhưng cần nhà trường xác nhận trước khi dùng với dữ liệu thật.

Dataset không nằm trong một file JSON tĩnh: hàm `generateStudents()` tại `packages/domain/src/index.ts` sinh dữ liệu; `scripts/seed.ts` ghi vào bảng `students`. Với cấu hình local, database nằm ở `.data/postgres`. Bộ câu hỏi và đáp án kiểm thử nằm ở `evals/vi-200.jsonl`.

Học phần **cốt lõi** và **bắt buộc** là hai thuộc tính độc lập. Bộ xử lý kiểm tra điểm tổng, PI, bài thực hành/báo cáo, số tiết vắng, trạng thái dự thi/chốt điểm và mâu thuẫn. Điểm 6,2 không đủ để qua học phần cốt lõi khi PI còn F. Thiếu dữ liệu, thi lại/cải thiện chưa đối soát hoặc chưa có quy chế đúng khóa sẽ trả `insufficient`. Kết quả kiểm tra không ghi đè kết quả trường ghi nhận.

```sh
# DỪNG API trước khi seed vào PostgreSQL nhúng đang dùng.
npm run seed -- --count=120
npm run seed -- --count=3000
```

Seed upsert hồ sơ và tài khoản, không xóa hội thoại hoặc hồ sơ dư. Dùng thư mục `DATA_DIR` khác nếu cần bộ dữ liệu có đúng số lượng sau khi từng seed nhiều hơn.

## Kiểm thử

```sh
npm test                 # nghiệp vụ, ranh giới, dữ liệu và kiểm tra URL/PII
npm run evaluate         # 200 fixture tiếng Việt → reports/evaluation.json
npm run typecheck
npm run build
# Khi web và API đang chạy, Chrome có sẵn:
npm run test:e2e
# Tự chạy API và DB biệt lập; không đụng dữ liệu demo hiện tại:
npm run load             # 120/3.000 hồ sơ × 10/25/50 yêu cầu đồng thời
```

Bộ `evals/vi-200.jsonl` là đáp án kỹ thuật có thể tái lập, **chưa được nhà trường duyệt và chưa phải đánh giá model trực tiếp**. `npm run evaluate` chạy bộ đối chiếu cho ca học vụ, chat cho ca nguồn/phân quyền. Kiểm thử trình duyệt kiểm tra API và lịch sử giữa hai tài khoản, đăng xuất, khác origin, khung nhúng và tác vụ chưa có handler. Xem [kế hoạch kiểm chứng và giới hạn](docs/validation.md).

## Cấu trúc

```text
apps/web/                 Next.js, giao diện và component chat dùng chung
apps/api/src/             NestJS, phiên, nghiệp vụ chat, nguồn, ingestion và provider
packages/domain/src/     Kiểu dữ liệu, interface, evaluator và seeder
evals/                    200 câu hỏi và đáp án kỳ vọng
tests/                    Kiểm thử nghiệp vụ, nguồn và trình duyệt
scripts/                  Setup, seed, đánh giá, tải và sao lưu
deploy/                   Caddy HTTPS, VPS preflight, release and deploy scripts
```

Local dùng PostgreSQL nhúng **PGlite + pgvector**, dữ liệu tại `.data/postgres`. Server dùng PostgreSQL + pgvector và Redis/BullMQ theo [triển khai](docs/deployment.md). Không chạy hai tiến trình cùng mở một thư mục PostgreSQL nhúng.

Tạo gói đưa lên Ubuntu bằng `powershell -File deploy/package-release.ps1`. Gói trong `reports/releases/` không chứa `.env`, database local, log hay dependencies đã build. Trên VPS, dùng `prepare-env.sh`, `preflight.sh` và `up.sh` theo tài liệu triển khai; máy chủ không cần cài Node.js/npm bên ngoài container.

Các interface tách ở `packages/domain/src/index.ts`: `StudentDataProvider`, `IdentityProvider`, `LLMProvider`, `EmbeddingProvider`, `AcademicEvaluator`, `ActionRegistry`. Xem [hợp đồng tích hợp](docs/integration.md) và [API](docs/api.md). Không có endpoint nội bộ NAU nào được phỏng đoán trong mã.
