import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outsideScopeQuestion, containsProgrammingArtifact } from '../apps/api/src/scope.js';

test('software deliverables are outside counseling even with university or feedback wording', () => {
  for (const question of [
    'viet code html web ban hang co ban',
    'Viết HTML website bán hàng cho sinh viên NAU',
    'Làm hộ code bài tập môn lập trình HTML',
    'Bạn trả lời sai, viết lại HTML cho tôi',
    'Bạn trả lời sai viết lại HTML cho tôi',
    'Xin chào, tạo một trang web bán hàng',
    'Tôi muốn viết code HTML có bảng học phí NAU',
    'Hãy tạo website cho môn lập trình của tôi',
    'Giúp em sửa code Python này',
    'Please build a shopping website',
    'Write a Python script',
    'Ngành CNTT học gì? Viết code một website bán hàng',
  ])
    assert.equal(outsideScopeQuestion(question, []), true, question);
});

test('curriculum, career, student support and greetings are not software deliverables', () => {
  for (const question of [
    'Ngành CNTT học những gì?',
    'Học lập trình web thì chọn ngành nào?',
    'Em muốn học viết code thì nên học ngành nào?',
    'Tôi muốn tạo website thì nên học ngành nào?',
    'Em muốn làm phần mềm thì chọn ngành gì?',
    'Học HTML có cơ hội việc làm gì?',
    'Chương trình đào tạo có dạy tạo website không?',
    'Làm lập trình web thì chọn ngành nào?',
    'Trường có dạy HTML không?',
    'Đề cương môn lập trình web có những gì?',
    'Em trượt môn, cần làm gì?',
    'Học phí ngành CNTT bao nhiêu?',
    'Quy chế điểm PI của NAU',
    'xin chafo',
    'bạn là ai',
    'cảm ơn bạn',
    'Bạn trả lời sai rồi',
  ])
    assert.equal(outsideScopeQuestion(question, []), false, question);
});

test('continuations cannot resume a legacy HTML answer or a rejected task', () => {
  const legacy = [
    { role: 'user' as const, text: 'viet code html web ban hang co ban' },
    { role: 'assistant' as const, text: '<!DOCTYPE html><html><body>Shop</body></html>' },
  ];
  const marked = [
    { role: 'user' as const, text: 'an unrelated task' },
    { role: 'assistant' as const, text: 'Model redirect', scope: 'out_of_scope' as const },
  ];
  for (const turns of [legacy, marked])
    for (const question of ['tiếp tục', 'thêm CSS cho nó', 'làm bản đó đẹp hơn', 'vì sao vậy?'])
      assert.equal(outsideScopeQuestion(question, turns), true, question);
});

test('real counseling topic switches and greetings reset an unrelated task', () => {
  const turns = [
    { role: 'user' as const, text: 'viet code html web ban hang co ban' },
    { role: 'assistant' as const, text: 'Model redirect', scope: 'out_of_scope' as const },
  ];
  for (const question of [
    'Còn học phí NAU?',
    'Vậy quy chế PI thì sao?',
    'Còn ngành nào dạy lập trình web?',
    'xin chào bạn',
    'bạn là ai',
  ])
    assert.equal(outsideScopeQuestion(question, turns), false, question);
  const reset = [
    ...turns,
    { role: 'user' as const, text: 'Còn học phí NAU?' },
    { role: 'assistant' as const, text: 'School information', scope: 'counseling' as const },
  ];
  assert.equal(outsideScopeQuestion('Nói thêm', reset), false);
  assert.equal(outsideScopeQuestion('Tạo code HTML cho tôi', reset), true);
  assert.equal(outsideScopeQuestion('Tiếp tục', []), false);
});

test('artifact guard catches fenced code, executable HTML and clear source syntax', () => {
  for (const output of [
    '```html\n<div>Shop</div>\n```',
    '~~~python\nprint(1)\n~~~',
    '<!DOCTYPE html><html lang="vi"><body>Shop</body></html>',
    '<script>alert(1)</script>',
    '<form><input name="q"><button>Buy</button></form>',
    'Sau đây là mã:\nconst products = [];',
    'function addProduct(id) { return id; }',
    'def calculate(x):\n  return x',
    'SELECT name FROM students;',
  ])
    assert.equal(containsProgrammingArtifact(output), true, output);
});

test('artifact guard leaves plain counseling and descriptions untouched', () => {
  for (const output of [
    'Mình hỗ trợ tư vấn học vụ NAU. Bạn cần hỏi về tuyển sinh hay ngành CNTT?',
    'HTML và CSS thường xuất hiện trong nội dung học lập trình web; cần kiểm tra đề cương.',
    'Mình không hỗ trợ viết code website bán hàng trong cuộc trò chuyện tư vấn sinh viên.',
    'PI < 4 chưa đáp ứng điều kiện này; thiếu dữ liệu PI thì chưa đủ cơ sở kết luận.',
    'Các ký hiệu function, const, SELECT không phải quy định đào tạo.',
    '```text\nHọc phí: cần tra nguồn chính thức.\n```',
  ])
    assert.equal(containsProgrammingArtifact(output), false, output);
});
