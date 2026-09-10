import { normalize } from '@nau/domain';

type ScopeTurn = {
  role: 'user' | 'assistant';
  text: string;
  contextQuestion?: string;
  scope?: 'counseling' | 'out_of_scope';
};
const clean = (text: string) => normalize(text).replace(/\s+/g, ' ').trim();
const programmingObject =
  /\b(code|ma nguon|doan ma|source code|html|css|javascript|typescript|python|java|php|sql|react|website|trang web|web ban hang|ung dung|phan mem|api|script|giao dien|chuong trinh may tinh)\b/;
const creation =
  /\b(viet|tao|lam|xay dung|thiet ke|sua|fix|debug|hoan thien|bo sung|them|trien khai|write|create|build|implement|develop|generate|design)\b/;
const counselingQuestion =
  /\b(chon nganh|nganh nao|nganh gi|nen hoc|hoc nganh|hoc mon|mon nao|mon gi|hoc nhung gi|day nhung gi|co day|co hoc|ra truong|viec lam|nghe nghiep|dinh huong|chuong trinh dao tao|de cuong)\b/;
const careerQuestion =
  /\b(?:thi (?:nen )?(?:chon|hoc)|(?:nen|can) hoc (?:nganh|mon)|hoc nganh (?:nao|gi)|chon nganh (?:nao|gi))\b/;
const directCommand =
  /^(?:(?:hay|vui long|lam on|please)\s+|(?:toi|minh|em)\s+(?:muon|can)\s+|giup\s+(?:toi|minh|em)\s+)*(?:viet|tao|lam|xay dung|thiet ke|sua|fix|debug|hoan thien|bo sung|them|trien khai|write|create|build|implement|develop|generate|design|code|lap trinh)\b/;

function programmingRequest(question: string) {
  const q = clean(question);
  if (!programmingObject.test(q)) return false;
  const clauses = q.split(/[,;.!?\n]/).map((clause) => clause.trim());
  // An explicit deliverable wins over decorative mentions of a university or course.
  if (
    clauses.some(
      (clause) =>
        directCommand.test(clause) &&
        programmingObject.test(clause) &&
        !careerQuestion.test(clause),
    )
  )
    return true;
  // Mentioning programming while choosing a major or asking about a syllabus is counseling.
  return creation.test(q) && !counselingQuestion.test(q);
}

const counselingTopic =
  /\b(hoc phi|hoc bong|tuyen sinh|xet tuyen|diem chuan|quy che|quy dinh|thu tuc|lich hoc|lich thi|diem cua|bang diem|pi|cot loi|tot nghiep|no mon|gpa|ren luyen|ky tuc xa|thu vien|cong sinh vien|chuyen nganh|bao luu|thoi hoc|phuc khao|ho so|nganh hoc|nganh cntt)\b/;
const socialOnly =
  /^(?:xin chao|xin chafo|chao|hello|hi|hey|cam on|thanks|thank you|tam biet|bye|ban la ai|ban lam duoc gi|ok|oke|okay)(?:\s+(?:ban|nhe|nha|a|nau|ai|nau ai))*[.!?]*$/;
const continuation =
  /^(?:(?:hay|vay|the|gio|ok|okay)\s+)*(?:tiep tuc|viet tiep|lam tiep|noi tiep|noi them|noi ro|giai thich|tom tat|ngan hon|cho vi du|them|bo sung|sua|doi|lam (?:no|ban do|cai do)|ban do|cai do|doan do|no|con|tai sao|vi sao|continue|go on|make it|add|change|fix)\b/;

/** Explicit software-deliverable regression hint, not a complete topic classifier.
 * The model's system policy defines the full counseling scope for every request.
 */
export function outsideScopeQuestion(question: string, turns: readonly ScopeTurn[]): boolean {
  if (programmingRequest(question)) return true;
  const q = clean(question);
  if (socialOnly.test(q) || counselingQuestion.test(q) || counselingTopic.test(q)) return false;
  if (!continuation.test(q)) return false;
  const previousAssistant = [...turns].reverse().find((turn) => turn.role === 'assistant');
  if (previousAssistant?.scope) return previousAssistant.scope === 'out_of_scope';
  // Legacy answers have no scope metadata. Use the last user request, not generated code.
  const previousUser = [...turns].reverse().find((turn) => turn.role === 'user');
  return Boolean(previousUser && programmingRequest(previousUser.text));
}

/** High-signal code output check for buffered scope redirects, not semantic verification. */
export function containsProgrammingArtifact(text: string): boolean {
  return (
    /(?:^|\n)\s*(?:```|~~~)(?:html|css|jsx?|tsx?|javascript|typescript|python|py|java|php|sql|bash|sh|powershell|ps1|c\+\+|cpp|csharp|cs|ruby|go|rust|vue|svelte)\b/i.test(
      text,
    ) ||
    /<!doctype\s+html\b|<(?:html|head|body|script|style)(?:\s[^>]*|\s*)>/i.test(text) ||
    /<(?:div|form|button|input|section|main|table|h[1-6])\b[^>]*>[\s\S]*?<\/(?:div|form|button|section|main|table|h[1-6])\s*>/i.test(
      text,
    ) ||
    /(?:^|\n)\s*(?:(?:export\s+)?(?:async\s+)?function\s+[\w$]+\s*\([^)]*\)\s*\{|(?:const|let|var)\s+[\w$]+\s*=\s*[^\n]+;|(?:async\s+)?def\s+\w+\s*\([^)]*\)\s*:|(?:SELECT|INSERT INTO|CREATE TABLE)\s+[^\n]+(?:FROM|VALUES|\()[^\n]*;)/im.test(
      text,
    )
  );
}
