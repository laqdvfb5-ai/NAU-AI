# Pool API và model

Trang **`/admin/api-pool`** dành cho quản trị viên quản lý nhiều kết nối AI, kiểm tra trực tiếp qua HTTP và chọn API phục vụ website cùng khung nhúng. Cấu hình có hiệu lực ở yêu cầu mới, không cần khởi động lại. Pool mặc định tắt, ứng dụng tiếp tục dùng `LLM_PROVIDER` trong `.env`.

## Gắn API thật

1. Chạy `npm run build` rồi `npm start` hoặc `npm run dev`. Mở http://localhost:3000/admin/api-pool. Đăng nhập `admin`, mật khẩu tại `ADMIN_PASSWORD` trong `.env`.
2. Bấm **Thêm cấu hình API**, chọn mẫu, đặt tên và nhập base URL. Nhập API key của tài khoản dịch vụ nếu cần. Có thể để trống model lúc lưu bản nháp.
3. Bấm **Tải model**, sau đó **Sửa** và chọn model từ danh sách máy chủ; cũng có thể nhập model ID trực tiếp nếu dịch vụ không hỗ trợ liệt kê. Xác nhận quyền truy cập model và giá input/output hiện hành, tính bằng USD trên một triệu token. Chỉ nhập 0 nếu dịch vụ thực sự không tính phí API. Lưu cấu hình.
4. Chọn cấu hình trong **Gửi thử đến server**, bấm **Gửi thử API**. Yêu cầu này gọi chính server đã chọn, có thể tính phí. Căn cứ mẫu là dữ liệu giả về điểm 6,2 và PI2.1 = F. Giao diện hiển thị văn bản streaming, thời gian token đầu, tổng thời gian, usage và chi phí. Nếu API không trả usage, chi phí được đánh dấu ước tính theo khoản dự phòng.
5. Khi thử thành công, chọn ứng viên cho cả **Câu hỏi thông thường** và **Câu hỏi tổng hợp**, chọn chiến lược nền và chế độ gateway, rồi bật pool. Lưu định tuyến cùng chính sách trong một lần và mở trang chat để kiểm tra. Quản trị viên nhìn thấy cấu hình và model đã phục vụ câu trả lời.

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

Danh sách model tải được không có nghĩa backend completion đang khỏe. Mã `UPSTREAM_ERROR` có thể đến từ HTTP 5xx hoặc từ một sự kiện lỗi nằm giữa stream HTTP 200; `TIMEOUT`, `RATE_LIMIT`, `AUTH_FAILED` và `INCOMPATIBLE_REQUEST` được hiển thị riêng. Ứng dụng chỉ trả thông báo đã chuẩn hóa và không đưa nội dung lỗi thô của nhà cung cấp ra chat.

`localhost` là máy đang chạy **API NestJS**, không phải máy trình duyệt. Khi API chạy Docker, dùng địa chỉ mạng riêng truy cập được từ container hoặc `host.docker.internal` nếu Docker đã cấu hình ánh xạ này. Kiểm tra cổng, firewall và model đã được tải ở Ollama/vLLM.

## Định tuyến và adaptive gateway

Mỗi nhóm câu hỏi là một lane độc lập: `simple` cho câu hỏi thông thường và `complex` cho câu hỏi cần tổng hợp. Danh sách ứng viên chỉ nhận cấu hình đang bật, đã gửi thử thành công ở đúng phiên bản và phù hợp phạm vi mạng. Chiến lược nền được giữ lại để có thể quay về hành vi cũ ngay:

- **Thủ công:** ở chế độ `off`, mỗi lane có đúng một cấu hình. Trong `shadow`, nếu lane có nhiều ứng viên thì yêu cầu thật vẫn dùng ứng viên đầu tiên.
- **Phân phối lần lượt:** yêu cầu thật đi theo con trỏ round-robin lưu trong database, bỏ qua ứng viên không đủ điều kiện trước khi gửi.

Adaptive gateway có ba chế độ:

