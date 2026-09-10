# Model, embedding và ngân sách

## Quản lý nhiều API trong giao diện

Dùng **`/admin/api-pool`** để thêm OpenAI, Gemini, OpenRouter, Ollama, vLLM hoặc API tương thích; tải model, gửi thử streaming và chọn dùng ngay cho chat. Key lưu mã hóa phía máy chủ. Pool đã bật được ưu tiên hơn provider môi trường bên dưới; tắt pool sẽ quay về cấu hình `.env`. Xem [hướng dẫn pool API](api-pool.md), bao gồm ngân sách, phạm vi mạng và kiểm chứng với server thực tế.

Provider môi trường và pool dùng chung `modelMessages()` cùng một system prompt nhận diện NAU AI. Vì vậy thay model simple/complex, round robin hoặc thêm profile không cần sao chép prompt. Adapter chat mới viết trong mã nguồn cũng phải gọi builder này; kiểm thử outbound sẽ phát hiện hai đường production hiện có nếu thiếu system message.

## Chưa cấu hình model môi trường

```dotenv
LLM_PROVIDER=evidence
EMBEDDING_PROVIDER=none
```

Với cấu hình này, cần bật một API đã thử trong pool để chat hoạt động. Mọi câu trả lời phải do model tạo; nếu chưa có model, chat báo lỗi cấu hình. Kho nguồn, hồ sơ và bộ đối chiếu nghiệp vụ vẫn xem được. Nguồn đã duyệt được tìm bằng PostgreSQL full-text search trên văn bản bỏ dấu; đây không phải tìm kiếm ngữ nghĩa.

## OpenAI

```dotenv
LLM_PROVIDER=openai
OPENAI_API_KEY=your-server-side-key
LLM_SIMPLE_MODEL=gpt-5.6-luna
LLM_COMPLEX_MODEL=gpt-5.6-terra
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
MONTHLY_BUDGET_USD=20
MAX_REQUEST_COST_USD=0.20
```

Khởi động lại API. Từ quản trị, chọn **Tạo lại chỉ mục**. Chat gửi câu hỏi, lịch sử giới hạn và căn cứ đã được kiểm tra quyền, không gửi toàn bộ hồ sơ hay cho model chọn sinh viên. Kết quả nghiệp vụ có cấu trúc và nguồn được giữ riêng. Model diễn giải cả tình trạng thiếu dữ liệu/mâu thuẫn theo kết quả đối chiếu; không được tự kết luận chắc chắn hơn dữ liệu hiện có.

API Chat Completions dùng `store:false`, timeout 25 giây, không tự retry để tránh phát sinh lượt phí khó kiểm soát. `store:false` không có nghĩa nhà cung cấp tuyệt đối không lưu dữ liệu theo chính sách dịch vụ. Thiết lập lưu giữ của tài khoản cần được xác nhận khi xử lý dữ liệu thật.

## Chế độ nội bộ

```dotenv
LLM_PROVIDER=local
LOCAL_LLM_URL=http://localhost:11434/v1
LOCAL_LLM_MODEL=qwen3.5:9b
EMBEDDING_PROVIDER=local
LOCAL_EMBEDDING_URL=http://localhost:8080/v1
EMBEDDING_MODEL=BAAI/bge-m3
EMBEDDING_DIMENSIONS=1024
```

Ollama hoặc vLLM phục vụ giao thức OpenAI-compatible. Endpoint embedding cần trả vector đúng kích thước; BGE-M3 phải được máy chủ embedding hỗ trợ. Nếu chưa có dịch vụ embedding nội bộ, dùng `EMBEDDING_PROVIDER=none` để tìm từ khóa.

Không có fallback sang API ngoài. Cấu hình `LLM_PROVIDER=local` với embedding OpenAI bị từ chối. Khi model lỗi, giao diện báo lỗi và cho thử lại, không hiển thị căn cứ như một câu trả lời thay thế. Endpoint nội bộ phải do quản trị cấu hình; không nhận từ câu chat.

Hybrid search xếp hạng từ khóa và khoảng cách cosine bằng reciprocal rank fusion, sau khi lọc trạng thái/phạm vi/thời gian. Embedding được gắn model và dimensions; truy vấn không dùng vector khác model. Đổi model phải tạo lại chỉ mục. Không tự trộn vector cũ và mới.

## Đo chi phí

Máy chủ dự phòng một khoản trước khi gọi dịch vụ bằng cập nhật PostgreSQL nguyên tử. Thống kê lưu model, input/output token, phí thực tế và trạng thái. Lỗi không xác định usage giữ mức dự phòng như chi phí ước tính để tránh báo chi tiêu thấp hơn thực tế. Giới hạn API timeout, giới hạn đầu ra và độ dài câu hỏi được áp dụng. Mức giá cấu hình phải khớp model đang dùng; đổi model phải cập nhật giá cùng lúc. Có thể cấu hình thêm giới hạn chi tiêu tại tài khoản nhà cung cấp.

Giả định 20 câu/sinh viên/tháng, mỗi câu tổng cộng 6.000 input + 1.000 output token tính phí, giá đã khảo sát ngày 06/09/2026:

| Model                                                                  | Input/output USD / 1M | 120 SV    | 3.000 SV  |
| ---------------------------------------------------------------------- | --------------------- | --------- | --------- |
| GPT-5.6 Luna                                                           | 0,20 / 1,20           | 5,76 USD  | 144 USD   |
| GPT-5.6 Terra                                                          | 2 / 12                | 57,60 USD | 1.440 USD |
| Gemini 3.5 Flash-Lite (có preset tương thích, chưa đo model trực tiếp) | 0,30 / 2,50           | 10,32 USD | 258 USD   |

90% Luna + 10% Terra tương ứng khoảng 10,94 / 273,60 USD mỗi tháng. Chưa gồm host, embedding, OCR, thuế, lượt gọi phát sinh. Đây là dự toán, không phải số đo của bản thử nghiệm. Giá cần kiểm tra lại khi triển khai: [OpenAI](https://developers.openai.com/api/docs/pricing), [Google](https://ai.google.dev/gemini-api/docs/pricing).

Tài liệu chính thức: [OpenAI Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra), [embedding](https://developers.openai.com/api/docs/models/text-embedding-3-small), [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility), [BGE-M3](https://huggingface.co/BAAI/bge-m3).
