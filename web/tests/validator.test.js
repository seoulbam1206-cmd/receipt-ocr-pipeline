import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReceipt, isValidBizNo, computeDupHash, STATUS } from '../src/services/validator.js';
import { categorize } from '../src/services/categorizer.js';
import { parseReceipt } from '../src/services/parser.js';
import { FIXTURES } from './fixtures.js';

const NOW = new Date(2026, 9, 27, 15, 0, 0); // 2026-10-27 (로컬)
const base = () => ({
  merchant: '가상커피 테스트점',
  bizNo: '999-99-99997',
  date: '2026-10-27',
  supplyAmount: 12727,
  vat: 1273,
  totalAmount: 14000,
});
const codes = (res) => res.issues.map((i) => i.code);

test('정상 영수증은 CONFIRMED', () => {
  const res = validateReceipt(base(), { ocrConfidence: 0.9, now: NOW });
  assert.equal(res.valid, true);
  assert.deepEqual(res.issues, []);
  assert.equal(res.status, STATUS.CONFIRMED);
  assert.equal(res.confidence, 0.96); // 0.9*0.4 + 1*0.6
});

test('합계 불일치(±1원 초과)', () => {
  const res = validateReceipt({ ...base(), totalAmount: 14500 }, { ocrConfidence: 0.9, now: NOW });
  assert.equal(res.valid, false);
  assert.ok(codes(res).includes('AMOUNT_MISMATCH'));
});

test('±1원 반올림 오차는 허용', () => {
  const res = validateReceipt({ ...base(), totalAmount: 14001 }, { ocrConfidence: 0.9, now: NOW });
  assert.ok(!codes(res).includes('AMOUNT_MISMATCH'));
});

test('사업자번호 체크섬 오류', () => {
  assert.equal(isValidBizNo('999-99-99997'), true);
  assert.equal(isValidBizNo('999-99-99998'), false);
  assert.equal(isValidBizNo('12-345'), false);
  const res = validateReceipt({ ...base(), bizNo: '999-99-99998' }, { ocrConfidence: 0.9, now: NOW });
  assert.ok(codes(res).includes('INVALID_BIZ_NO'));
});

test('미래 날짜', () => {
  const res = validateReceipt({ ...base(), date: '2026-10-28' }, { ocrConfidence: 0.9, now: NOW });
  assert.ok(codes(res).includes('FUTURE_DATE'));
});

test('5년 초과 날짜', () => {
  const res = validateReceipt({ ...base(), date: '2021-10-26' }, { ocrConfidence: 0.9, now: NOW });
  assert.ok(codes(res).includes('DATE_TOO_OLD'));
  const ok = validateReceipt({ ...base(), date: '2021-10-27' }, { ocrConfidence: 0.9, now: NOW });
  assert.ok(!codes(ok).includes('DATE_TOO_OLD'));
});

test('필수 필드 누락은 신뢰도와 무관하게 REVIEW_REQUIRED', () => {
  const res = validateReceipt({ ...base(), merchant: null }, { ocrConfidence: 1, now: NOW });
  assert.ok(codes(res).includes('MISSING_FIELDS'));
  assert.equal(res.status, STATUS.REVIEW_REQUIRED);
});

test('OCR 신뢰도가 낮으면 임계값 미만 → REVIEW_REQUIRED', () => {
  const res = validateReceipt(base(), { ocrConfidence: 0.3, now: NOW }); // 0.12 + 0.6 = 0.72
  assert.equal(res.valid, true);
  assert.equal(res.status, STATUS.REVIEW_REQUIRED);
});

test('중복: 같은 가맹점·일자·합계는 같은 해시, 중복이면 REVIEW_REQUIRED', () => {
  const a = computeDupHash(base());
  const b = computeDupHash({ ...base(), merchant: ' 가상커피  테스트점 ' });
  const c = computeDupHash({ ...base(), totalAmount: 14001 });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(computeDupHash({ ...base(), date: null }), null);
  const res = validateReceipt(base(), { ocrConfidence: 0.95, now: NOW, duplicate: true });
  assert.equal(res.duplicate, true);
  assert.ok(codes(res).includes('DUPLICATE'));
  assert.equal(res.status, STATUS.REVIEW_REQUIRED);
});

test('categorizer: fixture별 계정과목', () => {
  for (const fx of FIXTURES) {
    assert.equal(categorize(parseReceipt(fx.text)), fx.category, fx.name);
  }
  assert.equal(categorize({}), '기타');
});