| Chế độ   | Chọn provider cho yêu cầu thật         | Tính điểm và telemetry                             | Tự chuyển provider                                 |
| -------- | -------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| `off`    | Dùng chiến lược thủ công/round-robin   | Chỉ ghi số liệu vận hành; không chấm điểm adaptive | Không; một yêu cầu có một lần gọi                  |
| `shadow` | Giữ nguyên chiến lược nền              | Có, cho toàn bộ ứng viên đủ điều kiện              | Không; kết quả điểm không tác động lưu lượng       |
| `active` | Xếp hạng ứng viên theo điểm thích nghi | Có                                                 | Có, nhưng chỉ trước khi nhận phần văn bản đầu tiên |

`off` là mặc định, kể cả sau khi nâng cấp từ bản cũ. Tắt công tắc pool vẫn dùng provider từ `LLM_PROVIDER`; chính sách gateway không tự bật pool.

Điểm của một ứng viên là tổng có trọng số của năm thành phần đã chuẩn hóa:

- **Độ tin cậy:** tỷ lệ thành công có prior Beta(2,2), tránh xếp một provider mới lên mức hoàn hảo chỉ sau một lần gọi.
- **Độ trễ:** EWMA của tổng thời gian và thời gian tới token đầu tiên (TTFT).
- **Chi phí:** chi phí kỳ vọng theo giá input/output và trần token đã khai báo, so với các ứng viên cùng lượt.
- **Tải:** số lease đang hoạt động so với `maxConcurrent`.
- **Chất lượng:** bắt đầu từ prior 0–100 do quản trị viên đặt, sau đó dùng hậu nghiệm phản hồi của người dùng cho đúng provider/revision.

Trọng số được chuẩn hóa khi lưu. Tỷ lệ thăm dò có thể thỉnh thoảng chọn một ứng viên đủ điều kiện khác để thu thập tín hiệu thay vì luôn giữ ứng viên có điểm cao nhất. Khi câu trả lời nhận 👍/👎, gateway tính lại hậu nghiệm Beta từ toàn bộ phản hồi hiện có của provider/revision, với sáu quan sát giả neo quanh prior của quản trị viên; sửa một đánh giá không tạo thêm mẫu và một đánh giá đơn lẻ không thể áp đảo ngay các tín hiệu khác. Đây là tín hiệu hài lòng của người dùng, không thay thế bộ đánh giá độ đúng học vụ.

Trước khi chấm điểm, gateway áp dụng các điều kiện cứng: cấu hình còn bật và sẵn sàng, đúng revision, đúng phạm vi mạng, chưa vượt đồng thời, circuit cho phép, còn thời gian và ngân sách, đồng thời đáp ứng chính sách dữ liệu cá nhân. Ứng viên bị loại cùng lý do được hiển thị trong telemetry để quản trị viên phân biệt lỗi cấu hình với điểm thấp.

### Failover và circuit breaker

Ở chế độ `active`, gateway chỉ thử ứng viên kế tiếp khi lỗi có tính tạm thời như mất kết nối, timeout, rate limit, HTTP upstream, phản hồi rỗng, provider bận hoặc đang cooldown. Lỗi xác thực/cấu hình, vượt ngân sách và yêu cầu do phía gọi hủy không được tự gửi lại. Số lần thử bị chặn bởi `maxAttempts`, deadline chung và giới hạn chi phí bảo thủ cho toàn bộ chuỗi thử.

Gateway đánh dấu lần gọi là **committed** ngay khi nhận bất kỳ delta văn bản khác rỗng nào từ upstream, độc lập với việc giao diện có callback streaming hay không. Sau thời điểm đó, lỗi được trả về cho chat và không chuyển sang provider khác. Quy tắc này tránh ghép hai câu trả lời hoặc gửi lại dữ liệu sau khi một câu đã bắt đầu. Failover vì thế có nghĩa là **trước token đầu tiên**, không phải tiếp tục sinh từ provider thứ hai.

Trạng thái độ tin cậy, EWMA và circuit được lưu theo cặp `provider_id + revision`. Các lỗi vận hành liên tiếp tới ngưỡng cấu hình sẽ mở circuit; hết cooldown, gateway chỉ cho một lượt thăm dò half-open. Thành công đóng circuit và đặt lại chuỗi lỗi. Sửa endpoint, model, key hoặc tùy chọn làm tăng revision nên lịch sử lỗi cũ không làm ô nhiễm cấu hình mới.

Giới hạn đồng thời dùng lease có TTL trong database. Vì vậy nhiều tiến trình API cùng nhìn thấy tải và không vượt tổng `maxConcurrent`; lease hết hạn có thể được thu hồi nếu tiến trình chết giữa yêu cầu. Con trỏ round-robin, circuit, số liệu thích nghi, attempt và ngân sách đều được lưu trong database.

