import type { KnowledgeSource } from './sources.js';

// Reviewed public page summaries, not copies of attachments or individual student lists.
// A directory verifies where to find a form, not eligibility, current fees or processing times.
const source = (
  entry: Pick<KnowledgeSource, 'id' | 'title' | 'url' | 'topic' | 'excerpt'> & {
    publishedAt?: string;
  },
): KnowledgeSource => {
  const { publishedAt, ...fields } = entry;
  return {
    ...fields,
    kind: 'html',
    status: 'active',
    reviewed: true,
    version: publishedAt
      ? `Trang công khai ngày ${publishedAt}; kiểm tra 13/09/2026`
      : 'Danh mục công khai — kiểm tra 13/09/2026',
    updatedAt: publishedAt || '2026-09-13',
    effectiveFrom: publishedAt || null,
    admissionAfter: null,
    lastCheckedAt: '2026-09-13T00:00:00.000Z',
  };
};

export const studentServiceSources: KnowledgeSource[] = [
  source({
    id: 'faq-administrative-forms',
    title: 'Biểu mẫu giấy xác nhận sinh viên và giao trả tài sản',
    url: 'https://nau.edu.vn/dv-11/bieu-mau-811/cac-bieu-mau-thu-tuc-hanh-chinh-10359.aspx',
    topic: 'Giấy tờ · Thủ tục',
    publishedAt: '2026-03-01',
    excerpt:
      'Trang biểu mẫu thủ tục hành chính của Phòng Công tác Chính trị và Học sinh, Sinh viên có liên kết tải giấy xác nhận sinh viên và giấy biên nhận giao trả tài sản. Sinh viên có thể mở trang nguồn để chọn mẫu. Đây là danh mục biểu mẫu, chưa xác minh nội dung tệp đính kèm, nơi nộp cụ thể, giấy tờ bổ sung, thời gian giải quyết hay lệ phí. Cần hỏi bộ phận phụ trách khi thực hiện.',
  }),
  source({
    id: 'faq-study-forms',
    title: 'Biểu mẫu bảo lưu, chuyển ngành, phúc khảo và hoãn thi',
    url: 'https://nau.edu.vn/dv-11/bieu-mau-811/cac-bieu-mau-lien-quan-den-hoc-tap--10357.aspx',
    topic: 'Học tập · Thủ tục',
    publishedAt: '2026-03-01',
    excerpt:
      'Danh mục biểu mẫu học tập có đơn bảo lưu kết quả học tập, trở lại học sau bảo lưu, chuyển ngành, chuyển trường, phúc khảo, hoãn thi và giấy đề nghị sửa điểm chuyên cần, giữa kỳ hoặc thi học phần. Trang nguồn cho phép chọn tệp cần tải. Danh mục không xác nhận sinh viên đủ điều kiện, hạn nộp, phí, quy trình duyệt hay kết quả của hồ sơ. Chưa kiểm tra nội dung từng tệp đính kèm; điều kiện cần đối chiếu quy định áp dụng và đơn vị phụ trách.',
  }),
  source({
    id: 'faq-financial-support-forms',
    title: 'Biểu mẫu miễn giảm học phí, hỗ trợ học tập và vay vốn',
    url: 'https://nau.edu.vn/dv-11/bieu-mau-811/cac-bieu-mau-lien-quan-den-che-do-chinh-sach-hssv-10356.aspx',
    topic: 'Miễn giảm · Hỗ trợ tài chính',
    publishedAt: '2026-03-01',
    excerpt:
      'Trang chế độ chính sách HSSV tập hợp mẫu xin miễn giảm học phí, hỗ trợ chi phí học tập và giấy xác nhận vay vốn; có các mẫu riêng cho sinh viên khuyết tật và dân tộc thiểu số rất ít người. Có thể tìm mẫu tại trang nguồn. Đây không phải bảng học phí hoặc thông báo xét học bổng hiện hành. Chưa có đủ căn cứ để xác nhận đối tượng, số tiền được hưởng, hồ sơ kèm theo hoặc hạn nộp; cần đối chiếu quy định và thông báo áp dụng.',
  }),
  source({
    id: 'faq-dormitory-forms',
    title: 'Biểu mẫu đăng ký và gia hạn ký túc xá',
    url: 'https://nau.edu.vn/dv-11/van-ban-bieu-mau-170/cac-bieu-mau-lien-quan-den-ky-tuc-xa--10358.aspx',
    topic: 'Ký túc xá · Chỗ ở',
    publishedAt: '2026-03-01',
    excerpt:
      'Danh mục ký túc xá có liên kết đơn xin vào ở nội trú, hợp đồng nội trú và đơn gia hạn ở nội trú. Sinh viên muốn đăng ký KTX hoặc gia hạn có thể mở trang nguồn để tìm mẫu. Tên tệp gia hạn có ghi 2025 nên cần xác nhận mẫu còn dùng cho đợt đang hỏi. Chưa kiểm tra nội dung tệp; không có căn cứ về phòng trống, giá phòng, điện nước, hạn đăng ký hoặc việc đã được duyệt.',
  }),
  source({
    id: 'faq-student-support-office',
    title: 'Phòng Công tác sinh viên: hỗ trợ tài chính, đời sống và sức khỏe',
    url: 'https://nau.edu.vn/dv-11/gioi-thieu-418/chuc-nang-nhiem-vu-86.aspx',
    topic: 'Hỗ trợ sinh viên · Y tế · Rèn luyện',
    publishedAt: '2025-04-21',
    excerpt:
      'Trang chức năng của Phòng Công tác Chính trị và Học sinh, Sinh viên nêu nhiệm vụ về thẻ sinh viên, thủ tục hành chính, rèn luyện, nội trú và ngoại trú; thực hiện chính sách học bổng, miễn giảm, trợ cấp và hỗ trợ hoàn cảnh khó khăn. Phòng còn phụ trách chăm sóc sức khỏe ban đầu, tuyên truyền bảo hiểm y tế, hỗ trợ tâm lý xã hội, phương pháp học tập và hướng nghiệp. Đây là thông tin đầu mối hỗ trợ, không phải xác nhận giờ trực, địa điểm khám, mức hưởng bảo hiểm, kết quả rèn luyện cá nhân hoặc lịch hẹn. Chưa có những chi tiết này trong nguồn đã kiểm tra.',
  }),
  source({
    id: 'faq-career-directory',
    title: 'Kênh thông tin việc làm, thực tập và hướng nghiệp',
    url: 'https://nau.edu.vn/dv-11/tu-van-viec-lam-quan-he-doanh-nghiep-214/Default.aspx',
    topic: 'Việc làm · Thực tập · Hướng nghiệp',
    excerpt:
      'Mục Tư vấn - Hướng nghiệp của Phòng Công tác Chính trị và Học sinh, Sinh viên đăng thông tin việc làm, tuyển thực tập sinh và cơ hội nghề nghiệp. Có thể dùng trang này để tìm thông báo phù hợp; phải đọc ngày đăng và hạn nhận hồ sơ trong từng thông báo. Việc bài còn xuất hiện trong danh mục không xác nhận vị trí còn tuyển, mức lương, điều kiện nhận thực tập hay cam kết có việc làm.',
  }),
  source({
    id: 'faq-library-directory',
    title: 'Trung tâm Số và Học liệu: thư viện số và hướng dẫn tra cứu',
    url: 'https://nau.edu.vn/dv-40/khoa-phongban/Default.aspx',
    topic: 'Thư viện · Học liệu',
    excerpt:
      'Trang Trung tâm Số và Học liệu có mục thư viện điện tử/thư viện số, liên kết thuvienso.naue.edu.vn, cùng mục hướng dẫn tra cứu tài liệu. Sinh viên tìm sách điện tử, giáo trình hoặc tài liệu có thể bắt đầu từ những mục này. Trang danh mục chưa xác nhận giờ mở cửa thư viện hiện tại, hạn mượn, số sách được mượn, mức phạt hay cách cấp tài khoản; cần xem hướng dẫn cụ thể hoặc liên hệ trung tâm.',
  }),
  source({
    id: 'faq-digital-directory',
    title: 'LMS, lịch học và lịch thi: liên kết từ website trường',
    url: 'https://nau.edu.vn/',
    topic: 'Dịch vụ số · Lịch học · Lịch thi',
    excerpt:
      'Menu Sinh viên trên website NAU liên kết cổng sinhvien.nau.edu.vn, lịch thi, lịch học chính quy/liên thông/VB2 và hệ thống học trực tuyến LMS tại lms.naue.edu.vn. Đây là các điểm bắt đầu để tìm lịch và học trực tuyến; liên kết không cung cấp lịch cá nhân hay quy trình khôi phục mật khẩu. Không gửi mật khẩu hoặc mã OTP trong hội thoại; NAU AI chưa kết nối tài khoản cổng trường.',
  }),
];
