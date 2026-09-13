# Kiểm chứng bản thử nghiệm

Các báo cáo máy sinh ở `reports/` được bỏ qua bởi Git. Không dùng kết quả của chế độ evidence để tuyên bố model AI đã đạt chất lượng trên dữ liệu thật.

## FAQ sinh viên — 13/09/2026

- Danh mục 60 câu hỏi/12 nhóm; 54 câu công khai, 6 câu cần hồ sơ. Có thêm 8 nguồn HTML chính thức đã kiểm tra: biểu mẫu hành chính/học tập/chính sách/KTX, đầu mối hỗ trợ sinh viên, thư viện, hướng nghiệp và dịch vụ số. Chỉ xác nhận phạm vi trang đã đọc; không coi tệp Word đính kèm, danh sách cá nhân hoặc thông tin về phí/hạn chưa xác minh là căn cứ.
- 132/132 kiểm thử backend, typecheck và production build đạt. Bộ 200 fixture kỹ thuật hiện có vẫn đạt 200/200. Bộ FAQ kiểm tra định tuyến cho toàn bộ danh mục, trường hợp diễn đạt khác, nguồn theo từ viết tắt, quyền riêng tư và chuyển chủ đề; không đánh giá độ chính xác của model thật.
- 20/20 luồng Chrome đạt trên production build local với dữ liệu biệt lập và HTTP model fixture. Hai luồng mới kiểm tra tìm kiếm không dấu, lọc chủ đề trên mobile, không tràn ngang, mã FAQ không hợp lệ và mở bản nháp không tự gửi request.
- `npm run evaluate:faq` tạo báo cáo 60 câu: 42 câu công khai có nguồn liên quan cần rà soát đáp án, 12 câu công khai chưa tìm được nguồn phù hợp, 6 câu cần dữ liệu riêng. Đây là mức bao phủ tìm nguồn từ seed; **không phải 42 đáp án đã đúng hoặc đầy đủ**. Xem `docs/student-faq.md` và `reports/student-faq-coverage.json`.
- Kiểm tra production phát hiện hai vấn đề: model thêm đầu mối hỗ trợ không có trong căn cứ; bộ đọc HTML xóa cả `form` ASP.NET nên tám nguồn mới có bản trích xuất rỗng sau đồng bộ. Đã bổ sung chỉ dẫn giới hạn thông tin dịch vụ; sửa bộ đọc để giữ nội dung trong form, loại trường nhập, từ chối bản rỗng và thử lại snapshot rỗng cũ dù hash không đổi. Tám ca hồi quy ingestion cùng ba ca security đạt; 13 ca storage/FAQ đạt. Prompt không bảo đảm model luôn tuân thủ: các lượt thiếu nguồn vẫn có câu gợi ý đầu mối chưa được xác minh và phải ghi nhận khi chấm chất lượng.
- Trước sửa ingestion, ba lượt công khai qua pool thật trả về với nguồn, không ép đăng nhập, gồm giấy xác nhận, KTX và lịch học; hai luồng FAQ Chrome trên `https://foxllm.wtf` đạt. Đây chỉ là smoke test tích hợp, không phải kết quả đánh giá toàn bộ 60 câu hoặc chứng nhận độ chính xác tư vấn.

## Danh tính model dùng chung — 10/09/2026

