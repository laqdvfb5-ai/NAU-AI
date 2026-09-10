# Pool API và model

Trang **`/admin/api-pool`** dành cho quản trị viên quản lý nhiều kết nối AI, kiểm tra trực tiếp qua HTTP và chọn API phục vụ website cùng khung nhúng. Cấu hình có hiệu lực ở yêu cầu mới, không cần khởi động lại. Pool mặc định tắt, ứng dụng tiếp tục dùng `LLM_PROVIDER` trong `.env`.

## Gắn API thật

1. Chạy `npm run build` rồi `npm start` hoặc `npm run dev`. Mở http://localhost:3000/admin/api-pool. Đăng nhập `admin`, mật khẩu tại `ADMIN_PASSWORD` trong `.env`.
2. Bấm **Thêm cấu hình API**, chọn mẫu, đặt tên và nhập base URL. Nhập API key của tài khoản dịch vụ nếu cần. Có thể để trống model lúc lưu bản nháp.
3. Bấm **Tải model**, sau đó **Sửa** và chọn model từ danh sách máy chủ; cũng có thể nhập model ID trực tiếp nếu dịch vụ không hỗ trợ liệt kê. Xác nhận quyền truy cập model và giá input/output hiện hành, tính bằng USD trên một triệu token. Chỉ nhập 0 nếu dịch vụ thực sự không tính phí API. Lưu cấu hình.
4. Chọn cấu hình trong **Gửi thử đến server**, bấm **Gửi thử API**. Yêu cầu này gọi chính server đã chọn, có thể tính phí. Căn cứ mẫu là dữ liệu giả về điểm 6,2 và PI2.1 = F. Giao diện hiển thị văn bản streaming, thời gian token đầu, tổng thời gian, usage và chi phí. Nếu API không trả usage, chi phí được đánh dấu ước tính theo khoản dự phòng.
5. Khi thử thành công, chọn API cho cả **Câu hỏi thông thường** và **Câu hỏi tổng hợp**, bật pool rồi **Lưu lựa chọn cho chat**. Mở trang chat để kiểm tra. Quản trị viên nhìn thấy tên cấu hình và model trên câu trả lời có dùng pool.

**“Nhận được phản hồi từ API” chỉ xác nhận kết nối và khả năng trả văn bản.** Độ chính xác học vụ vẫn cần đánh giá riêng. Các ca thiếu dữ liệu, mâu thuẫn hoặc không đủ nguồn vẫn do model trả lời dựa trên trạng thái mà máy chủ đã xác định.

Gửi thử thành công chưa tự bật API cho chat: cần chọn hai nhóm câu hỏi và lưu lựa chọn ở bước 5. Mọi câu trả lời trong chat, kể cả lời chào, giới thiệu và yêu cầu làm rõ, đều dùng model và được tính vào usage/ngân sách. Prompt kèm lịch sử giới hạn của chính hội thoại và căn cứ mới của lượt hiện tại. Không có câu trả lời mẫu khi chưa cấu hình model hoặc khi model lỗi; giao diện báo lỗi và cho thử lại.

Mọi cấu hình hiện có và model thêm về sau qua pool đều đi qua `modelMessages()` và nhận cùng `MODEL_SYSTEM_PROMPT` như provider môi trường. Prompt giữ danh tính sản phẩm là NAU AI, trợ lý AI của NAU – Trường Đại học Nghệ An, được nghiên cứu và phát triển bởi hai đại thi hào K12A3 Lê Anh Quốc và Nguyễn Văn Thương. Model tự diễn đạt khi được hỏi, không có câu giới thiệu hardcode; đổi model hoặc provider không đổi danh tính này. Cùng builder message được dùng cho cả **Gửi thử** và chat thật. Trong chat, output của câu hỏi danh tính/model/nguồn gốc được buffer và kiểm tra đủ các dữ kiện trên, đồng thời không được tự xưng bằng tên provider/model nền; phản hồi không đạt không được stream hoặc lưu.

## Mẫu kết nối

