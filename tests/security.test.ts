import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSourceUrl, detectsPrivateData } from '../apps/api/src/ingestion.js';
test('source URLs reject internal networks, credentials, ports and lookalike domains', () => {
  for (const url of [
    'http://nau.edu.vn',
    'https://127.0.0.1',
    'https://nau.edu.vn.evil.example',
    'https://nau.edu.vn:8443',
    'https://user:pass@nau.edu.vn',
    'file:///etc/passwd',
    'https://localhost',
    'https://169.254.169.254',
  ])
    assert.throws(() => validateSourceUrl(url), url);
});
test('official and explicitly linked domains are accepted', () => {
  for (const url of [
    'https://nau.edu.vn/',
    'https://www.nau.edu.vn/a.pdf',
    'https://lms.naue.edu.vn/',
  ])
    assert.equal(validateSourceUrl(url).protocol, 'https:');
});
test('public grade lists and identity tables are excluded', () => {
  for (const text of [
    'Danh sách sinh viên nhận học bổng, họ tên và mã sinh viên',
    'Bảng điểm học phần',
    'Số căn cước 123456789012',
    'Họ tên, ngày sinh',
  ])
    assert.equal(detectsPrivateData(text), true);
  assert.equal(detectsPrivateData('Học phần cốt lõi yêu cầu tất cả PI trên mức F.'), false);
});
