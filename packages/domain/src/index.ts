export * from './api-pool.js';
export type Role = 'student' | 'admin';
export type AcademicStatus = 'passed' | 'failed' | 'insufficient' | 'conflict';
export type RecordedStatus = 'passed' | 'failed' | 'pending';
export type Verdict = 'met' | 'unmet' | 'unknown';
export interface Identity {
  accountId: string;
  role: Role;
  studentId?: string;
  displayName: string;
}
export interface Citation {
  id: string;
  title: string;
  url: string;
  version: string;
  page?: number;
  article?: string;
  excerpt: string;
}
export interface RulePack {
  id: string;
  title: string;
  effectiveFrom: string;
  admissionAfter: string;
  admissionBefore?: string;
  sourceVerified: boolean;
  institutionApproved: boolean;
  trainingMode: string;
  citation: Citation;
  passThreshold: number;
  attendanceExamLimit: number;
  attendanceRetakeLimit: number;
}
export interface Course {
  id: string;
  name: string;
  credits: number;
  required: boolean;
  isCore: boolean | null;
  prerequisites: string[];
  equivalents: string[];
  syllabusVersion: string;
  syllabusVerified: boolean;
}
export interface CourseRecord {
  id: string;
  course: Course;
  semester: string;
  classCode: string;
  learningAttempt: number;
  examAttempt: number;
  components: { name: string; score: number | null; weight: number }[];
  total: number | null;
  letter: string | null;
  finalized: boolean;
  recordedStatus: RecordedStatus;
  pi:
    | { id: string; clo: string[]; plo: string; score: number | null; letter: string | null }[]
    | null;
  expectedPi: string[];
  practiceRequired: boolean | null;
  practices: { id: string; title: string; completed: boolean | null }[];
  attendance: { scheduledPeriods: number; absentPeriods: number } | null;
  examStatus: 'attended' | 'absent_unexcused' | 'absent_excused' | 'unknown';
  improvement: boolean;
  previousTotal?: number;
  rulePackId: string | null;
  scenario: string;
}
export interface Student {
  id: string;
  name: string;
  major: string;
  classCode: string;
  cohort: number;
  admittedAt: string;
  trainingMode: string;
  status: string;
  programVersion: string;
  programVerified: boolean;
  synthetic: boolean;
  courses: CourseRecord[];
  timetable: {
    id: string;
    courseName: string;
    day: number;
    start: string;
    end: string;
    room: string;
    teacher: string;
    kind: 'class' | 'exam';
    date?: string;
  }[];
  progress: {
    gpa: number;
    earnedCredits: number;
    requiredCredits: number;
    warnings: string[];
    certificates: { name: string; completed: boolean }[];
    verified: boolean;
  };
  finance: {
    semester: string;
    charges: { id: string; title: string; amount: number; paid: number; dueDate: string }[];
    scholarships: { title: string; amount: number }[];
  };
  conduct: { semester: string; score: number; status: string }[];
}
export interface Condition {
  id: string;
  label: string;
  verdict: Verdict;
  evidence: string;
  article: string;
}
export interface AcademicResult {
  recordId: string;
  courseName: string;
  status: AcademicStatus;
  recordedStatus: RecordedStatus;
  computedStatus: 'passed' | 'failed' | 'unknown';
  conditions: Condition[];
  explanation: string;
  nextSteps: string[];
  citations: Citation[];
  synthetic: boolean;
  rulePackId: string | null;
  recalculatedTotal: number | null;
}
export interface StudentDataProvider {
  getStudent(studentId: string): Promise<Student | null>;
  count(): Promise<number>;
}
export interface IdentityProvider {
  authenticate(username: string, password: string): Promise<Identity | null>;
}
export interface AcademicEvaluator {
  evaluate(student: Student, record: CourseRecord, rules: RulePack[]): AcademicResult;
}
export interface LLMRequest {
  /** Correlates attempts without storing prompt or evidence. */
  requestId?: string;
  /** Declares whether evidence contains student-specific data. */
  sensitivity?: 'public' | 'personal';
  question: string;
  evidence: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  complex: boolean;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
}
export interface LLMResponse {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  providerId?: string;
  providerName?: string;
  mode?: string;
  usageEstimated?: boolean;
}
export interface LLMProvider {
  mode: string;
  generate(request: LLMRequest): Promise<LLMResponse>;
  refresh?(): Promise<void>;
}
export interface EmbeddingProvider {
  model: string;
  dimensions: number;
  embed(texts: string[]): Promise<{ vectors: number[][]; tokens: number }>;
}
export interface ActionDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  role: Role;
  handlerAvailable: boolean;
}
export interface ActionRegistry {
  list(): ActionDefinition[];
  prepare(id: string, identity: Identity): { available: boolean; reason: string };
  execute(id: string, identity: Identity, confirmation: string): Promise<never | unknown>;
}

