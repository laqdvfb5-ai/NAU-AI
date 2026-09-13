import {
  BadGatewayException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID, createHmac } from 'node:crypto';
import {
  NauAcademicEvaluator,
  normalize,
  type AcademicResult,
  type Citation,
  type LLMProvider,
  type RulePack,
  type Student,
  type StudentDataProvider,
} from '@nau/domain';
import { Database } from './database.js';
import type { Session } from './auth.js';
import { KnowledgeService } from './knowledge.js';
import { env } from './config.js';
import { outsideScopeQuestion, containsProgrammingArtifact } from './scope.js';
import {
  socialIntent,
  resolveQuestion,
  boundedHistory,
  missingPiHypothesis,
  needsPiWordingCheck,
  hasMissingPiFailureClaim,
  hasValidNauIdentity,
  catalogQuestion,
  isPublicStudentGuidance,
  isStudentServiceQuestion,
  type StoredTurn,
} from './dialogue.js';
import { ChatModelException, chatFailureLog } from './chat-errors.js';
export interface ChatProgress {
  stage: 'reasoning' | 'searching' | 'checking' | 'generating' | 'validating';
  message: string;
}
export interface ChatAnswer {
  id: string;
  role: 'assistant';
  text: string;
  citations: Citation[];
  evaluations: AcademicResult[];
  mode: string;
  model: string;
  synthetic: boolean;
  needsLogin: boolean;
  createdAt: string;
  conversationId?: string;
  warning?: string;
  providerId?: string;
  providerName?: string;
  contextQuestion?: string;
  scope?: 'counseling' | 'out_of_scope';
}
export const ownerKey = (session: Session) =>
  session.identity
    ? createHmac('sha256', process.env.SESSION_SECRET!)
        .update('account:' + session.identity.accountId)
        .digest('hex')
    : session.hash;