| Mẫu             | Base URL mặc định                                         | Xác thực và giao thức                                                                                                                                                       |
| --------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI          | `https://api.openai.com/v1`                               | Bearer; Chat Completions streaming, `max_completion_tokens`. [Tài liệu](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) |
| Gemini          | `https://generativelanguage.googleapis.com/v1beta/openai` | Bearer; endpoint tương thích OpenAI. [Tài liệu](https://ai.google.dev/gemini-api/docs/openai)                                                                               |
| OpenRouter      | `https://openrouter.ai/api/v1`                            | Bearer; endpoint tương thích OpenAI. [Tài liệu](https://openrouter.ai/docs/api_reference/overview)                                                                          |
| Ollama          | `http://localhost:11434/v1`                               | Mặc định không key, mạng nội bộ. [Tài liệu](https://docs.ollama.com/api/openai-compatibility)                                                                               |
| vLLM            | `http://localhost:8000/v1`                                | Mạng nội bộ; chuyển sang Bearer nếu server đã bật key. [Tài liệu](https://docs.vllm.ai/en/latest/serving/openai_compatible_server/)                                         |
| API tương thích | Tự nhập                                                   | Cần hỗ trợ `/chat/completions` streaming; `/models` dùng để liệt kê nếu có.                                                                                                 |

Model ID lấy từ server hoặc tài liệu tài khoản, không dùng danh sách model giả. `/models` có thể chứa cả model không hỗ trợ chat: cần gửi thử đúng model. Preset là giá trị ban đầu; khả năng tương thích phụ thuộc phiên bản server/model. Trong tùy chọn nâng cao có thể đổi `max_tokens` / `max_completion_tokens`, bật/tắt `stream_options.include_usage` và gửi `store:false` khi server hỗ trợ. Chưa hỗ trợ giao thức riêng của Anthropic hoặc endpoint chỉ có Responses.

`localhost` là máy đang chạy **API NestJS**, không phải máy trình duyệt. Khi API chạy Docker, dùng địa chỉ mạng riêng truy cập được từ container hoặc `host.docker.internal` nếu Docker đã cấu hình ánh xạ này. Kiểm tra cổng, firewall và model đã được tải ở Ollama/vLLM.

## Lựa chọn và giới hạn

- **Thủ công:** một cấu hình cho mỗi nhóm câu hỏi; hai nhóm có thể dùng chung API.
- **Phân phối lần lượt:** chọn nhiều API đã kiểm tra cho mỗi nhóm. Con trỏ lượt lưu trong database. Bỏ qua cấu hình tắt, cần thử lại, đang đủ lượt đồng thời hoặc tạm nghỉ **trước khi gửi**.
- Mỗi yêu cầu chỉ gửi đến một API. Khi API đó lỗi, chat hiện lỗi và nút thử lại, không tạo câu trả lời thay thế và không tự gửi lại cùng dữ liệu sang API khác. Sau ba lỗi liên tiếp, cấu hình tạm nghỉ 30 giây; nút gửi thử cho phép kiểm tra lại sớm.
- Pool tự động phải cùng phạm vi mạng. Với `LLM_PROVIDER=local`, mọi yêu cầu cloud bị chặn, kể cả gửi thử và tải model. Cấu hình gắn nhãn nội bộ chỉ được kết nối loopback/mạng riêng; nhãn không cho phép kết nối địa chỉ Internet.
- Mỗi lần sửa cấu hình tăng phiên bản và xóa kết quả kiểm thử cũ. Cấu hình đang được chọn sẽ cần thử lại trước khi tiếp tục dùng. Muốn xóa, gỡ khỏi cả hai nhóm trước; đang xử lý yêu cầu thì không được sửa/xóa.
- Giới hạn 100 cấu hình, 20 API mỗi nhóm, 1–50 yêu cầu đồng thời trên từng cấu hình, timeout tổng 1–120 giây và tối đa 8.192 output token. Giới hạn đồng thời/tạm nghỉ hiện nằm trong **một tiến trình API**; cần cơ chế phân tán trước khi chạy nhiều replica. Ngân sách và con trỏ phân phối được lưu trong database.

## Key, dữ liệu và chi phí

`api_profiles` lưu cấu hình, phiên bản, kết quả test đã bỏ nội dung trả lời và key mã hóa AES-256-GCM. Khóa mã hóa được dẫn xuất từ `SESSION_SECRET`, gắn với ID cấu hình. API quản trị chỉ trả `hasKey`, không trả lại key hoặc ciphertext. Key không lưu trong localStorage hay bundle trình duyệt. Khi đổi origin phải nhập lại hoặc xóa key để tránh chuyển key cũ sang server khác.

**Sao lưu database cùng `SESSION_SECRET` ở nơi bảo mật.** Nếu thay secret, key cũ không giải mã được: nhập lại từng API key. Không có chức năng xuất key đã lưu. Quyền dùng pool là quyền quản trị; nguồn tài liệu và câu hỏi chat không được chọn endpoint, key hoặc sinh viên.

API cloud yêu cầu HTTPS và Bearer. Kết nối kiểm tra địa chỉ IP/DNS, pin địa chỉ đã kiểm tra và không theo redirect. Link-local/metadata, địa chỉ dành riêng và mạng sai phạm vi đều bị chặn. Server nội bộ có thể dùng HTTP trên mạng riêng do quản trị cấu hình.

Mỗi lần chat/test dự phòng chi phí theo số byte input và trần output trước khi gọi, rồi đối soát bằng usage. Thiếu usage hoặc lỗi sau khi dự phòng giữ khoản dự phòng như ước tính; đây không phải hóa đơn nhà cung cấp. Giá model do quản trị nhập, chưa tự đồng bộ bảng giá hoặc tính riêng cached tokens/chiết khấu. Giới hạn chung từ `MONTHLY_BUDGET_USD` và `MAX_REQUEST_COST_USD`; giá khai báo sai có thể làm dự toán sai. Thống kê tháng có lượt gọi, lỗi, token, độ trễ và chi phí theo cấu hình. Tải danh sách model không được tính là lượt completion.

Pool này quản lý **API sinh câu trả lời**. Embedding vẫn cấu hình riêng qua `.env`; đổi embedding phải tạo lại chỉ mục. Dữ liệu sinh viên giả vẫn ở bảng `students`, được tạo bởi hàm `generateStudents()` tại `packages/domain/src/index.ts` và lệnh `scripts/seed.ts`.

## Kiểm chứng

`tests/api-pool.test.ts` dùng database trong bộ nhớ và HTTP fixture biệt lập để kiểm tra mã hóa, quyền kết nối, model discovery, streaming, ngân sách, phiên bản cấu hình, hai nhóm định tuyến, round robin, lỗi xác thực, thiếu usage, timeout sau headers và giới hạn đồng thời. Fixture trả dữ liệu có nhãn kiểm thử; không phải một model đang suy luận.

`tests/e2e/api-pool.spec.ts` chạy Chrome để thêm cấu hình, tải/chọn model, gửi thử, bật dùng trong chat có nguồn, kiểm tra viewport mobile và từ chối khách/sinh viên truy cập API quản trị. Test khôi phục lựa chọn ban đầu và xóa cấu hình của chính nó khi kết thúc. Chỉ chạy E2E trên môi trường thử nghiệm vì test tạm đổi lựa chọn chat toàn ứng dụng.

Ngày 07/09/2026 đã xác nhận completion thật qua cấu hình ProxyLLM của người dùng, model `gpt-5.5`, với giá do người dùng cung cấp là 5 USD input / 30 USD output trên một triệu token. Kết quả này chỉ xác nhận cấu hình đã thử; các nhà cung cấp khác và Ollama/vLLM vẫn cần kiểm chứng bằng tài khoản/server tương ứng. Độ chính xác hội thoại cần kiểm tra riêng với bộ câu hỏi học vụ.