- Phạm vi kiểm chứng mới gồm hai đường sinh câu trả lời: provider môi trường và pool. Request HTTP phải có đúng một system message bằng `MODEL_SYSTEM_PROMPT`; model thêm sau qua pool phải tiếp tục dùng `modelMessages()` thay vì dựng prompt riêng.
- Các cách hỏi như “mày/mayf là model gì”, “bạn dùng mô hình nào”, “đây là model gì”, “AI nào đang trả lời tôi” và “ai tạo/phát triển NAU AI” phải đi vào intent danh tính/nguồn gốc. Câu trả lời vẫn do model tự diễn đạt và có thể đổi thứ tự hoặc ngắt câu; validator kiểm tra riêng các dữ kiện NAU AI, Trường Đại học Nghệ An, đại thi hào, K12A3, Lê Anh Quốc và Nguyễn Văn Thương.
- Ca model trả thiếu danh tính hoặc tự xưng bằng GPT/OpenAI/ChatGPT, tên provider phổ biến, tên model ngắn hay model/provider động của chính lượt gọi phải kết thúc bằng lỗi vận hành, không có `delta` và không lưu assistant.
- Kết quả cuối: 87/87 kiểm thử Node, 200/200 fixture kỹ thuật, typecheck, API production build và định dạng đạt; 15/15 luồng Chrome đạt. Ca Chrome hồi quy dùng đúng chuỗi sai `GPT 5.5, OpenAI.` và xác nhận không có bong bóng assistant hoặc bản nháp. Một lượt ProxyLLM thật gặp lỗi upstream trước khi sinh nội dung và không được lưu; yêu cầu độc lập tiếp theo trả đúng danh tính qua các bước `reasoning → generating → validating`, lưu tại hội thoại `5a108443-023d-428e-abb1-1eb931375332`. Đây là kiểm tra tích hợp có giới hạn; bộ 200 fixture không gọi model thật.

## Giới hạn đúng vai trò tư vấn — 09/09/2026

- Đã tái hiện hội thoại `622f876f-ed76-424a-856f-f525eb5112b8`: câu “viet code html web ban hang co ban” từng nhận cả trang HTML vì prompt cho phép trò chuyện tổng quát. Hội thoại gốc được giữ nguyên để làm bằng chứng hồi quy.
- Sau sửa, 82/82 kiểm thử Node, 200/200 fixture kỹ thuật, typecheck và định dạng đạt. 13/13 luồng Chrome đạt, gồm ca viết web → “tiếp tục”, model cố phát HTML nhưng không xuất hiện ở bản nháp/không được lưu, rồi chuyển sang hỏi học phí thành công.
- Kiểm tra thật giới hạn qua ProxyLLM/gpt-5.5 có 9 câu trả lời thành công: lời chào gõ sai, yêu cầu HTML trực tiếp/tiếp nối/cố gắn NAU, chọn ngành CNTT, học phí, yêu cầu làm thơ và hai hồ sơ học vụ. Ba yêu cầu phần mềm đều được model chuyển hướng; yêu cầu thơ cũng được chuyển hướng; chọn ngành và học phí vẫn được hỗ trợ. `xin chafo` được nhận là lời chào với đúng hai bước `reasoning → generating`, không chạy tìm nguồn. Hồ sơ `sv007` giữ trạng thái PI F/chưa đạt, `sv031` giữ trạng thái thiếu PI/chưa đủ dữ liệu. Một lần gọi hồ sơ gặp lỗi upstream tạm thời rồi lượt gọi mới thành công; ứng dụng không tự fallback.
- Bản kiểm tra có thể mở tại `http://localhost:3000/?conversation=6dc59bde-f3b4-4c4e-8745-8c2ff1e3296d`. Báo cáo cục bộ ở `reports/scope-live.json`, `reports/scope-live-final.json` và ảnh `reports/screenshots/scope-live-chat.png`. Đây là kiểm tra hồi quy có giới hạn, chưa phải đánh giá chất lượng model trên 200 câu.

## Chat hoàn toàn dùng model — 07/09/2026

- 72/72 kiểm thử Node và 200/200 fixture kỹ thuật đạt. Fixture chat dùng model giả lập có nhãn để kiểm tra căn cứ, số lần gọi và quyền; không phải đánh giá chất lượng AI thật.
- 12 luồng Chrome đã qua: cả lời chào/câu chưa rõ ý đều gửi upstream; kiểm tra thiếu PI, phân quyền, sự kiện tiến trình, streaming, lỗi/thử lại, dừng và đổi hội thoại, mobile/embed. Các fixture HTTP khôi phục pool của người dùng sau kiểm tra.
- Kiểm tra thật 5 lượt qua ProxyLLM/gpt-5.5 thành công, gồm lời chào, giao tiếp tự nhiên, quy chế, hồ sơ thiếu PI và câu giả định. Đã thấy loading trước khi hoàn tất trên Chrome; SSE không còn bị gzip giữ lại. Đây là kiểm chứng giới hạn, chưa phải bộ đánh giá 200 câu bằng model thật.
- Typecheck và định dạng đạt. `scripts/load.ts` nay dùng HTTP model fixture biệt lập; smoke test 120 hồ sơ với 3 yêu cầu mỗi cấu hình chạy đạt, chưa đo lại throughput với model thật.

