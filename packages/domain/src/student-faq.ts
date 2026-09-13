/**
 * Questions students may ask, not a source of university policy or canned answers.
 * requiredSource describes evidence that must be reviewed before giving a factual answer.
 */
export const STUDENT_FAQ_CATEGORIES = [
  {
    id: 'admissions',
    title: 'Tuyển sinh & nhập học',
    description: 'Ngành học, phương thức xét tuyển, hồ sơ và những bước đầu vào trường.',
  },
  {
    id: 'tuition',
    title: 'Học phí & thanh toán',
    description: 'Mức thu, hạn nộp, cách thanh toán và đối soát khoản đã đóng.',
  },
  {
    id: 'financial-aid',
    title: 'Học bổng & hỗ trợ tài chính',
    description: 'Điều kiện xét, hồ sơ hỗ trợ, miễn giảm và vay vốn học tập.',
  },
  {
    id: 'registration',
    title: 'Đăng ký môn & lịch học',
    description: 'Đợt đăng ký, lớp đầy, trùng lịch và thời khóa biểu cá nhân.',
  },
  {
    id: 'exams',
    title: 'Thi cử & kết quả học tập',
    description: 'Lịch thi, điều kiện dự thi, hoãn thi, phúc khảo và học lại.',
  },
  {
    id: 'procedures',
    title: 'Giấy tờ & thủ tục',
    description: 'Giấy xác nhận, bảo lưu, chuyển ngành và điều chỉnh hồ sơ.',
  },
  {
    id: 'graduation-career',
    title: 'Tốt nghiệp & nghề nghiệp',
    description: 'Chuẩn đầu ra, thực tập, khóa luận và tìm cơ hội việc làm.',
  },
  {
    id: 'digital-services',
    title: 'Tài khoản & dịch vụ số',
    description: 'Cổng sinh viên, email, Wi-Fi, học trực tuyến và hỗ trợ truy cập.',
  },
  {
    id: 'library',
    title: 'Thư viện & học liệu',
    description: 'Giờ mở cửa, mượn sách, tài liệu điện tử và không gian tự học.',
  },
  {
    id: 'housing-campus',
    title: 'Chỗ ở & đời sống trong trường',
    description: 'Ký túc xá, chỗ ăn uống, gửi xe và phản ánh cơ sở vật chất.',
  },
  {
    id: 'health-support',
    title: 'Sức khỏe & hỗ trợ sinh viên',
    description: 'Y tế, tư vấn tâm lý, bảo hiểm và các kênh hỗ trợ phù hợp.',
  },
  {
    id: 'activities-conduct',
    title: 'Hoạt động & rèn luyện',
    description: 'Câu lạc bộ, tình nguyện, nghiên cứu khoa học và điểm rèn luyện.',
  },
] as const;

export type StudentFaqCategory = (typeof STUDENT_FAQ_CATEGORIES)[number];
export type StudentFaqCategoryId = StudentFaqCategory['id'];
export type StudentFaqDataScope = 'public' | 'personal';

export interface StudentFaqQuestion {
  id: string;
  categoryId: StudentFaqCategoryId;
  question: string;
  aliases: string[];
  requiredSource: string;
  /** Personal questions require the authenticated student's own records. */
  dataScope: StudentFaqDataScope;
}

