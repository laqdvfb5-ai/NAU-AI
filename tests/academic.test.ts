import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NauAcademicEvaluator,
  generateStudents,
  makeScenario,
  NAU_2025,
  gradeLetter,
  roundedGrade,
  SCENARIOS,
  type CourseRecord,
  type Student,
} from '@nau/domain';
const evaluator = new NauAcademicEvaluator();
const student = { ...generateStudents(7)[6], admittedAt: '2025-09-05', cohort: 2025 };
const evaluate = (r: CourseRecord, s: Student = student) => evaluator.evaluate(s, r, [NAU_2025]);
test('6.2 core course with an F PI fails with evidence and official record intact', () => {
  const r = makeScenario('pi_fail');
  const original = JSON.stringify(r);
  const out = evaluate(r);
  assert.equal(out.status, 'failed');
  assert.equal(out.recordedStatus, 'failed');
  assert.equal(out.recalculatedTotal, 6.2);
  assert.ok(out.conditions.some((c) => c.id === 'pi_PI2.1' && c.verdict === 'unmet'));
  assert.match(out.explanation, /PI2.1/);
  assert.match(out.citations[0].article!, /Điều 12/);
  assert.equal(JSON.stringify(r), original);
});
test('all core conditions met passes', () =>
  assert.equal(evaluate(makeScenario('passed')).status, 'passed'));
test('unknown PI letter cannot be treated as a pass', () => {
  const r = makeScenario('passed');
  r.pi![1].score = null;
  r.pi![1].letter = 'UNKNOWN';
  assert.equal(evaluate(r).status, 'conflict');
});
test('official pending status blocks a final conclusion even with a finalized flag', () => {
  const r = makeScenario('passed');
  r.recordedStatus = 'pending';
  assert.equal(evaluate(r).status, 'insufficient');
});
test('missing PI means insufficient, even when the total is sufficient', () =>
  assert.equal(evaluate(makeScenario('missing_pi')).status, 'insufficient'));
test('partial PI set is insufficient', () => {
  const r = makeScenario('passed');
  r.pi!.pop();
  assert.equal(evaluate(r).status, 'insufficient');
});
test('required course is not necessarily core', () => {
  const r = makeScenario('missing_pi');
  r.course.isCore = false;
  assert.equal(r.course.required, true);
  assert.equal(evaluate(r).status, 'passed');
});
test('mandatory practice incomplete fails', () =>
  assert.equal(evaluate(makeScenario('practice_fail')).status, 'failed'));
test('unknown completion is insufficient', () => {
  const r = makeScenario('passed');
  r.practices[0].completed = null;
  assert.equal(evaluate(r).status, 'insufficient');
});
test('attendance 50 percent or more requires retaking the course', () =>
  assert.equal(evaluate(makeScenario('attendance_fail')).status, 'failed'));
test('attendance at 30 percent blocks first exam', () => {
  const r = makeScenario('passed');
  r.attendance = { scheduledPeriods: 50, absentPeriods: 15 };
  r.recordedStatus = 'failed';
  assert.equal(evaluate(r).status, 'failed');
});
test('attendance below 30 percent meets this condition', () => {
  const r = makeScenario('passed');
  r.attendance = { scheduledPeriods: 50, absentPeriods: 14 };
  assert.equal(evaluate(r).status, 'passed');
});
test('unexcused exam absence fails', () =>
  assert.equal(evaluate(makeScenario('absent_exam')).status, 'failed'));
test('excused exam absence requires replacement result', () => {
  const r = makeScenario('passed');
  r.examStatus = 'absent_excused';
  assert.equal(evaluate(r).status, 'insufficient');
});
test('unfinalized grades cannot be concluded', () =>
  assert.equal(evaluate(makeScenario('pending')).status, 'insufficient'));
test('recorded/computed contradiction is explicit', () =>
  assert.equal(evaluate(makeScenario('conflict')).status, 'conflict'));
test('rounding 3.96 to 4.0 happens before letter conversion', () => {
  assert.equal(roundedGrade(3.96), 4);
  assert.equal(gradeLetter(3.96), 'D');
  assert.equal(evaluate(makeScenario('rounding')).status, 'passed');
});
test('letter grade boundaries', () => {
  for (const [n, l] of [
    [3.9, 'F'],
    [4, 'D'],
    [5, 'D+'],
    [5.5, 'C'],
    [6.5, 'C+'],
    [7, 'B'],
    [8, 'B+'],
    [8.5, 'A'],
    [10, 'A'],
  ] as const)
    assert.equal(gradeLetter(n), l);
});
test('resit requires confirmed selection and cap, no invented result', () =>
  assert.equal(evaluate(makeScenario('retake')).status, 'insufficient'));
test('improvement requires confirmed selection', () =>
  assert.equal(evaluate(makeScenario('improvement')).status, 'insufficient'));
test('unknown core classification is insufficient', () =>
  assert.equal(evaluate(makeScenario('unknown_core')).status, 'insufficient'));
test('2025 regulation cannot silently apply to 2023/2024', () => {
  for (const year of [2023, 2024])
    assert.equal(
      evaluate(makeScenario('passed'), { ...student, cohort: year, admittedAt: `${year}-09-01` })
        .status,
      'insufficient',
    );
});
test('unverified or mismatched regulation is insufficient', () => {
  const r = makeScenario('passed');
  r.rulePackId = 'unverified';
  assert.equal(evaluate(r).status, 'insufficient');
  assert.equal(
    evaluator.evaluate(student, makeScenario('passed'), [{ ...NAU_2025, sourceVerified: false }])
      .status,
    'insufficient',
  );
});
test('on enactment date is not after enactment', () =>
  assert.equal(
    evaluate(makeScenario('passed'), { ...student, admittedAt: '2025-06-26' }).status,
    'insufficient',
  ));
test('out of range grades and invalid attendance are conflicts', () => {
  for (const patch of [{ total: 11 }, { attendance: { scheduledPeriods: 10, absentPeriods: 11 } }])
    assert.equal(evaluate({ ...makeScenario('passed'), ...patch }).status, 'conflict');
});
test('component total mismatch and invalid weights are conflicts', () => {
  const r = makeScenario('passed');
  r.components[0].score = 2;
  assert.equal(evaluate(r).status, 'conflict');
  r.components[0].weight = 0.3;
  assert.equal(evaluate(r).status, 'conflict');
});
test('PI numeric/letter contradiction is conflict', () => {
  const r = makeScenario('passed');
  r.pi![1].letter = 'F';
  assert.equal(evaluate(r).status, 'conflict');
});
test('synthetic generation is reproducible, balanced and covers all scenarios', () => {
  const a = generateStudents(120);
  assert.deepEqual(a, generateStudents(120));
  assert.equal(new Set(a.map((s) => s.id)).size, 120);
  for (const major of ['Công nghệ thông tin', 'Kế toán', 'Marketing'])
    for (const cohort of [2023, 2024, 2025, 2026])
      assert.equal(a.filter((s) => s.major === major && s.cohort === cohort).length, 10);
  for (const scenario of SCENARIOS)
    assert.ok(
      a.some((s) => s.courses.some((c) => c.scenario === scenario)),
      scenario,
    );
  assert.ok(a.every((s) => s.synthetic && !s.programVerified));
});
test('3000 profiles have unique fake identities and independent records', () => {
  const rows = generateStudents(3000);
  assert.equal(new Set(rows.map((s) => s.id)).size, 3000);
  const old = rows[1].courses[0].pi![0].score;
  rows[0].courses[0].pi![0].score = 0;
  assert.equal(rows[1].courses[0].pi![0].score, old);
});
