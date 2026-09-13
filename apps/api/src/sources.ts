import { NAU_2025, REGULATION_URL } from '@nau/domain';
import { studentServiceSources } from './faq-sources.js';
export interface KnowledgeSource {
  id: string;
  title: string;
  url: string;
  version: string;
  updatedAt: string;
  effectiveFrom: string | null;
  admissionAfter: string | null;
  kind: 'html' | 'pdf';
  topic: string;
  status: 'active' | 'pending' | 'error' | 'unreadable' | 'excluded';
  reviewed: boolean;
  excerpt: string;
  page?: number;
  article?: string;
  error?: string;
  lastCheckedAt?: string;
  contentHash?: string;
  pendingText?: string;
}
export const initialSources: KnowledgeSource[] = [
  ...studentServiceSources,
  {
    id: 'reg-2025',
    title: 'Quy chế đào tạo đại học NAU 2025',
    url: REGULATION_URL,
    version: 'Quyết định 620 — 26/06/2025',
    updatedAt: '2025-06-26',
    effectiveFrom: '2025-06-26',
    admissionAfter: '2025-06-26',
    kind: 'pdf',
    topic: 'Học vụ · Quy chế',
    status: 'active',
    reviewed: true,
    page: 11,
    article: 'Điều 12 khoản 3, 4; Điều 28 khoản 4 (trang PDF 24)',
    excerpt:
      'Theo Điều 12 khoản 4, học phần cốt lõi phải đạt đồng thời điểm học phần, tất cả PI học phần trên mức F và hoàn thành các bài thực hành/báo cáo bắt buộc. Điểm tổng đủ không có nghĩa đã đạt mọi điều kiện. Điều 28 khoản 4 quy định áp dụng cho tuyển sinh sau thời điểm ban hành; các khóa trước cần đối chiếu quy chế chuyển tiếp. Khi thiếu PI hoặc chưa xác định phiên bản quy chế, chưa đủ dữ liệu để kết luận.',
  },
  {
    id: 'attendance-2025',
    title: 'Điều kiện dự thi, vắng thi và đánh giá học phần',
    url: REGULATION_URL,
    version: 'Quyết định 620 — 26/06/2025',
    updatedAt: '2025-06-26',
    effectiveFrom: '2025-06-26',
    admissionAfter: '2025-06-26',
    kind: 'pdf',
    topic: 'Học vụ · Thi cử',
    status: 'active',
    reviewed: true,
    page: 12,
    article: 'Điều 12 khoản 9, 10; Điều 13',
    excerpt:
      'Theo quy chế 2025, vắng dưới 30% số tiết đáp ứng điều kiện điểm danh để dự thi lần đầu. Vắng từ 30% đến dưới 50%: lần thi đầu nhận 0, có thể thi lần hai. Vắng từ 50% trở lên: học phần nhận 0 và phải học lại. Vắng thi không phép nhận điểm 0; vắng có phép cần bố trí kỳ thi thay thế. Việc kết luận cá nhân còn cần dữ liệu thực tế và phiên bản quy chế theo khóa.',
  },
  {
    id: 'nau-home',
    title: 'Website chính thức Trường Đại học Nghệ An',
    url: 'https://nau.edu.vn/',
    version: 'Danh mục liên kết chính thức — 06/09/2026',
    updatedAt: '2026-09-06',
    effectiveFrom: null,
    admissionAfter: null,
    kind: 'html',
    topic: 'Nhà trường · Dịch vụ',
    status: 'active',
    reviewed: true,
    excerpt:
      'Trường Đại học Nghệ An có website chính thức nau.edu.vn. Các liên kết dịch vụ trên website trường gồm cổng sinh viên sinhvien.nau.edu.vn, hệ thống học trực tuyến lms.naue.edu.vn và cổng xét tuyển xettuyen.nau.edu.vn. Cần tra cứu thông báo hiện hành để xác nhận thời hạn và điều kiện của từng thủ tục.',
  },
  {
    id: 'admissions',
    title: 'Cổng xét tuyển Trường Đại học Nghệ An',
    url: 'https://xettuyen.nau.edu.vn/',
    version: 'Liên kết từ website chính thức — 06/09/2026',
    updatedAt: '2026-09-06',
    effectiveFrom: null,
    admissionAfter: null,
    kind: 'html',
    topic: 'Tuyển sinh · Ngành học',
    status: 'active',
    reviewed: true,
    excerpt:
      'Cổng xét tuyển được website Trường Đại học Nghệ An liên kết là xettuyen.nau.edu.vn. Kho kiến thức thử nghiệm chưa có đề án tuyển sinh và bảng học phí hiện hành đã kiểm tra; không thể xác nhận chỉ tiêu, điểm chuẩn, mức học phí hoặc thời hạn xét tuyển chỉ từ liên kết này.',
  },
  {
    id: 'student-portal',
    title: 'Cổng thông tin sinh viên',
    url: 'https://sinhvien.nau.edu.vn/',
    version: 'Liên kết từ website chính thức — 06/09/2026',
    updatedAt: '2026-09-06',
    effectiveFrom: null,
    admissionAfter: null,
    kind: 'html',
    topic: 'Sinh viên · Tra cứu',
    status: 'active',
    reviewed: true,
    excerpt:
      'Sinh viên truy cập cổng thông tin sinhvien.nau.edu.vn qua liên kết trên website chính thức của trường. NAU AI hiện dùng hồ sơ giả và chưa kết nối tài khoản hoặc kết quả chính thức trên cổng sinh viên. Không nhập mật khẩu cổng trường vào tài khoản thử nghiệm.',
  },
  {
    id: 'fees-gap',
    title: 'Học phí và học bổng hiện hành',
    url: 'https://nau.edu.vn/',
    version: 'Chưa thu thập',
    updatedAt: '2026-09-06',
    effectiveFrom: null,
    admissionAfter: null,
    kind: 'html',
    topic: 'Học phí · Học bổng',
    status: 'pending',
    reviewed: false,
    excerpt:
      'Cần bổ sung quyết định học phí, thông báo học bổng và thủ tục miễn giảm theo năm học.',
  },
  {
    id: 'older-rules-gap',
    title: 'Quy chế chuyển tiếp khóa 2023–2024',
    url: 'https://www.nau.edu.vn/quy-che-dao-tao-285/Default.aspx',
    version: 'Chưa xác minh',
    updatedAt: '2026-09-06',
    effectiveFrom: null,
    admissionAfter: null,
    kind: 'html',
    topic: 'Học vụ · Chuyển tiếp',
    status: 'pending',
    reviewed: false,
    excerpt: 'Cần đối chiếu văn bản có hiệu lực cho từng khóa trước ngày 26/06/2025.',
  },
];
export const initialRules = [NAU_2025];