Chat hiện không trả mẫu/evidence khi model lỗi hoặc chưa cấu hình; giao diện báo lỗi và cho thử lại. Các số đo evidence bên dưới là lịch sử trước thay đổi này, không đại diện cho độ trễ chat hiện tại.

## Bổ sung pool API ngày 07/09/2026

- 47/47 kiểm thử Node, gồm 9 ca mới cho pool: mã hóa/key không lộ, DNS/IP và redirect, liệt kê model, HTTP streaming/usage, xác nhận giá/ngân sách, thay phiên bản, thủ công/round robin, cô lập chế độ nội bộ, lỗi API, timeout cả stream và số yêu cầu đồng thời.
- 200/200 fixture tiếng Việt tiếp tục đạt ở evaluator + chat evidence.
- 8/8 luồng Chrome trên bản standalone đã biên dịch, gồm luồng mới tạo cấu hình → tải/chọn model → gửi thử → bật cho chat có nguồn → khôi phục lựa chọn → xóa cấu hình qua giao diện. Kiểm tra khách/sinh viên bị từ chối API quản trị, mobile không tràn và sidebar đóng đúng.
- Typecheck, build Next/Nest, kiểm tra định dạng và `npm audit --omit=dev` đạt. Khi build lại trên Windows, dừng bản standalone đang chạy trước để tránh khóa thư mục `.next/standalone`.

Pool được kiểm tra với **HTTP fixture có nhãn dữ liệu giả**, chưa gọi tài khoản OpenAI/Gemini/OpenRouter có phí hoặc máy chủ Ollama/vLLM của người dùng. Chưa benchmark throughput của model thật. Xem [hướng dẫn kết nối và giới hạn](api-pool.md).

## Đã đo ngày 06/09/2026 trên Windows / Node 25

- 38 kiểm thử: nghiệp vụ, biên làm tròn/điểm danh, PI thiếu/mâu thuẫn/điểm chữ không hợp lệ, quy chế sai khóa, seeder 120/3.000, nguồn URL/PII, ngân sách đồng thời, lọc vector/phiên bản, dọn dữ liệu, chỉ dẫn độc hại trong nguồn và adapter model streaming với máy chủ giả lập nội bộ.
- 200/200 fixture tiếng Việt ở chế độ evaluator + chat evidence. Đáp án kỹ thuật chưa được trường duyệt.
- 7/7 luồng Playwright Chrome: chat có nguồn, hồ sơ điểm 6,2/PI F, các tab cá nhân, thiếu PI/quy chế chuyển tiếp, API/chat/lịch sử/feedback giữa A/B, đăng xuất, khác origin, tác vụ chưa có handler, mobile và embed.
- TypeScript, production build Next/Nest, kiểm tra định dạng Prettier đều đạt; `npm audit --omit=dev` không ghi nhận lỗ hổng tại thời điểm kiểm tra. Bản standalone đã chạy bằng `npm start` và đạt 7 luồng Playwright. Bộ tải HTTPS đã đọc được HTML từ `https://nau.edu.vn/`. Khi có sửa mới, chạy lại kiểm tra liên quan trước khi sử dụng báo cáo cũ.

## Frontend release và chuẩn bị VPS — 2026-09-10

Tiêu đề trang đăng nhập đã đổi từ text xen kẽ `<br>` sang ba phần tử khối `span/span/em`. HTML server và cây DOM sau hydration vì vậy có cùng cấu trúc và không còn đuôi khoảng trắng `&#x20;`. Kiểm thử hồi quy đọc cả response HTML, cấu trúc child node và lỗi browser.

