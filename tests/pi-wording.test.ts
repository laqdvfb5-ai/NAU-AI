import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasMissingPiFailureClaim, needsPiWordingCheck } from '../apps/api/src/dialogue.js';

test('PI wording check covers recorded failures and missing data, including PI identifiers', () => {
  for (const evidence of [
    'PI2.1 là F (3/10), chưa đạt điều kiện PI.',
    'PI2.1: F (3/10).',
    'Chưa có dữ liệu PI để kết luận.',
    'Không có điểm PI nên cần đối soát.',
    'Thiếu **PI**.',
  ])
    assert.equal(needsPiWordingCheck(evidence), true, evidence);
  for (const evidence of ['Học phí học kỳ này.', 'API trả kết quả.', 'Điểm tổng 6,2/10.'])
    assert.equal(needsPiWordingCheck(evidence), false, evidence);
});

test('missing PI cannot be presented as failing using common causal forms', () => {
  for (const text of [
    'Nếu điểm tổng đủ nhưng có PI bị F, thiếu PI, hoặc chưa hoàn thành thực hành thì vẫn chưa đạt học phần cốt lõi.',
    'Thiếu PI thì không đạt học phần.',
    'Học phần chưa đạt vì thiếu PI.',
    'Bạn trượt môn do chưa có điểm PI.',
    'Không có dữ liệu PI nên bạn rớt môn.',
    'Thiếu **PI** thì trượt học phần.',
    'Thiếu `PI` sẽ bị chưa đạt.',
    'Thiếu PI có nghĩa là trượt học phần.',
    'Thiếu PI: học phần không đạt.',
    'Bạn đang thiếu PI. Vì vậy bạn trượt học phần.',
    'Thiếu PI. Do đó học phần chưa đạt.',
    'Chưa đủ dữ liệu để kết luận, nhưng thiếu PI thì trượt học phần.',
  ])
    assert.equal(hasMissingPiFailureClaim(text), true, text);
});

test('uncertainty, negation and explicit comparisons with PI F remain valid', () => {
  for (const text of [
    'Thiếu dữ liệu PI thì chưa đủ dữ liệu để kết luận. PI mức F là không đạt điều kiện PI.',
    'Thiếu PI thì chưa đủ dữ liệu để kết luận, còn PI F thì chưa đạt điều kiện PI.',
    'PI F thì chưa đạt điều kiện PI; thiếu PI thì chưa đủ dữ liệu.',
    'Không thể kết luận rằng thiếu PI thì trượt học phần.',
    'Không thể nói rằng thiếu **PI** thì không đạt học phần.',
    'Không nên nói thiếu PI là trượt.',
    'Thiếu PI không có nghĩa là trượt.',
    'Thiếu PI không đồng nghĩa với chưa đạt.',
    'Thiếu PI thì chưa thể kết luận đạt hay trượt.',
    'Thiếu PI chưa đủ căn cứ để kết luận trượt.',
    'Thiếu PI nên hỏi giảng viên để tránh trượt môn.',
    'Bạn đang thiếu PI. PI F thì chưa đạt điều kiện PI.',
    'Bạn đang thiếu PI. Bạn có thể kiểm tra hồ sơ. Vì vậy bạn trượt học phần.',
    'Bài thực hành chưa đạt; dữ liệu PI còn thiếu.',
  ])
    assert.equal(hasMissingPiFailureClaim(text), false, text);
});