function historyMessageFor(session: Session, data: unknown) {
  if (
    session.identity?.role === 'admin' ||
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data)
  )
    return data;
  const visible = { ...(data as Record<string, unknown>) };
  delete visible.providerId;
  delete visible.providerName;
  return visible;
}
const money = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + ' đồng';
export class ChatService {
  evaluator = new NauAcademicEvaluator();
  private readonly logger = new Logger(ChatService.name);
  constructor(
    private db: Database,
    private knowledge: KnowledgeService,
    private llm: LLMProvider,
    private students: StudentDataProvider = db,
  ) {}
  async rules() {
    return (await this.db.query<{ data: RulePack }>('SELECT data FROM rules')).map((r) => r.data);
  }
  async evaluations(s: Student) {
    const rules = (await this.rules()).filter((r) => s.synthetic || r.institutionApproved);
    return s.courses.map((r) =>
      this.evaluator.evaluate(
        s,
        r,
        !s.synthetic && (!s.programVerified || !r.course.syllabusVerified) ? [] : rules,
      ),
    );
  }
  async conversations(session: Session) {
    return this.db.query(
      'SELECT id,title,created_at,updated_at FROM conversations WHERE owner_hash=$1 ORDER BY updated_at DESC LIMIT 50',
      [ownerKey(session)],
    );
  }
  async assertConversation(id: string, session: Session) {
    const [row] = await this.db.query(
      'SELECT id FROM conversations WHERE id=$1 AND owner_hash=$2',
      [id, ownerKey(session)],
    );
    if (!row) throw new NotFoundException('Không tìm thấy hội thoại.');
  }
  async history(id: string, session: Session) {
    await this.assertConversation(id, session);
    return (
      await this.db.query(
        'SELECT data FROM messages WHERE conversation_id=$1 ORDER BY created_at,id',
        [id],
      )
    ).map((r) => historyMessageFor(session, r.data));
  }
  async answer(
    question: string,
    session: Session,
    conversationId?: string,
    ephemeral = false,
    signal?: AbortSignal,
    onText?: (delta: string) => void,
    onStatus?: (progress: ChatProgress) => void,
  ): Promise<ChatAnswer> {
    signal?.throwIfAborted();
    onStatus?.({ stage: 'reasoning', message: 'Đang phân tích câu hỏi và ngữ cảnh hội thoại' });
    await this.llm.refresh?.();
    if (conversationId && !ephemeral) await this.assertConversation(conversationId, session);
    const turns: StoredTurn[] =
      conversationId && !ephemeral
        ? (
            await this.db.query(
              'SELECT data FROM messages WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 8',
              [conversationId],
            )
          )
            .reverse()
            .map((r) => r.data)
        : [];
    const effectiveQuestion = resolveQuestion(question, turns);
    const faq = catalogQuestion(effectiveQuestion);
    const privateTopic =
      faq?.dataScope === 'personal'
        ? (
            {
              tuition: 'hoc phi',
              'financial-aid': 'hoc bong',
              registration: 'lich hoc',
              exams: 'lich thi',
              'graduation-career': 'tot nghiep',
              'activities-conduct': 'ren luyen',
            } as Record<string, string>
          )[faq.categoryId] || ''
        : '';
    const q = normalize(effectiveQuestion) + (privateTopic ? ` ${privateTopic} cua toi` : ''),
      student =
        session.identity?.role === 'student'
          ? await this.students.getStudent(session.identity.studentId!)
          : null;
    const result: ChatAnswer = {
      id: randomUUID(),
      role: 'assistant',
      text: '',
      citations: [],
      evaluations: [],
      mode: this.llm.mode,
      model: '',
      synthetic: env.synthetic,
      needsLogin: false,
      createdAt: new Date().toISOString(),
    };
    let kind = 'public';
    let facts: unknown;
    const social = socialIntent(question);
    const outsideScope = outsideScopeQuestion(question, turns);
    const explicitPublic =
      /quy che|quy dinh|thong tin chung|cua truong|tuyen sinh|diem chuan|cong bo/.test(q);
    const academicTopic =
      /\b(diem|qua mon|qua hoc phan|pi|truot|rot|hoc phi|hoc bong|mien giam|lich hoc|lich thi|cong no|tien do|gpa|ren luyen|no mon|tai chinh|tot nghiep|ho so|dang ky|huy mon)\b/.test(
        q,
      );
    const personal =
      !isPublicStudentGuidance(effectiveQuestion) &&
      academicTopic &&
      (/(cua|cho) (toi|minh|em)|toi (no|rot|truot|khong|chua|du|qua|hoc)|minh (no|rot|truot|khong|chua|du|qua)|diem cua|lich (hoc|thi)|cong no|tien do|gpa|ren luyen|no mon|hoc phi (toi|minh|em)/.test(
        q,
      ) ||
        Boolean(
          student &&
          !explicitPublic &&
          /\b(diem|qua mon|qua hoc phan|pi|truot|rot|tai chinh|tot nghiep)\b|6[,.]2/.test(q),
        ));
    const references = [...effectiveQuestion.matchAll(/\bMOCK\d{5}\b|\bsv\d{3,5}\b/gi)].map((m) =>
      m[0].toUpperCase(),
    );
    const allowedReferences = new Set(student ? [student.id.toUpperCase()] : []);
    if (references.length && student && session.identity) {
      // Only read the authenticated account's alias; never resolve another student's identifier.
      const [account] = await this.db.query<{ username: string }>(
        "SELECT username FROM accounts WHERE id=$1 AND identity->>'studentId'=$2",
        [session.identity.accountId, student.id],
      );
      if (account) allowedReferences.add(account.username.toUpperCase());
    }
    const hypotheticalPi = missingPiHypothesis(effectiveQuestion);
    if (references.some((reference) => !allowedReferences.has(reference))) {
      kind = 'access_denied';
      facts = { access: 'own_session_only', requestedOtherStudent: true, otherStudentData: null };
    } else if (outsideScope) {
      kind = 'out_of_scope';
      facts = {
        requestWithinCounselingScope: false,
        allowedTopics: [
          'Thông tin nhà trường và tuyển sinh',
          'Chọn ngành và định hướng học tập',
          'Quy chế, kết quả học tập và thủ tục sinh viên',
          'Lịch học, học phí, học bổng và dịch vụ sinh viên',
        ],
        requestedDeliverableAvailable: false,
      };
      result.scope = 'out_of_scope';
      result.contextQuestion = question;
    } else if (social) {
      kind = 'conversation';
      facts = {
        intent: social,
        assistant: 'NAU AI',
        institution: 'NAU – Trường Đại học Nghệ An',
        productIdentityRemainsNauAiWhenUnderlyingModelChanges: true,
        ...(social === 'identity' || social === 'origin'
          ? {
              requiredIdentityFacts: [
                'Tên sản phẩm là NAU AI',
                'Trợ lý AI của NAU – Trường Đại học Nghệ An',
                'Được nghiên cứu và phát triển bởi hai đại thi hào K12A3 Lê Anh Quốc và Nguyễn Văn Thương',
              ],
              researchAndDevelopment: {
                group: 'K12A3',
                people: ['Lê Anh Quốc', 'Nguyễn Văn Thương'],
                title: 'hai đại thi hào',
              },
            }
          : {}),
        ...(social === 'capabilities'
          ? {
              capabilities: [
                'Tuyển sinh, học phí, học bổng, miễn giảm và vay vốn theo nguồn đã kiểm tra',
                'Giấy xác nhận, bảo lưu, chuyển ngành và thủ tục học tập',
                'Thư viện, LMS, ký túc xá, hoạt động và nơi hỗ trợ sinh viên',
                'Thực tập, hướng nghiệp, quy chế và giải thích học vụ',
                'Tra điểm, lịch, học phí của chính người đăng nhập',
              ],
            }
          : {}),
        synthetic: env.synthetic,
        role: session.identity?.role || 'guest',
      };
    } else if (hypotheticalPi) {
      kind = 'hypothetical';
      facts = {
        scenario: 'Thiếu dữ liệu PI',
        conclusion: 'Chưa đủ dữ liệu để kết luận',
        missingPiIsNotRecordedF: true,
        actualRecordChanged: false,
        required: ['Điểm PI đã chốt', 'Đề cương học phần', 'Quy chế đúng khóa'],
        nextSteps: [
          'Kiểm tra cổng sinh viên',
          'Liên hệ giảng viên hoặc phòng đào tạo nếu thiếu dữ liệu',
        ],
      };
    } else if (/dang ky|huy (mon|hoc phan)|gui ho so/.test(q) && personal) {
      kind = 'unsupported_action';
      facts = {
        handlerAvailable: false,
        executed: false,
        changed: false,
        nextStep: 'Tra cứu thủ tục tại cổng sinh viên chính thức',
      };
      result.citations = [
        {
          id: 'student-portal',
          title: 'Cổng sinh viên NAU',
          url: 'https://sinhvien.nau.edu.vn/',
          version: 'Liên kết chính thức',
          excerpt: 'Cổng sinh viên',
        },
      ];
    } else if (personal && !student) {
      kind = 'login_required';
      facts = { authenticatedStudent: false, privateData: null, synthetic: env.synthetic };
      result.needsLogin = true;
      if (session.identity?.role === 'admin') {
        kind = 'unmapped_account';
        facts = {
          role: 'admin',
          studentMapping: null,
          synthetic: env.synthetic,
          demoStudentAccount: env.demo ? 'sv007' : undefined,
          publicQuestionsAvailable: true,
        };
        result.needsLogin = false;
      }
    } else if (personal && student) {
      kind = 'personal';
      onStatus?.({
        stage: 'checking',
        message: 'Đang đối chiếu hồ sơ của bạn với quy chế áp dụng',
      });
      const parts: string[] = [];
      if (/diem|qua mon|qua hoc phan|pi|truot|rot|6[,.]2|no mon/.test(q)) {
        const all = await this.evaluations(student);
        const currentQuestion = normalize(question);
        const matchesCourse = (text: string) =>
          student.courses.filter(
            (c) =>
              text.includes(normalize(c.course.name)) || text.includes(c.course.id.toLowerCase()),
          );
        const currentNamed = matchesCourse(currentQuestion);
        const named = currentNamed.length ? currentNamed : matchesCourse(q);
        if (currentNamed.length) result.contextQuestion = `Điểm của tôi: ${question}`;
        result.evaluations = named.length
          ? all.filter((e) => named.some((c) => c.id === e.recordId))
          : /tat ca|no mon|bang diem/.test(q)
            ? all
            : [all[0]];
        parts.push(
          ...result.evaluations.map(
            (e) =>
              `${e.courseName}\nKết quả đang ghi nhận: ${e.recordedStatus === 'passed' ? 'đạt' : e.recordedStatus === 'failed' ? 'chưa đạt' : 'chưa chốt'} (hồ sơ giả).\n${e.explanation}\nBước tiếp theo: ${e.nextSteps.join(' ')}`,
          ),
        );
        result.citations = result.evaluations.flatMap((e) => e.citations);
      }
      if (/hoc phi|cong no|tai chinh/.test(q)) {
        const charges = student.finance.charges;
        parts.push(
          `Học phí học kỳ ${student.finance.semester} (dữ liệu giả):\n${charges.map((c) => `${c.title}: phải thu ${money(c.amount)}, đã thanh toán ${money(c.paid)}, còn nợ ${money(c.amount - c.paid)}; hạn ${c.dueDate}.`).join('\n')}\nSố tiền này không phải biểu học phí công bố của trường.`,
        );
      }
      if (/mien giam|hoc bong/.test(q))
        parts.push(
          'Chưa có dữ liệu học bổng hoặc quyết định miễn giảm cá nhân trong adapter hiện tại; không thể suy ra từ các khoản thu học phí.',
        );
      if (/lich hoc|lich thi/.test(q))
        parts.push(
          `Lịch ${q.includes('lich thi') ? 'thi' : 'học'} của bạn (dữ liệu giả):\n${student.timetable
            .filter((t) => t.kind === (q.includes('lich thi') ? 'exam' : 'class'))
            .map(
              (t) =>
                `${t.courseName} — ${t.date || 'Thứ ' + t.day}, ${t.start}–${t.end}, phòng ${t.room}.`,
            )
            .join('\n')}`,
        );
      if (/gpa|tien do|tot nghiep/.test(q))
        parts.push(
          `GPA đang ghi nhận: ${student.progress.gpa}/4. Tín chỉ tích lũy: ${student.progress.earnedCredits}/${student.progress.requiredCredits}. Chứng chỉ chưa hoàn thành: ${student.progress.certificates
            .filter((c) => !c.completed)
            .map((c) => c.name)
            .join(
              ', ',
            )}. Chương trình và các điều kiện tốt nghiệp là giả lập, chưa được trường xác minh; chưa đủ căn cứ kết luận đủ điều kiện tốt nghiệp.`,
        );
      if (/ren luyen/.test(q))
        parts.push(
          student.conduct
            .map((c) => `Rèn luyện kỳ ${c.semester}: ${c.score}/100 — ${c.status}.`)
            .join('\n'),
        );
      facts =
        parts.join('\n\n') ||
        `Bạn đang xem hồ sơ giả ${student.id}, ngành ${student.major}, khóa ${student.cohort}. Mình có thể tra điểm, lịch học, học phí, rèn luyện và tiến độ học tập của bạn.`;
    } else {
      onStatus?.({ stage: 'searching', message: 'Đang tìm nguồn trong kho kiến thức của trường' });
      const mentionedCohort = q.match(/khoa\s*(20\d{2})/)?.[1];
      const hits = await this.knowledge.search(
        effectiveQuestion,
        mentionedCohort ? mentionedCohort + '-09-01' : student?.admittedAt,
      );
      if (!hits.length) {
        const schoolQuestion = isStudentServiceQuestion(effectiveQuestion);
        kind = schoolQuestion ? 'source_gap' : 'conversation';
        facts = {
          verifiedSchoolSources: [],
          schoolQuestion,
          synthetic: env.synthetic,
          intent: schoolQuestion ? 'missing_school_evidence' : 'clarify_counseling_intent',
          requestedCohort: mentionedCohort || student?.cohort || null,
          requiredSource: faq?.requiredSource || null,
        };
      } else {
        facts = hits.map((h) => h.text).join('\n\n');
        result.citations = hits.map((h) => h.citation);
      }
    }
    result.citations = result.citations.filter(
      (s, i, all) => all.findIndex((x) => x.id === s.id) === i,
    );
    // Store only a server-selected topic for follow-up resolution. Source text cannot change identity or routing.
    if (
      !result.contextQuestion &&
      (result.evaluations.length ||
        result.citations.length ||
        kind === 'source_gap' ||
        hypotheticalPi ||
        (personal && !social))
    )
      result.contextQuestion = effectiveQuestion;
    signal?.throwIfAborted();
    if (this.llm.mode === 'evidence')
      throw new ServiceUnavailableException(
        'Chưa có model AI sẵn sàng. Vui lòng cấu hình và chọn API cho chat trong trang quản trị.',
      );
    const evidence = JSON.stringify({ kind, facts });
    const checkPi = needsPiWordingCheck(evidence);
    const checkIdentity = social === 'identity' || social === 'origin';
    const checkScope =
      outsideScope || kind === 'source_gap' || (kind === 'conversation' && !social);
    const bufferAnswer = checkPi || checkScope || checkIdentity;
    onStatus?.({ stage: 'generating', message: 'Model AI đang soạn câu trả lời' });
    let response;
    try {
      response = await this.llm.generate({
        requestId: result.id,
        sensitivity: kind === 'personal' ? 'personal' : 'public',
        question,
        evidence,
        history: boundedHistory(turns),
        complex: result.evaluations.length > 1 || (/hoc phi/.test(q) && /diem/.test(q)),
        signal,
        onText: bufferAnswer
          ? undefined
          : (delta) => {
              if (!signal?.aborted) onText?.(delta);
            },
      });
    } catch (error) {
      signal?.throwIfAborted();
      const failure = new ChatModelException(error);
      this.logger.warn(
        JSON.stringify(
          chatFailureLog(failure.publicPayload(), {
            stage: 'model_generation',
            mode: this.llm.mode,
            role: session.identity?.role || 'guest',
            ephemeral,
          }),
        ),
      );
      throw failure;
    }
    signal?.throwIfAborted();
    if (!response.text?.trim() || response.model === 'evidence' || response.mode === 'evidence')
      throw new BadGatewayException('Model AI chưa trả về câu trả lời hợp lệ. Vui lòng thử lại.');
    if (checkScope) {
      onStatus?.({ stage: 'validating', message: 'Đang kiểm tra phạm vi tư vấn' });
      if (containsProgrammingArtifact(response.text))
        throw new BadGatewayException(
          'Model AI đã tạo nội dung ngoài phạm vi tư vấn. Câu trả lời này chưa được lưu; vui lòng thử lại.',
        );
    }
    if (checkIdentity) {
      onStatus?.({ stage: 'validating', message: 'Đang kiểm tra danh tính NAU AI' });
      if (!hasValidNauIdentity(response.text, [response.model, response.providerName]))
        throw new BadGatewayException(
          'Model AI chưa giữ đúng danh tính NAU AI. Câu trả lời này chưa được lưu; vui lòng thử lại.',
        );
    }
    if (checkPi) {
      onStatus?.({ stage: 'validating', message: 'Đang kiểm tra cách diễn giải điều kiện PI' });
      if (hasMissingPiFailureClaim(response.text))
        throw new BadGatewayException(
          'Câu trả lời của model chưa phân biệt đúng thiếu dữ liệu PI với PI mức F. Vui lòng thử lại.',
        );
    }
    result.text = response.text;
    result.model = response.model;
    if (session.identity?.role === 'admin') {
      result.providerId = response.providerId;
      result.providerName = response.providerName;
    }
    result.mode = response.mode || this.llm.mode;
    if (bufferAnswer) onText?.(response.text);
    if (!ephemeral && !signal?.aborted) {
      const id = conversationId || randomUUID();
      if (!conversationId)
        await this.db.query('INSERT INTO conversations(id,owner_hash,title) VALUES($1,$2,$3)', [
          id,
          ownerKey(session),
          question.slice(0, 80),
        ]);
      const userMessage = {
        id: randomUUID(),
        role: 'user',
        text: question,
        createdAt: new Date(Date.now() - 1).toISOString(),
      };
      result.createdAt = new Date().toISOString();
      result.conversationId = id;
      await this.db.query(
        'INSERT INTO messages(id,conversation_id,role,data,created_at) VALUES($1,$2,$3,$4,$5)',
        [userMessage.id, id, 'user', JSON.stringify(userMessage), userMessage.createdAt],
      );
      await this.db.query(
        'INSERT INTO messages(id,conversation_id,role,data,created_at) VALUES($1,$2,$3,$4,$5)',
        [result.id, id, 'assistant', JSON.stringify(result), result.createdAt],
      );
      await this.db.query('UPDATE conversations SET updated_at=now() WHERE id=$1', [id]);
    }
    return result;
  }
}