Next production build prerender đủ 8 route. Chrome production kiểm tra `/`, `/login`, `/knowledge`, `/student`, `/admin`, `/admin/api-pool` và `/embed` ở desktop/mobile: HTTP 200, không hydration/console/page error, không ảnh lỗi và không tràn ngang. Bộ E2E hoàn chỉnh đạt 17/17 sau thay đổi, gồm cả trường hợp mật khẩu demo VPS khác preset local: giao diện không tự điền sai và yêu cầu mật khẩu do quản trị viên cấp.

Compose bổ sung health check cho web, thứ tự khởi động Caddy theo service healthy và xoay log. Bộ deploy có script chuẩn bị env không in secret, preflight, build/up với HTTPS health check và gói release loại `.env`/dữ liệu local. Máy hiện tại không có Docker, nên cú pháp shell và package được kiểm tra local còn image/Compose/Caddy/OCR phải chạy xác nhận trên VPS staging.

Audit release phát hiện Multer 2.2.0 do NestJS ghim gián tiếp có ba cảnh báo DoS mức high. Dependency đã được override lên Multer 2.3.0; `npm ls` hợp lệ, API build/runtime smoke check đạt và `npm audit --omit=dev` không còn lỗ hổng đã biết.

Kết quả tải HTTP, mỗi ô 100 yêu cầu trộn chat công khai và đối chiếu riêng, dữ liệu biệt lập:

| Hồ sơ | Đồng thời | Lỗi   | p95 hoàn tất |
| ----- | --------- | ----- | ------------ |
| 120   | 10        | 0/100 | 109 ms       |
| 120   | 25        | 0/100 | 238 ms       |
| 120   | 50        | 0/100 | 408 ms       |
| 3.000 | 10        | 0/100 | 94 ms        |
| 3.000 | 25        | 0/100 | 212 ms       |
| 3.000 | 50        | 0/100 | 406 ms       |

Đây là thử tải ngắn trên máy local, PostgreSQL nhúng, provider evidence. Rate limit chỉ được nâng trong tiến trình dữ liệu giả biệt lập để đo throughput. Không bao gồm độ trễ model, embedding, OCR, Redis/worker server, mạng người dùng và tải kéo dài. Không suy ra cam kết phục vụ 3.000 người đồng thời từ số lượng hồ sơ.

## Cần đánh giá ở giai đoạn tiếp theo

- Nhà trường duyệt đáp án, phạm vi theo khóa và điều kiện PI/thực hành; thêm ngôn ngữ sinh viên dùng thực tế, câu hỏi nhiều lượt, cách gọi tắt và thiếu thông tin.
- Model thật: kiểm tra kết luận/điểm/số tiền/điều khoản được giữ đúng, nguồn thực sự hỗ trợ nội dung, không khẳng định khi thiếu căn cứ. Mục tiêu ≥95% grounded QA sau rà soát; ca nghiệp vụ xác định và phân quyền phải 100%.
- Ca tài liệu độc hại: yêu cầu đổi vai trò, tiết lộ bí mật, dùng endpoint tùy ý nằm trong nguồn không được thực hiện. Quyền vẫn do máy chủ quyết định. Nội dung model luôn là văn bản thuần, không thực thi HTML.
- Kiểm tra SSO với issuer được cấp; đối soát adapter SIS với hồ sơ mẫu đã cho phép, lỗi timeout, tài khoản chưa ánh xạ và mất quyền.
- Chạy Compose, OCR PDF quét tiếng Việt, snapshot nguồn thay đổi, phục hồi backup và benchmark staging bằng cùng model/embedding định triển khai.

Các ca thi lại/học cải thiện hiện có đáp án `insufficient`: chưa chọn điểm hoặc áp dụng trần khi chưa có xác nhận chính thức. Đây là hành vi thận trọng có kiểm thử, chưa phải triển khai đầy đủ mọi thuật toán thi lại.
