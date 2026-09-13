# Danh mục câu hỏi sinh viên

Danh mục tại `packages/domain/src/student-faq.ts` gồm **60 câu hỏi thuộc 12 nhóm**, mỗi nhóm 5 câu. Có **54 câu hỏi công khai** và **6 câu hỏi cần dữ liệu cá nhân**. Phạm vi gồm tuyển sinh, học phí, học bổng, đăng ký môn, thi cử, thủ tục, tốt nghiệp và nghề nghiệp, dịch vụ số, thư viện, đời sống trong trường, sức khỏe và hỗ trợ, hoạt động và rèn luyện.

Đây là danh mục gợi ý câu hỏi và yêu cầu về nguồn. Các câu hỏi không chứng minh NAU đang cung cấp một dịch vụ, không phải tài liệu quy chế và không chứa câu trả lời viết sẵn. Không dùng chúng làm căn cứ để model khẳng định mức thu, thời hạn, địa chỉ, điều kiện hay tên đơn vị liên hệ.

## Cấu trúc dùng chung

Trang `/faq` tìm kiếm có dấu/không dấu và theo chủ đề. Liên kết `/?faq=<id>` điền câu hỏi đã biết vào ô chat, không tự gửi request. Sinh viên có thể sửa trước khi gửi. Các nguồn bổ sung ở `apps/api/src/faq-sources.ts` là tóm tắt trang HTML chính thức đã đọc ngày 13/09/2026; không chứa danh sách sinh viên và không khẳng định đã đọc các tệp Word đính kèm. Khởi động API bổ sung nguồn mới, không ghi đè nguồn quản trị đã sửa.

- `STUDENT_FAQ_CATEGORIES`: mã, tên và mô tả nhóm.
- `STUDENT_FAQ_QUESTIONS`: mã ổn định, nhóm, câu hỏi, các cách gọi/từ khóa tìm kiếm, `requiredSource` và `dataScope`.
- `StudentFaqCategoryId`, `StudentFaqCategory`, `StudentFaqQuestion`, `StudentFaqDataScope`: các kiểu được xuất từ `@nau/domain`.

`aliases` phục vụ tìm kiếm, gồm tiếng Việt có dấu, không dấu và từ viết tắt quen dùng. Không đưa thông tin bí mật, dữ liệu sinh viên hay đáp án vào trường này. Giữ mã câu hỏi ổn định khi sửa cách diễn đạt để liên kết giao diện và bộ đánh giá vẫn hoạt động.

`dataScope: personal` có nghĩa câu trả lời cần hồ sơ của người đang đăng nhập. Danh mục vẫn có thể hiển thị các câu hỏi đó công khai; việc chọn câu hỏi không cấp quyền đọc dữ liệu. Những câu hỏi hỏi chung về thủ tục như quên mật khẩu hoặc đối soát học phí vẫn mang phạm vi `public`. Nếu hội thoại chuyển sang kiểm tra một giao dịch hay hồ sơ cụ thể, hệ thống phải kiểm tra danh tính và quyền tại thời điểm truy cập dữ liệu.

## Rà soát và bổ sung nguồn

1. Dùng `requiredSource` làm danh sách tài liệu cần tìm, bắt đầu từ website trường và các trang hoặc tài liệu chính thức được trường liên kết. Với nội dung theo năm học, học kỳ, khóa hoặc ngành, ghi rõ phạm vi áp dụng.
2. Kiểm tra bản gốc, ngày hiệu lực, phiên bản, đơn vị công bố và trang/điều khoản. Tài liệu OCR, đường dẫn thanh toán và đầu mối liên hệ cần đối chiếu cẩn thận với bản gốc. Không suy ra thông tin còn thiếu từ câu hỏi mẫu.
3. Ghi nhận chủ đề chưa đủ nguồn hoặc nguồn hết hạn. Chỉ nhập tài liệu đạt yêu cầu vào kho kiến thức bằng quy trình quản trị hiện có; không coi danh mục câu hỏi là dữ liệu đã được trường xác nhận.
4. Tách dữ liệu cá nhân khỏi kho công khai. Không nhập danh sách điểm, số điện thoại cá nhân, hồ sơ trợ cấp, mật khẩu hoặc mã OTP. Việc một tài liệu nằm trên website công khai không làm mất yêu cầu bảo vệ dữ liệu cá nhân.
5. Khi có thông báo mới, đánh giá ảnh hưởng đến các câu hỏi cùng chủ đề, cập nhật nguồn/phiên bản và chạy lại các ca đánh giá liên quan. Với dịch vụ chưa xác nhận có tồn tại, câu trả lời phải thể hiện rõ việc chưa đủ thông tin.