Health probe chủ động mặc định tắt (`probeIntervalMinutes = 0`) vì mỗi probe có thể phát sinh token và chi phí. Khi quản trị viên đặt khoảng thời gian lớn hơn 0, worker mới nhận claim probe trong database để tránh nhiều replica cùng kiểm tra một provider. Gửi thử thủ công vẫn là cách xác minh cấu hình và có thể dùng để kiểm tra lại circuit sớm.

### Ranh giới dữ liệu cá nhân

Mỗi cấu hình có cờ **Cho phép dữ liệu cá nhân** và một **trust group**; profile mới mặc định tắt quyền nhận dữ liệu cá nhân. Yêu cầu có hồ sơ sinh viên chỉ được gửi tới provider đã cho phép loại dữ liệu này. Nếu phải failover, ứng viên kế tiếp phải thuộc cùng trust group với provider đầu tiên; gateway không chuyển dữ liệu cá nhân sang một miền xử lý khác chỉ vì provider đó nhanh hơn hoặc rẻ hơn.

Trust group là nhãn ranh giới xử lý dữ liệu do quản trị viên chịu trách nhiệm cấu hình và kiểm chứng. Khi để trống, hệ thống gán một nhóm riêng theo ID của profile; hệ thống không suy nhóm từ hostname. Muốn cho phép failover dữ liệu cá nhân giữa nhiều profile, quản trị viên phải nhập rõ cùng một trust group cho từng profile sau khi xác minh chúng thực sự thuộc cùng miền xử lý dữ liệu. Các provider trong cùng nhóm vẫn phải có hợp đồng, khu vực lưu trữ và chính sách bảo mật phù hợp trước khi dùng dữ liệu thật. Telemetry attempt chỉ lưu ID yêu cầu kỹ thuật, lane, provider/revision, điểm, lý do chọn, trạng thái, mã lỗi, độ trễ, token và chi phí; không lưu prompt, căn cứ học vụ, API key hay mã sinh viên.

### Đưa vào dùng an toàn

1. Thêm từng provider, xác nhận giá và gửi thử thành công ở đúng model/revision.
2. Cấu hình `allowPersonalData` và trust group trước khi đưa provider vào lane cá nhân.
3. Bật pool với gateway `off` để xác nhận chiến lược nền và khả năng quay lui.
4. Chuyển sang `shadow`, giữ probe ở 0, rồi quan sát điểm, lý do loại, lỗi, TTFT, độ trễ và chi phí trên lưu lượng thật.
5. Chỉ chuyển sang `active` sau khi telemetry đủ ổn định; ban đầu giữ `maxAttempts` thấp và deadline phù hợp SLA.
6. Nếu có dấu hiệu bất thường, chuyển gateway về `shadow` hoặc `off`; thay đổi áp dụng cho yêu cầu mới và không cần khởi động lại.

Một lần gửi thử thành công ở phiên bản cấu hình hiện tại đánh dấu API **sẵn sàng phục vụ chat**. Lần gửi thử lỗi sau đó vẫn được hiển thị để chẩn đoán nhưng không xóa trạng thái sẵn sàng đã xác nhận; sửa model, endpoint, key hoặc tùy chọn sẽ tăng phiên bản và bắt buộc gửi thử thành công lại.

Pool tự động phải cùng phạm vi mạng. Với `LLM_PROVIDER=local`, mọi yêu cầu cloud bị chặn, kể cả gửi thử và tải model. Cấu hình gắn nhãn nội bộ chỉ được kết nối loopback/mạng riêng; nhãn không cho phép kết nối địa chỉ Internet. Các ứng viên trong cùng lane adaptive phải cùng phạm vi mạng.

Mỗi lần sửa cấu hình tăng phiên bản và xóa kết quả kiểm thử cũ. Muốn xóa, gỡ cấu hình khỏi cả hai lane trước; cấu hình có lease đang hoạt động không được sửa/xóa. Giới hạn hiện tại là 100 cấu hình, 20 API mỗi lane, 1–50 yêu cầu đồng thời trên từng cấu hình, timeout 1–120 giây và tối đa 8.192 output token.

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