export const STUDENT_FAQ_QUESTIONS: readonly StudentFaqQuestion[] = [
  {
    id: 'admissions-majors',
    categoryId: 'admissions',
    question: 'NAU có những ngành nào và em nên tìm hiểu chương trình học ở đâu?',
    aliases: ['ngành đào tạo', 'nganh hoc', 'chọn ngành', 'chương trình đào tạo'],
    requiredSource: 'Đề án tuyển sinh năm đang hỏi và chương trình đào tạo công khai từng ngành.',
    dataScope: 'public',
  },
  {
    id: 'admissions-methods',
    categoryId: 'admissions',
    question: 'Năm nay trường xét tuyển bằng những phương thức nào?',
    aliases: ['xét học bạ', 'xet tuyen', 'điểm thi tốt nghiệp', 'tổ hợp xét tuyển'],
    requiredSource:
      'Đề án và thông báo tuyển sinh chính thức của năm đang hỏi, gồm điều kiện từng phương thức.',
    dataScope: 'public',
  },
  {
    id: 'admissions-deadlines',
    categoryId: 'admissions',
    question: 'Hạn đăng ký xét tuyển và xác nhận nhập học là khi nào?',
    aliases: ['lịch tuyển sinh', 'han nhap hoc', 'xác nhận trúng tuyển', 'nhập học muộn'],
    requiredSource:
      'Lịch tuyển sinh và thông báo nhập học đúng năm, đúng đợt; thông báo điều chỉnh nếu có.',
    dataScope: 'public',
  },
  {
    id: 'admissions-documents',
    categoryId: 'admissions',
    question: 'Tân sinh viên cần chuẩn bị giấy tờ gì và làm những bước nào khi nhập học?',
    aliases: [
      'hồ sơ nhập học',
      'ho so tan sinh vien',
      'bản sao công chứng',
      'tuần sinh hoạt đầu khóa',
    ],
    requiredSource:
      'Hướng dẫn nhập học và kế hoạch sinh hoạt đầu khóa áp dụng cho khóa tuyển sinh đang hỏi.',
    dataScope: 'public',
  },
  {
    id: 'admissions-credit-recognition',
    categoryId: 'admissions',
    question: 'Em đã học ở trường khác thì có thể xin công nhận các môn đã học không?',
    aliases: ['chuyển tín chỉ', 'mien mon', 'công nhận kết quả học tập', 'học phần tương đương'],
    requiredSource:
      'Quy định công nhận kết quả học tập, quy chế đúng đối tượng và quy trình nộp hồ sơ tương đương học phần.',
    dataScope: 'public',
  },
  {
    id: 'tuition-rates',
    categoryId: 'tuition',
    question: 'Học phí ngành của em tính theo tín chỉ hay học kỳ, mức thu hiện tại là bao nhiêu?',
    aliases: ['giá một tín chỉ', 'hoc phi', 'mức học phí', 'học phí theo ngành'],
    requiredSource:
      'Quyết định mức thu học phí đúng năm học, ngành, khóa và hệ đào tạo; hỏi thêm đối tượng nếu chưa rõ.',
    dataScope: 'public',
  },
  {
    id: 'tuition-payment',
    categoryId: 'tuition',
    question: 'Đóng học phí qua kênh nào và cần ghi nội dung thanh toán ra sao?',
    aliases: ['chuyển khoản học phí', 'dong tien hoc', 'tài khoản thu học phí', 'biên lai'],
    requiredSource:
      'Hướng dẫn thanh toán chính thức còn hiệu lực, thông tin đơn vị thụ hưởng và cách nhận chứng từ.',
    dataScope: 'public',
  },
  {
    id: 'tuition-extension',
    categoryId: 'tuition',
    question:
      'Chưa đủ tiền đóng học phí đúng hạn thì có thể xin gia hạn hoặc đóng nhiều đợt không?',
    aliases: ['nợ học phí', 'gia han hoc phi', 'đóng học phí từng đợt', 'khó khăn tài chính'],
    requiredSource:
      'Thông báo hạn thu đúng học kỳ và chính sách gia hạn hoặc chia đợt nếu được trường công bố.',
    dataScope: 'public',
  },
  {
    id: 'tuition-balance',
    categoryId: 'tuition',
    question: 'Học kỳ này em còn phải đóng bao nhiêu tiền và hạn cuối là ngày nào?',
    aliases: ['công nợ của em', 'con no bao nhieu', 'hạn đóng tiền của tôi', 'khoản thu cá nhân'],
    requiredSource:
      'Công nợ, khoản thu, khoản đã thanh toán và hạn nộp của sinh viên đang đăng nhập, kèm thông báo thu áp dụng.',
    dataScope: 'personal',
  },
  {
    id: 'tuition-reconciliation',
    categoryId: 'tuition',
    question: 'Em đã chuyển khoản nhưng hệ thống vẫn báo nợ học phí thì xử lý thế nào?',
    aliases: [
      'chưa cập nhật học phí',
      'chuyen khoan chua ghi nhan',
      'đối soát học phí',
      'đóng tiền vẫn nợ',
    ],
    requiredSource:
      'Quy trình đối soát thanh toán và kênh liên hệ chính thức; chỉ đối chiếu giao dịch cá nhân sau khi xác thực.',
    dataScope: 'public',
  },
  {
    id: 'aid-scholarship-types',
    categoryId: 'financial-aid',
    question: 'Hiện có những học bổng nào và mỗi loại cần đáp ứng điều kiện gì?',
    aliases: ['học bổng khuyến khích', 'hoc bong', 'học bổng doanh nghiệp', 'điều kiện học bổng'],
    requiredSource:
      'Quy định học bổng và các thông báo xét đang còn hạn, gồm đối tượng, tiêu chí và nguồn tài trợ.',
    dataScope: 'public',
  },
  {
    id: 'aid-scholarship-application',
    categoryId: 'financial-aid',
    question: 'Muốn xin học bổng thì nộp hồ sơ ở đâu, cần giấy tờ gì và hạn nộp khi nào?',
    aliases: ['đăng ký học bổng', 'ho so hoc bong', 'mẫu đơn học bổng', 'deadline học bổng'],
    requiredSource:
      'Thông báo nhận hồ sơ của học bổng cụ thể, biểu mẫu, địa điểm hoặc kênh nộp và hạn tiếp nhận.',
    dataScope: 'public',
  },
  {
    id: 'aid-tuition-exemption',
    categoryId: 'financial-aid',
    question: 'Sinh viên thuộc diện khó khăn có chính sách miễn, giảm học phí hoặc hỗ trợ nào?',
    aliases: ['hộ nghèo', 'mien giam hoc phi', 'trợ cấp xã hội', 'hỗ trợ chi phí học tập'],
    requiredSource:
      'Hướng dẫn chính sách miễn giảm và hỗ trợ do trường công bố, căn cứ pháp lý, đối tượng và năm học áp dụng.',
    dataScope: 'public',
  },
  {
    id: 'aid-student-loan',
    categoryId: 'financial-aid',
    question: 'Em muốn vay vốn sinh viên thì trường hỗ trợ xác nhận hồ sơ như thế nào?',
    aliases: [
      'vay vốn học tập',
      'vay von sinh vien',
      'giấy xác nhận vay vốn',
      'tín dụng sinh viên',
    ],
    requiredSource:
      'Hướng dẫn xác nhận hồ sơ vay vốn của trường và thông tin chương trình tín dụng từ đơn vị có thẩm quyền.',
    dataScope: 'public',
  },
  {
    id: 'aid-my-awards',
    categoryId: 'financial-aid',
    question: 'Học kỳ này hồ sơ của em đang ghi nhận học bổng hay khoản miễn giảm nào?',
    aliases: ['học bổng của em', 'hoc bong cua toi', 'khoản hỗ trợ cá nhân', 'miễn giảm của em'],
    requiredSource:
      'Quyết định hoặc dữ liệu cấp học bổng, miễn giảm đã ghi nhận cho sinh viên đang đăng nhập; không suy ra quyền hưởng từ điểm đơn lẻ.',
    dataScope: 'personal',
  },
  {
    id: 'registration-window',
    categoryId: 'registration',
    question: 'Khi nào mở đăng ký học phần và em đăng ký trên hệ thống nào?',
    aliases: ['đăng ký tín chỉ', 'dang ky mon', 'lịch đăng ký học phần', 'đợt đăng ký'],
    requiredSource:
      'Kế hoạch đăng ký học phần đúng học kỳ, khóa và hệ đào tạo; hướng dẫn cổng đăng ký chính thức.',
    dataScope: 'public',
  },
  {
    id: 'registration-full-class',
    categoryId: 'registration',
    question: 'Lớp học phần đã đầy hoặc không mở môn em cần thì phải làm sao?',
    aliases: ['hết chỗ', 'lop day', 'mở thêm lớp', 'nguyện vọng học phần'],
    requiredSource:
      'Quy trình xử lý lớp đầy, đăng ký nguyện vọng hoặc đề nghị mở lớp và đầu mối tiếp nhận đúng học kỳ.',
    dataScope: 'public',
  },
  {
    id: 'registration-change',
    categoryId: 'registration',
    question: 'Đã đăng ký rồi có được đổi lớp hoặc rút học phần không, có mất học phí không?',
    aliases: ['hủy môn', 'rut hoc phan', 'đổi lớp học phần', 'hoàn học phí'],
    requiredSource:
      'Quy định điều chỉnh đăng ký và hoàn trả học phí, thời hạn cụ thể của học kỳ, đối tượng áp dụng.',
    dataScope: 'public',
  },
  {
    id: 'registration-prerequisite',
    categoryId: 'registration',
    question: 'Bị chặn đăng ký vì môn tiên quyết hoặc trùng lịch thì kiểm tra và xử lý ở đâu?',
    aliases: ['không đăng ký được', 'mon tien quyet', 'trùng thời khóa biểu', 'học phần song hành'],
    requiredSource:
      'Chương trình và quan hệ tiên quyết đúng phiên bản, quy tắc đăng ký, hướng dẫn xử lý trùng lịch của trường.',
    dataScope: 'public',
  },
  {
    id: 'registration-my-timetable',
    categoryId: 'registration',
    question: 'Tuần này em học những môn nào, ở phòng nào và có lịch thay đổi không?',
    aliases: [
      'lịch học của em',
      'thoi khoa bieu cua toi',
      'hôm nay học phòng nào',
      'đổi phòng học',
    ],
    requiredSource:
      'Đăng ký học phần, thời khóa biểu và thông báo điều chỉnh mới nhất của sinh viên đang đăng nhập.',
    dataScope: 'personal',
  },
  {
    id: 'exams-my-schedule',
    categoryId: 'exams',
    question: 'Lịch thi sắp tới của em là ngày nào, ca nào và phòng nào?',
    aliases: ['lịch thi của tôi', 'lich thi cua em', 'phòng thi', 'ca thi'],
    requiredSource:
      'Lịch thi, danh sách dự thi và thay đổi lịch mới nhất của sinh viên đang đăng nhập trong học kỳ liên quan.',
    dataScope: 'personal',
  },
  {
    id: 'exams-eligibility',
    categoryId: 'exams',
    question: 'Nghỉ học bao nhiêu buổi hoặc thiếu bài tập thì có bị cấm thi không?',
    aliases: ['điều kiện dự thi', 'cam thi', 'vắng học', 'chuyên cần', 'số tiết nghỉ'],
    requiredSource:
      'Quy chế đúng khóa và hệ đào tạo, đề cương học phần đã duyệt và cách tính theo số tiết; không tự quy đổi buổi thành tiết.',
    dataScope: 'public',
  },
  {
    id: 'exams-absence',
    categoryId: 'exams',
    question: 'Bị ốm hoặc có việc đột xuất đúng ngày thi thì xin hoãn thi như thế nào?',
    aliases: ['vắng thi có phép', 'hoan thi', 'thi bù', 'giấy xin nghỉ thi'],
    requiredSource:
      'Quy định hoãn thi, hồ sơ minh chứng, thời hạn báo vắng và đơn vị tiếp nhận đúng đợt thi.',
    dataScope: 'public',
  },
  {
    id: 'exams-appeal',
    categoryId: 'exams',
    question: 'Muốn phúc khảo bài thi hoặc báo sai điểm thì cần làm gì?',
    aliases: ['phúc tra', 'phuc khao', 'khiếu nại điểm', 'sửa điểm'],
    requiredSource:
      'Quy trình phúc khảo và sửa sai điểm, hạn nộp, biểu mẫu và lệ phí nếu có trong thông báo chính thức.',
    dataScope: 'public',
  },
  {
    id: 'exams-retake',
    categoryId: 'exams',
    question: 'Thi lại, học lại và học cải thiện khác nhau thế nào, đăng ký vào lúc nào?',
    aliases: ['nợ môn', 'hoc lai', 'thi lai', 'cải thiện điểm'],
    requiredSource:
      'Quy chế đào tạo đúng đối tượng và thông báo thi lại, học lại, học cải thiện của kỳ đang hỏi.',
    dataScope: 'public',
  },
  {
    id: 'procedures-student-certificate',
    categoryId: 'procedures',
    question: 'Xin giấy xác nhận sinh viên hoặc giấy xác nhận để tạm hoãn nghĩa vụ quân sự ở đâu?',
    aliases: [
      'giấy chứng nhận sinh viên',
      'giay xac nhan',
      'xác nhận đang học',
      'nghĩa vụ quân sự',
    ],
    requiredSource:
      'Quy trình cấp giấy xác nhận theo mục đích, mẫu đơn, thời gian xử lý và đầu mối chính thức của trường.',
    dataScope: 'public',
  },
  {
    id: 'procedures-leave',
    categoryId: 'procedures',
    question: 'Em muốn bảo lưu hoặc quay lại học sau bảo lưu thì cần thủ tục gì?',
    aliases: ['nghỉ học tạm thời', 'bao luu', 'học tiếp sau bảo lưu', 'trở lại học'],
    requiredSource:
      'Quy chế nghỉ học tạm thời, bảo lưu và tiếp nhận học trở lại đúng đối tượng, kèm hồ sơ và thời hạn.',
    dataScope: 'public',
  },
  {
    id: 'procedures-change-major',
    categoryId: 'procedures',
    question: 'Muốn chuyển ngành hoặc chuyển trường thì cần đáp ứng điều kiện nào?',
    aliases: ['đổi ngành', 'chuyen nganh', 'chuyển cơ sở đào tạo', 'chuyen truong'],
    requiredSource:
      'Quy định chuyển ngành, chuyển trường đúng khóa và hình thức đào tạo; quy trình và lịch tiếp nhận hồ sơ.',
    dataScope: 'public',
  },
  {
    id: 'procedures-correct-profile',
    categoryId: 'procedures',
    question: 'Tên, ngày sinh hoặc số giấy tờ trong hồ sơ bị sai thì sửa bằng cách nào?',
    aliases: ['sai thông tin sinh viên', 'sua ho so', 'đổi căn cước', 'cập nhật số điện thoại'],
    requiredSource:
      'Hướng dẫn cập nhật thông tin sinh viên, giấy tờ đối chiếu và kênh gửi hồ sơ được trường cho phép.',
    dataScope: 'public',
  },
  {
    id: 'procedures-transcript-card',
    categoryId: 'procedures',
    question: 'Em cần xin bảng điểm có xác nhận hoặc làm lại thẻ sinh viên thì liên hệ đâu?',
    aliases: ['cấp bảng điểm', 'lam lai the sinh vien', 'mất thẻ', 'bảng điểm có dấu'],
    requiredSource:
      'Quy trình cấp bảng điểm và cấp lại thẻ, đầu mối, biểu mẫu, thời gian xử lý và mức thu nếu có.',
    dataScope: 'public',
  },
  {
    id: 'graduation-requirements',
    categoryId: 'graduation-career',
    question: 'Để được xét tốt nghiệp cần đủ những tín chỉ và chứng chỉ nào?',
    aliases: ['chuẩn đầu ra', 'dieu kien tot nghiep', 'ngoại ngữ đầu ra', 'chứng chỉ tin học'],
    requiredSource:
      'Chương trình, chuẩn đầu ra, quy chế và kế hoạch xét tốt nghiệp đúng ngành, khóa, hệ đào tạo.',
    dataScope: 'public',
  },
  {
    id: 'graduation-internship',
    categoryId: 'graduation-career',
    question: 'Đi thực tập cần điều kiện gì và em có được tự tìm đơn vị thực tập không?',
    aliases: [
      'thực tập tốt nghiệp',
      'thuc tap',
      'giấy giới thiệu thực tập',
      'doanh nghiệp thực tập',
    ],
    requiredSource:
      'Hướng dẫn thực tập của khoa/ngành đúng khóa, điều kiện tham gia, yêu cầu đơn vị tiếp nhận và hồ sơ.',
    dataScope: 'public',
  },
  {
    id: 'graduation-thesis',
    categoryId: 'graduation-career',
    question: 'Ai được làm khóa luận và nếu không làm thì học các học phần thay thế nào?',
    aliases: [
      'đồ án tốt nghiệp',
      'khoa luan',
      'môn thay thế khóa luận',
      'chọn giảng viên hướng dẫn',
    ],
    requiredSource:
      'Quy định và kế hoạch khóa luận/đồ án của khoa, chương trình đúng phiên bản, danh mục học phần thay thế được duyệt.',
    dataScope: 'public',
  },
  {
    id: 'graduation-my-progress',
    categoryId: 'graduation-career',
    question: 'Với hồ sơ hiện tại, em còn thiếu những gì để đủ điều kiện xét tốt nghiệp?',
    aliases: [
      'tiến độ tốt nghiệp của em',
      'con thieu tin chi',
      'nợ chứng chỉ của tôi',
      'đủ điều kiện ra trường chưa',
    ],
    requiredSource:
      'Tiến độ và chứng chỉ của sinh viên đang đăng nhập cùng chương trình và bộ điều kiện tốt nghiệp đúng đối tượng đã được xác nhận.',
    dataScope: 'personal',
  },
  {
    id: 'career-opportunities',
    categoryId: 'graduation-career',
    question: 'Trường có kênh giới thiệu việc làm, thực tập hoặc hỗ trợ viết CV không?',
    aliases: ['tìm việc', 'viec lam', 'ngày hội tuyển dụng', 'hướng nghiệp', 'CV phỏng vấn'],
    requiredSource:
      'Trang hoặc thông báo chính thức về hỗ trợ nghề nghiệp, các cơ hội còn hạn và kênh liên hệ được trường xác nhận.',
    dataScope: 'public',
  },
  {
    id: 'digital-password',
    categoryId: 'digital-services',
    question: 'Quên mật khẩu cổng sinh viên hoặc email trường thì lấy lại như thế nào?',
    aliases: ['không đăng nhập được', 'quen mat khau', 'reset password', 'tài khoản bị khóa'],
    requiredSource:
      'Hướng dẫn khôi phục tài khoản chính thức và đầu mối hỗ trợ; chatbot không thu mật khẩu hoặc mã OTP.',
    dataScope: 'public',
  },
  {
    id: 'digital-wifi',
    categoryId: 'digital-services',
    question: 'Sinh viên kết nối Wi-Fi của trường như thế nào và báo lỗi mạng ở đâu?',
    aliases: ['wifi', 'wi fi', 'mạng trường', 'không vào mạng được'],
    requiredSource:
      'Hướng dẫn sử dụng mạng cho sinh viên và kênh hỗ trợ kỹ thuật được công bố; không đưa thông tin truy cập nội bộ vào kho công khai.',
    dataScope: 'public',
  },
  {
    id: 'digital-learning-platform',
    categoryId: 'digital-services',
    question: 'Muốn vào lớp học trực tuyến, lấy tài liệu hoặc nộp bài thì dùng hệ thống nào?',
    aliases: ['LMS', 'e-learning', 'hoc online', 'nộp bài trực tuyến', 'tài liệu môn học'],
    requiredSource:
      'Hướng dẫn hệ thống học trực tuyến chính thức và quy trình tham gia lớp, nhận tài liệu, nộp bài.',
    dataScope: 'public',
  },
  {
    id: 'digital-account-security',
    categoryId: 'digital-services',
    question: 'Nhận được link yêu cầu nhập mật khẩu hoặc OTP của trường thì kiểm tra thế nào?',
    aliases: ['lừa đảo', 'link gia mao', 'phishing', 'bảo mật tài khoản', 'mất tài khoản'],
    requiredSource:
      'Cảnh báo an toàn tài khoản, danh sách tên miền/kênh chính thức và quy trình báo sự cố do trường công bố.',
    dataScope: 'public',
  },
  {
    id: 'digital-support-contact',
    categoryId: 'digital-services',
    question: 'Cổng sinh viên báo lỗi thì gửi phản ánh cho ai và cần mô tả những gì?',
    aliases: ['lỗi cổng sinh viên', 'ho tro ky thuat', 'IT support', 'báo lỗi hệ thống'],
    requiredSource:
      'Kênh hỗ trợ kỹ thuật chính thức, giờ tiếp nhận và hướng dẫn gửi thông tin lỗi đã che dữ liệu nhạy cảm.',
    dataScope: 'public',
  },
  {
    id: 'library-hours',
    categoryId: 'library',
    question: 'Thư viện nằm ở đâu, mở cửa giờ nào và có mở cuối tuần không?',
    aliases: ['giờ thư viện', 'thu vien o dau', 'thư viện cuối tuần', 'phòng đọc'],
    requiredSource:
      'Thông tin vị trí và lịch phục vụ thư viện hiện hành, gồm thông báo nghỉ hoặc thay đổi trong kỳ đang hỏi.',
    dataScope: 'public',
  },
  {
    id: 'library-borrow',
    categoryId: 'library',
    question: 'Mượn sách cần thẻ gì, được mượn bao nhiêu cuốn và gia hạn thế nào?',
    aliases: ['mượn trả sách', 'muon sach', 'gia hạn sách', 'thẻ thư viện'],
    requiredSource:
      'Nội quy thư viện và hướng dẫn mượn, trả, gia hạn đang có hiệu lực đối với sinh viên.',
    dataScope: 'public',
  },
  {
    id: 'library-digital-resources',
    categoryId: 'library',
    question: 'Em có thể tra cứu giáo trình, sách điện tử và bài báo khoa học của trường ở đâu?',
    aliases: [
      'thư viện số',
      'sach dien tu',
      'ebook',
      'cơ sở dữ liệu học thuật',
      'tra cứu học liệu',
    ],
    requiredSource:
      'Danh mục và hướng dẫn truy cập học liệu điện tử do trường cung cấp, quyền sử dụng và phạm vi truy cập.',
    dataScope: 'public',
  },
  {
    id: 'library-study-space',
    categoryId: 'library',
    question: 'Có phòng tự học hoặc chỗ học nhóm không và có cần đặt trước không?',
    aliases: ['phòng học nhóm', 'cho tu hoc', 'đặt phòng học', 'không gian học tập'],
    requiredSource:
      'Thông tin chính thức về không gian học tập, nội quy và quy trình đặt chỗ nếu có.',
    dataScope: 'public',
  },
  {
    id: 'library-lost-overdue',
    categoryId: 'library',
    question: 'Trả sách muộn hoặc làm mất sách thư viện thì giải quyết thế nào?',
    aliases: ['quá hạn sách', 'mat sach', 'đền sách', 'phí trả muộn'],
    requiredSource:
      'Nội quy xử lý sách quá hạn, mất hoặc hỏng và kênh liên hệ thư viện còn hiệu lực.',
    dataScope: 'public',
  },
  {
    id: 'housing-dorm-application',
    categoryId: 'housing-campus',
    question: 'Trường có ký túc xá không, đối tượng nào được đăng ký và đăng ký ở đâu?',
    aliases: ['KTX', 'ky tuc xa', 'đăng ký nội trú', 'chỗ ở sinh viên'],
    requiredSource:
      'Thông tin cơ sở nội trú và thông báo tiếp nhận chính thức đúng năm học, gồm tiêu chí và hồ sơ nếu có.',
    dataScope: 'public',
  },
  {
    id: 'housing-dorm-costs',
    categoryId: 'housing-campus',
    question: 'Nếu ở ký túc xá thì tiền phòng, điện nước và nội quy được quy định ra sao?',
    aliases: ['giá phòng KTX', 'phi noi tru', 'tiền điện nước', 'nội quy ký túc xá'],
    requiredSource:
      'Biểu phí và nội quy của khu nội trú được trường xác nhận, thời điểm áp dụng và điều kiện hợp đồng.',
    dataScope: 'public',
  },
  {
    id: 'campus-facility-report',
    categoryId: 'housing-campus',
    question: 'Phòng học hỏng thiết bị hoặc khu sinh hoạt gặp sự cố thì báo cho ai?',
    aliases: ['báo hỏng', 'sua chua phong hoc', 'hỏng điều hòa', 'mất điện', 'cơ sở vật chất'],
    requiredSource:
      'Quy trình báo sự cố cơ sở vật chất và đầu mối tiếp nhận chính thức theo khu vực.',
    dataScope: 'public',
  },
  {
    id: 'campus-food',
    categoryId: 'housing-campus',
    question: 'Trong trường có căng tin hoặc khu ăn uống nào, phục vụ vào giờ nào?',
    aliases: ['căn tin', 'cantin', 'an uong', 'nhà ăn sinh viên'],
    requiredSource:
      'Thông tin dịch vụ ăn uống và giờ hoạt động hiện hành do trường hoặc đơn vị được trường xác nhận công bố.',
    dataScope: 'public',
  },
  {
    id: 'campus-parking-security',
    categoryId: 'housing-campus',
    question: 'Gửi xe trong trường cần đăng ký gì và khi mất đồ thì liên hệ đâu?',
    aliases: ['bãi xe', 'gui xe', 'thẻ xe', 'đồ thất lạc', 'bảo vệ trường'],
    requiredSource:
      'Hướng dẫn gửi xe, quy định phí nếu có, quy trình tiếp nhận đồ thất lạc và liên hệ bảo vệ chính thức.',
    dataScope: 'public',
  },
  {
    id: 'health-campus-care',
    categoryId: 'health-support',
    question: 'Nếu bị mệt hoặc gặp vấn đề sức khỏe khi đang ở trường thì tìm hỗ trợ ở đâu?',
    aliases: ['phòng y tế', 'tram y te', 'chăm sóc sức khỏe', 'bị ốm trong trường'],
    requiredSource:
      'Thông tin đầu mối y tế, địa điểm và giờ phục vụ được trường xác nhận; không suy đoán năng lực khám hoặc điều trị.',
    dataScope: 'public',
  },
  {
    id: 'health-counseling',
    categoryId: 'health-support',
    question: 'Em đang căng thẳng vì học tập, trường có nơi tư vấn tâm lý hoặc người hỗ trợ không?',
    aliases: ['stress', 'tu van tam ly', 'áp lực học tập', 'cần người lắng nghe'],
    requiredSource:
      'Thông tin chính thức về dịch vụ hỗ trợ tâm lý hoặc đầu mối công tác sinh viên, phạm vi hỗ trợ và cách tiếp cận.',
    dataScope: 'public',
  },
  {
    id: 'health-insurance',
    categoryId: 'health-support',
    question: 'Đăng ký, gia hạn hoặc báo sai thông tin bảo hiểm y tế sinh viên bằng cách nào?',
    aliases: ['BHYT', 'bao hiem y te', 'thẻ bảo hiểm', 'gia hạn bảo hiểm'],
    requiredSource:
      'Thông báo bảo hiểm y tế sinh viên đúng năm học, hướng dẫn điều chỉnh thông tin và đầu mối tiếp nhận chính thức.',
    dataScope: 'public',
  },
  {
    id: 'health-report-harassment',
    categoryId: 'health-support',
    question: 'Nếu bị bắt nạt, quấy rối hoặc thấy không an toàn thì báo qua kênh nào?',
    aliases: ['bạo lực học đường', 'quay roi', 'phản ánh kín', 'an toàn sinh viên'],
    requiredSource:
      'Quy trình tiếp nhận phản ánh và hỗ trợ an toàn do trường công bố; chỉ mô tả bảo mật trong phạm vi chính sách đã xác nhận.',
    dataScope: 'public',
  },
  {
    id: 'health-accessibility',
    categoryId: 'health-support',
    question: 'Sinh viên khuyết tật hoặc có nhu cầu hỗ trợ đặc biệt có thể liên hệ đơn vị nào?',
    aliases: ['hỗ trợ khuyết tật', 'ho tro dac biet', 'tiếp cận lớp học', 'điều chỉnh học tập'],
    requiredSource:
      'Chính sách hỗ trợ và đầu mối được trường công bố; không khẳng định có dịch vụ hoặc điều chỉnh khi chưa có nguồn.',
    dataScope: 'public',
  },
  {
    id: 'activities-clubs',
    categoryId: 'activities-conduct',
    question: 'Trường có những câu lạc bộ nào và em tham gia bằng cách nào?',
    aliases: ['CLB', 'cau lac bo', 'đội nhóm', 'tuyển thành viên'],
    requiredSource:
      'Danh sách câu lạc bộ, kênh chính thức và thông báo tuyển thành viên còn hiệu lực từ trường hoặc Đoàn, Hội.',
    dataScope: 'public',
  },
  {
    id: 'activities-volunteering',
    categoryId: 'activities-conduct',
    question:
      'Muốn tham gia tình nguyện, sự kiện hoặc hoạt động Đoàn, Hội thì xem thông báo ở đâu?',
    aliases: [
      'mùa hè xanh',
      'tinh nguyen',
      'đoàn thanh niên',
      'hội sinh viên',
      'sự kiện sinh viên',
    ],
    requiredSource:
      'Thông báo hoạt động còn hạn và kênh đăng ký được trường, Đoàn hoặc Hội xác nhận.',
    dataScope: 'public',
  },
  {
    id: 'activities-research',
    categoryId: 'activities-conduct',
    question:
      'Sinh viên muốn làm nghiên cứu khoa học hoặc dự thi ý tưởng khởi nghiệp thì bắt đầu từ đâu?',
    aliases: [
      'NCKH',
      'nghien cuu khoa hoc',
      'đề tài sinh viên',
      'khởi nghiệp',
      'giảng viên hướng dẫn',
    ],
    requiredSource:
      'Kế hoạch, thể lệ và quy trình đăng ký đề tài hoặc cuộc thi đúng năm học, kèm đầu mối hỗ trợ chính thức.',
    dataScope: 'public',
  },
  {
    id: 'activities-conduct-rules',
    categoryId: 'activities-conduct',
    question: 'Điểm rèn luyện được tính thế nào, nộp minh chứng và khiếu nại ở đâu?',
    aliases: ['DRL', 'diem ren luyen', 'minh chứng hoạt động', 'phúc tra rèn luyện'],
    requiredSource:
      'Quy định đánh giá rèn luyện, thang điểm và kế hoạch đánh giá/khiếu nại đúng học kỳ, đối tượng áp dụng.',
    dataScope: 'public',
  },
  {
    id: 'activities-my-conduct',
    categoryId: 'activities-conduct',
    question: 'Điểm rèn luyện học kỳ gần nhất của em là bao nhiêu và đã chốt chưa?',
    aliases: [
      'điểm rèn luyện của tôi',
      'drl cua em',
      'kết quả rèn luyện cá nhân',
      'trạng thái rèn luyện',
    ],
    requiredSource:
      'Điểm và trạng thái đánh giá rèn luyện của sinh viên đang đăng nhập trong học kỳ cần tra cứu.',
    dataScope: 'personal',
  },
];