Sau khi đưa nguồn seed lên máy chủ, cần tải bản gốc và duyệt phần trích dẫn đã đối chiếu để lưu dấu vân tay nội dung và liên kết. Seed chỉ chứa đoạn tóm tắt đã đọc, chưa có dấu vân tay của trang trên máy chủ. Lần tải đầu tiên chuyển nguồn sang chờ duyệt; những lần sau, nội dung hoặc liên kết có thay đổi cũng cần duyệt lại trước khi dùng. Không bật lại hàng loạt nguồn chờ duyệt bằng SQL hoặc đưa toàn bộ HTML vào câu trả lời. Dùng luồng duyệt nguồn để giữ phiên bản cũ, ghi nhật ký và lập chỉ mục đúng đoạn đã kiểm tra.

## Sinh câu trả lời và đánh giá

Chạy `npm run evaluate:faq` để tạo `reports/student-faq-coverage.json` và `reports/student-faq-cases.jsonl` trên database biệt lập. Báo cáo phân loại `source_gap`, `related_sources_require_answer_review` và `requires_authorized_records`. Nguồn liên quan không đồng nghĩa đủ căn cứ trả lời toàn bộ câu hỏi. Đây là báo cáo tìm nguồn từ bộ seed, không gọi model thật và không đọc kho production.

`tests/student-faq.test.ts` kiểm tra mọi câu mẫu vẫn đi qua model, câu thủ tục không bị ép đăng nhập/tra điểm cá nhân, viết tắt tìm đúng nguồn, chuyển chủ đề và quyền hồ sơ. `tests/e2e/faq.spec.ts` kiểm tra tìm không dấu, lọc nhóm trên mobile và mở bản nháp không tự gọi model.

Giao diện dùng danh mục để giúp sinh viên khám phá chủ đề và soạn câu hỏi. Câu hỏi được đưa vào luồng chat thông thường; model sinh câu trả lời từ nguồn được truy xuất và dữ liệu được phân quyền. Không trả một đoạn FAQ cố định khi người dùng bấm câu hỏi. `requiredSource` là yêu cầu nghiệp vụ dành cho người vận hành, không thay thế trích dẫn và không cấp quyền cho model.

Để đánh giá chất lượng tư vấn thực tế, lấy đủ 60 câu hỏi làm điểm khởi đầu, bổ sung cách hỏi không dấu, viết tắt, nhiều lượt và các biến thể theo khóa/học kỳ. Mỗi ca cần lưu mã câu hỏi, đối tượng áp dụng, nguồn đã duyệt, các ý bắt buộc, các điều không được khẳng định, yêu cầu đăng nhập và hành vi mong đợi khi thiếu dữ liệu. Người có chuyên môn duyệt đáp án theo nguồn trước khi dùng làm chuẩn.

Chạy thêm các ca thiếu hoặc hết hạn nguồn, chưa rõ năm học, chưa đăng nhập, yêu cầu hồ sơ người khác và tài liệu chứa chỉ dẫn giả. Đánh giá riêng độ đúng của nội dung, trích dẫn, việc hỏi lại đúng chỗ, việc thừa nhận thiếu thông tin và phân quyền. Không tính một câu trả lời né tránh là đạt khi đã có đủ nguồn để trả lời.

Danh mục 60 câu hỏi không đồng nghĩa 60 đáp án đã được kiểm chứng hoặc model đã vượt qua đánh giá. Báo cáo phải phân biệt kiểm tra cấu trúc dữ liệu với kết quả chạy model thật, ghi thời điểm, model, phiên bản kho kiến thức, chi phí và độ trễ. Các chủ đề chưa có nguồn vẫn được giữ trong danh mục để người vận hành biết cần bổ sung gì.