export const REGULATION_URL =
  'https://nau.edu.vn/Images/userfiles/71/files/Q%C4%90%20620%20Ban%20h%C3%A0nh%20Quy%20ch%E1%BA%BF%20%C4%91%C3%A0o%20t%E1%BA%A1o%20tr%C3%ACnh%20%C4%91%E1%BB%99%20%C4%90%E1%BA%A1i%20h%E1%BB%8Dc(1).pdf';
export const NAU_2025: RulePack = {
  id: 'nau-620-2025',
  title: 'Quy chế đào tạo đại học — Quyết định 620/2025',
  effectiveFrom: '2025-06-26',
  admissionAfter: '2025-06-26',
  sourceVerified: true,
  institutionApproved: false,
  trainingMode: 'chinh_quy',
  passThreshold: 4,
  attendanceExamLimit: 0.3,
  attendanceRetakeLimit: 0.5,
  citation: {
    id: 'reg-2025',
    title: 'Quy chế đào tạo NAU 2025',
    url: REGULATION_URL,
    version: '620 — 26/06/2025',
    page: 11,
    article: 'Điều 12 khoản 3, 4, 9; Điều 13; Điều 28 khoản 4',
    excerpt:
      'Học phần cốt lõi phải đồng thời đạt điểm học phần, các PI học phần và yêu cầu thực hành/báo cáo. Áp dụng theo thời điểm tuyển sinh.',
  },
};
export function roundedGrade(value: number) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}
export function gradeLetter(value: number) {
  const v = roundedGrade(value);
  return v >= 8.5
    ? 'A'
    : v >= 8
      ? 'B+'
      : v >= 7
        ? 'B'
        : v >= 6.5
          ? 'C+'
          : v >= 5.5
            ? 'C'
            : v >= 5
              ? 'D+'
              : v >= 4
                ? 'D'
                : 'F';
}
export class NauAcademicEvaluator implements AcademicEvaluator {
  evaluate(student: Student, r: CourseRecord, rules: RulePack[]): AcademicResult {
    const conditions: Condition[] = [];
    const add = (
      id: string,
      label: string,
      verdict: Verdict,
      evidence: string,
      article = 'Điều 12',
    ) => conditions.push({ id, label, verdict, evidence, article });
    const result: AcademicResult = {
      recordId: r.id,
      courseName: r.course.name,
      status: 'insufficient',
      recordedStatus: r.recordedStatus,
      computedStatus: 'unknown',
      conditions,
      explanation: '',
      nextSteps: [],
      citations: [],
      synthetic: student.synthetic,
      rulePackId: r.rulePackId,
      recalculatedTotal: null,
    };
    const candidates = rules.filter(
      (p) =>
        p.id === r.rulePackId &&
        p.sourceVerified &&
        p.trainingMode === student.trainingMode &&
        student.admittedAt > p.admissionAfter &&
        (!p.admissionBefore || student.admittedAt <= p.admissionBefore),
    );
    const rule = candidates.length === 1 ? candidates[0] : null;
    if (!rule) {
      add(
        'rule',
        'Quy chế đúng đối tượng',
        'unknown',
        `Chưa có quy chế đã kiểm tra áp dụng cho khóa ${student.cohort} và hồ sơ này.`,
        'Điều 28 khoản 4',
      );
      result.explanation =
        'Chưa đủ dữ liệu để kết luận: chưa xác định được đúng phiên bản quy chế áp dụng.';
      result.nextSteps = [
        'Đề nghị Phòng Đào tạo xác nhận quy chế chuyển tiếp theo khóa tuyển sinh.',
      ];
      return result;
    }
    result.citations = [rule.citation];
    add(
      'rule',
      'Quy chế đúng đối tượng',
      'met',
      `${rule.title}; ngày nhập học ${student.admittedAt}.`,
      'Điều 28 khoản 4',
    );
    if (!r.finalized || r.recordedStatus === 'pending')
      add(
        'finalized',
        'Điểm đã chốt',
        'unknown',
        'Điểm chưa chốt; không thể kết luận kết quả cuối cùng.',
      );
    let invalid = false;
    const invalidScore = (n: number | null) =>
      n !== null && (!Number.isFinite(n) || n < 0 || n > 10);
    if (
      invalidScore(r.total) ||
      r.components.some(
        (c) => invalidScore(c.score) || !Number.isFinite(c.weight) || c.weight < 0 || c.weight > 1,
      ) ||
      r.pi?.some((p) => invalidScore(p.score))
    ) {
      invalid = true;
      add(
        'invalid',
        'Tính hợp lệ dữ liệu',
        'unknown',
        'Có điểm ngoài thang 0–10 hoặc trọng số không hợp lệ.',
      );
    }
    if (r.total === null)
      add('total', 'Điểm học phần', 'unknown', 'Chưa có điểm học phần.', 'Điều 12 khoản 3, 4');
    else
      add(
        'total',
        'Điểm học phần',
        r.total >= rule.passThreshold ? 'met' : 'unmet',
        `${r.total.toFixed(1).replace('.', ',')}/10; ngưỡng đạt ${rule.passThreshold}/10 sau làm tròn.`,
        'Điều 12 khoản 3, 4; Điều 13',
      );
    if (r.total !== null && r.letter && r.letter !== gradeLetter(r.total)) {
      invalid = true;
      add(
        'letter',
        'Đối chiếu điểm chữ',
        'unknown',
        `Điểm ${r.total} và điểm chữ ${r.letter} không khớp bảng quy đổi.`,
        'Điều 13',
      );
    }
    const weight = r.components.reduce((s, c) => s + c.weight, 0);
    if (r.components.length && Math.abs(weight - 1) > 0.0001) {
      invalid = true;
      add(
        'weights',
        'Trọng số thành phần',
        'unknown',
        `Tổng trọng số ${weight}, cần bằng 1.`,
        'Điều 13',
      );
    } else if (r.components.length && r.components.every((c) => c.score !== null)) {
      result.recalculatedTotal = roundedGrade(
        r.components.reduce((s, c) => s + c.score! * c.weight, 0),
      );
      if (
        r.total !== null &&
        !r.improvement &&
        r.examAttempt === 1 &&
        Math.abs(result.recalculatedTotal - r.total) > 0.051
      ) {
        invalid = true;
        add(
          'calculation',
          'Đối chiếu điểm thành phần',
          'unknown',
          `Điểm tính kiểm tra ${result.recalculatedTotal}; điểm đang ghi nhận ${r.total}. Không tự sửa điểm.`,
          'Điều 13',
        );
      }
    }
    if (r.course.isCore === null)
      add(
        'core',
        'Phân loại học phần',
        'unknown',
        'Chưa xác định học phần cốt lõi; bắt buộc không đồng nghĩa cốt lõi.',
        'Điều 12 khoản 3, 4',
      );
    if (r.course.isCore === true) {
      if (
        !r.pi ||
        !r.expectedPi.length ||
        r.expectedPi.some((id) => !r.pi?.some((p) => p.id === id))
      )
        add(
          'pi_missing',
          'Đủ dữ liệu PI',
          'unknown',
          'Thiếu PI hoặc danh sách PI cần đánh giá của học phần cốt lõi.',
          'Điều 12 khoản 4',
        );
      for (const p of r.pi || []) {
        const validLetter =
          p.letter !== null && ['A', 'B+', 'B', 'C+', 'C', 'D+', 'D', 'F'].includes(p.letter);
        if (p.letter !== null && !validLetter) {
          invalid = true;
          add(
            `pi_invalid_${p.id}`,
            'Điểm chữ PI hợp lệ',
            'unknown',
            `Điểm chữ ${p.letter} không nằm trong bảng quy đổi đã xác minh.`,
            'Điều 13, 14',
          );
        }
        add(
          `pi_${p.id}`,
          `Chuẩn đầu ra ${p.id}`,
          !validLetter ? 'unknown' : p.letter === 'F' ? 'unmet' : 'met',
          `PI ${p.id}: ${p.letter ?? 'chưa có điểm chữ'}${p.score === null ? '' : ` (${p.score}/10)`}; CLO: ${p.clo.join(', ')} → ${p.plo}.`,
          'Điều 12 khoản 4',
        );
        if (p.score !== null && p.letter && gradeLetter(p.score) !== p.letter) {
          invalid = true;
          add(
            `pi_conflict_${p.id}`,
            'Đối chiếu PI',
            'unknown',
            `Điểm số và điểm chữ ${p.id} mâu thuẫn.`,
            'Điều 14, 15',
          );
        }
      }
    }
    if (r.practiceRequired === null)
      add(
        'practice_unknown',
        'Yêu cầu thực hành',
        'unknown',
        'Chưa có yêu cầu thực hành/báo cáo từ đề cương.',
        'Điều 12 khoản 3, 4',
      );
    if (r.practiceRequired) {
      if (!r.practices.length)
        add(
          'practice_missing',
          'Bài thực hành/báo cáo',
          'unknown',
          'Thiếu danh mục bài bắt buộc.',
          'Điều 12 khoản 3, 4',
        );
      for (const p of r.practices)
        add(
          `practice_${p.id}`,
          p.title,
          p.completed === null ? 'unknown' : p.completed ? 'met' : 'unmet',
          p.completed === null
            ? 'Chưa có xác nhận hoàn thành.'
            : p.completed
              ? 'Đã hoàn thành bài bắt buộc.'
              : 'Chưa hoàn thành bài bắt buộc.',
          'Điều 12 khoản 3, 4',
        );
    }
    const a = r.attendance;
    if (!a)
      add(
        'attendance',
        'Điều kiện dự thi',
        'unknown',
        'Thiếu dữ liệu điểm danh theo số tiết.',
        'Điều 12 khoản 9',
      );
    else if (
      a.scheduledPeriods <= 0 ||
      a.absentPeriods < 0 ||
      a.absentPeriods > a.scheduledPeriods
    ) {
      invalid = true;
      add(
        'attendance',
        'Điều kiện dự thi',
        'unknown',
        'Số tiết điểm danh không hợp lệ.',
        'Điều 12 khoản 9',
      );
    } else {
      const ratio = a.absentPeriods / a.scheduledPeriods;
      add(
        'attendance',
        'Điều kiện dự thi',
        ratio >= rule.attendanceRetakeLimit ||
          (ratio >= rule.attendanceExamLimit && r.examAttempt === 1)
          ? 'unmet'
          : 'met',
        `Vắng ${a.absentPeriods}/${a.scheduledPeriods} tiết (${(ratio * 100).toFixed(1)}%). ${ratio >= 0.5 ? 'Vắng từ 50%: phải học lại.' : ratio >= 0.3 ? 'Vắng từ 30% đến dưới 50%: lần thi đầu nhận 0; có thể thi lần hai.' : 'Đủ điều kiện điểm danh.'}`,
        'Điều 12 khoản 9',
      );
    }
    add(
      'exam',
      'Tham dự kỳ thi',
      r.examStatus === 'attended'
        ? 'met'
        : r.examStatus === 'absent_unexcused'
          ? 'unmet'
          : 'unknown',
      r.examStatus === 'attended'
        ? `Đã dự thi lần ${r.examAttempt}.`
        : r.examStatus === 'absent_unexcused'
          ? 'Vắng thi không phép: điểm thi 0.'
          : r.examStatus === 'absent_excused'
            ? 'Vắng có phép: cần kết quả kỳ thi được bố trí thay thế.'
            : 'Chưa có trạng thái dự thi.',
      'Điều 12 khoản 10',
    );
    if (r.examAttempt > 1)
      add(
        'retake',
        'Quy tắc thi lại',
        'unknown',
        'Cần đối soát giới hạn điểm và từng PI của lần thi lại với quyết định chính thức; không suy từ lần thi đầu.',
        'Điều 12 khoản 5',
      );
    if (r.improvement)
      add(
        'improvement',
        'Học cải thiện',
        'unknown',
        `Điểm cũ ${r.previousTotal ?? 'chưa có'}; cần kết quả lựa chọn lần học và PI được trường xác nhận.`,
        'Điều 12 khoản 8',
      );
    const unknown = conditions.some((c) => c.verdict === 'unknown');
    const failed = conditions.some((c) => c.verdict === 'unmet');
    result.computedStatus = unknown ? 'unknown' : failed ? 'failed' : 'passed';
    result.status = invalid
      ? 'conflict'
      : unknown
        ? 'insufficient'
        : r.recordedStatus !== 'pending' && r.recordedStatus !== result.computedStatus
          ? 'conflict'
          : result.computedStatus === 'unknown'
            ? 'insufficient'
            : result.computedStatus;
    const reasons = conditions
      .filter((c) => c.verdict === 'unmet')
      .map((c) => `${c.label}: ${c.evidence}`)
      .join(' ');
    result.explanation =
      result.status === 'insufficient'
        ? `Chưa đủ dữ liệu để kết luận. ${conditions
            .filter((c) => c.verdict === 'unknown')
            .map((c) => c.evidence)
            .join(' ')}${reasons ? ' Điều kiện chưa đạt đã xác định: ' + reasons : ''}`
        : result.status === 'conflict'
          ? `Dữ liệu mâu thuẫn hoặc kết quả tính kiểm tra khác kết quả đang ghi nhận. ${reasons} Cần Phòng Đào tạo đối soát; hệ thống không ghi đè kết quả.`
          : result.status === 'failed'
            ? `Chưa đạt. ${reasons}`
            : 'Đạt các điều kiện đã có dữ liệu theo quy chế áp dụng.';
    result.nextSteps =
      result.status === 'passed'
        ? ['Theo dõi kết quả chính thức trên cổng sinh viên.']
        : result.status === 'failed'
          ? [
              'Trao đổi với giảng viên về điều kiện chưa đạt và cơ hội bổ sung/đánh giá lại.',
              'Kiểm tra thời hạn phúc khảo hoặc học lại với Phòng Đào tạo.',
            ]
          : ['Đề nghị giảng viên hoặc Phòng Đào tạo bổ sung và đối soát dữ liệu được nêu ở trên.'];
    return result;
  }
}
export const SCENARIOS = [
  'pi_fail',
  'passed',
  'missing_pi',
  'practice_fail',
  'attendance_fail',
  'absent_exam',
  'pending',
  'conflict',
  'rounding',
  'retake',
  'improvement',
  'unknown_core',
] as const;
export function generateStudents(count = 120, seed = 2026): Student[] {
  if (!Number.isInteger(count) || count < 1 || count > 100000)
    throw new Error('Invalid seed count');
  let state = seed >>> 0;
  const rand = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const majors = ['Công nghệ thông tin', 'Kế toán', 'Marketing'];
  return Array.from({ length: count }, (_, i) => {
    const cohort = 2023 + (Math.floor(i / 3) % 4),
      majorIndex = i % 3,
      scenario = SCENARIOS[(Math.floor(i / 12) + majorIndex) % SCENARIOS.length];
    const id = `MOCK${String(i + 1).padStart(5, '0')}`;
    const record = makeScenario(scenario, `${id}-c1`);
    if (cohort < 2025) record.rulePackId = null;
    record.course.name = ['Cơ sở dữ liệu', 'Nguyên lý kế toán', 'Nghiên cứu Marketing'][majorIndex];
    record.course.id = ['IT202', 'ACC201', 'MKT202'][majorIndex];
    const s: Student = {
      id,
      name: `Sinh viên thử nghiệm ${String(i + 1).padStart(3, '0')}`,
      major: majors[majorIndex],
      classCode: `K${cohort.toString().slice(2)}-${['CNTT', 'KT', 'MKT'][majorIndex]}01`,
      cohort,
      admittedAt: `${cohort}-09-05`,
      trainingMode: 'chinh_quy',
      status: 'Đang học',
      programVersion: `MOCK-${cohort}-${majorIndex}`,
      programVerified: false,
      synthetic: true,
      courses: [record, makeScenario('passed', `${id}-c2`), makeScenario('passed', `${id}-c3`)],
      timetable: [],
      progress: {
        gpa: Math.round((2.2 + rand() * 1.3) * 100) / 100,
        earnedCredits: cohort === 2026 ? 0 : Math.max(18, (2026 - cohort) * 30),
        requiredCredits: 130,
        warnings: [],
        certificates: [
          { name: 'Giáo dục thể chất', completed: cohort < 2025 },
          { name: 'Giáo dục quốc phòng — an ninh', completed: cohort < 2025 },
          { name: 'Ngoại ngữ', completed: false },
          { name: 'Tin học', completed: majorIndex === 0 },
        ],
        verified: false,
      },
      finance: {
        semester: '2026-1',
        charges: [
          {
            id: `${id}-fee`,
            title: 'Học phí học kỳ I · DỮ LIỆU GIẢ',
            amount: 7200000,
            paid: i % 3 === 0 ? 4200000 : 7200000,
            dueDate: '2026-10-15',
          },
        ],
        scholarships: [],
      },
      conduct: [
        { semester: '2025-2', score: 75 + Math.floor(rand() * 20), status: 'Đã chốt (giả lập)' },
      ],
    };
    s.courses[1].course = {
      ...s.courses[1].course,
      id: 'GEN101',
      name: 'Tiếng Anh học thuật',
      isCore: false,
      credits: 3,
    };
    s.courses[1].pi = [];
    s.courses[1].expectedPi = [];
    s.courses[2].course = {
      ...s.courses[2].course,
      id: 'GEN102',
      name: 'Kỹ năng học tập đại học',
      isCore: false,
      credits: 2,
    };
    s.courses[2].pi = [];
    s.courses[2].expectedPi = [];
    for (const c of s.courses) {
      c.classCode = s.classCode;
      if (cohort < 2025) c.rulePackId = null;
    }
    s.timetable = s.courses.map((c, j) => ({
      id: `${id}-t${j}`,
      courseName: c.course.name,
      day: 2 + j * 2,
      start: j === 1 ? '13:30' : '07:00',
      end: j === 1 ? '16:00' : '09:30',
      room: `A${201 + j}`,
      teacher: `Giảng viên giả ${j + 1}`,
      kind: 'class',
    }));
    s.timetable.push({
      id: `${id}-exam`,
      courseName: record.course.name,
      day: 3,
      start: '08:00',
      end: '09:30',
      room: 'B301',
      teacher: 'Cán bộ coi thi giả',
      kind: 'exam',
      date: '2026-12-15',
    });
    return s;
  });
}
export function makeScenario(scenario: string, id = 'test-c1'): CourseRecord {
  const r: CourseRecord = {
    id,
    course: {
      id: 'IT202',
      name: 'Cơ sở dữ liệu',
      credits: 3,
      required: true,
      isCore: true,
      prerequisites: ['IT101'],
      equivalents: [],
      syllabusVersion: 'MOCK-2025',
      syllabusVerified: false,
    },
    semester: '2026-1',
    classCode: 'MOCK-CNTT',
    learningAttempt: 1,
    examAttempt: 1,
    components: [
      { name: 'Quá trình', score: 8, weight: 0.4 },
      { name: 'Thi kết thúc', score: 5, weight: 0.6 },
    ],
    total: 6.2,
    letter: 'C',
    finalized: true,
    recordedStatus: 'passed',
    pi: [
      { id: 'PI1.1', clo: ['CLO1', 'CLO2'], plo: 'PLO1', score: 6.2, letter: 'C' },
      { id: 'PI2.1', clo: ['CLO3'], plo: 'PLO2', score: 6, letter: 'C' },
    ],
    expectedPi: ['PI1.1', 'PI2.1'],
    practiceRequired: true,
    practices: [{ id: 'report', title: 'Báo cáo học phần', completed: true }],
    attendance: { scheduledPeriods: 45, absentPeriods: 3 },
    examStatus: 'attended',
    improvement: false,
    rulePackId: NAU_2025.id,
    scenario,
  };
  if (scenario === 'pi_fail') {
    r.pi![1].score = 3;
    r.pi![1].letter = 'F';
    r.recordedStatus = 'failed';
  }
  if (scenario === 'missing_pi') r.pi = null;
  if (scenario === 'practice_fail') {
    r.practices[0].completed = false;
    r.recordedStatus = 'failed';
  }
  if (scenario === 'attendance_fail') {
    r.attendance!.absentPeriods = 23;
    r.recordedStatus = 'failed';
  }
  if (scenario === 'absent_exam') {
    r.examStatus = 'absent_unexcused';
    r.components[1].score = 0;
    r.total = 3.2;
    r.letter = 'F';
    r.recordedStatus = 'failed';
  }
  if (scenario === 'pending') {
    r.finalized = false;
    r.recordedStatus = 'pending';
  }
  if (scenario === 'conflict') r.recordedStatus = 'failed';
  if (scenario === 'rounding') {
    r.components = [
      { name: 'Quá trình', score: 3.9, weight: 0.4 },
      { name: 'Thi', score: 4, weight: 0.6 },
    ];
    r.total = 4;
    r.letter = 'D';
  }
  if (scenario === 'retake') r.examAttempt = 2;
  if (scenario === 'improvement') {
    r.improvement = true;
    r.previousTotal = 4.2;
    r.learningAttempt = 2;
  }
  if (scenario === 'unknown_core') r.course.isCore = null;
  return r;
}
export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
