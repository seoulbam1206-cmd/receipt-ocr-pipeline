import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseReceipt, fixDigits, maskCardNumbers, splitDateTime } from '../src/services/parser.js';
import { isValidBizNo } from '../src/services/validator.js';
import { FIXTURES } from './fixtures.js';

describe('parseReceipt fixtures', () => {
  for (const fx of FIXTURES) {
    test(fx.name, () => {
      const r = parseReceipt(fx.text);
      for (const [key, value] of Object.entries(fx.expected)) {
        assert.equal(r[key], value, `${key}: ${JSON.stringify(r[key])} !== ${JSON.stringify(value)}`);
      }
      if (fx.expected.bizNo) assert.ok(isValidBizNo(fx.expected.bizNo), '가상 사업자번호는 체크섬을 통과해야 함');
    });
  }
});

test('fixture는 8개 이상', () => {
  assert.ok(FIXTURES.length >= 8);
});

test('rawText에는 카드번호 끝 4자리 외 숫자가 남지 않음', () => {
  const fx = FIXTURES.find((f) => f.text.includes('9876 5432'));
  const r = parseReceipt(fx.text);
  assert.ok(!r.rawText.includes('9876'));
  assert.ok(!r.rawText.includes('5432 1098'));
  assert.match(r.rawText, /\*{4} \*{4} \*{4} 7654/);
});

test('오인식 카드번호(O 포함)도 rawText에서 마스킹', () => {
  const r = parseReceipt('카드번호 98O6-5432-1098-7654\n합계 1,000');
  assert.equal(r.cardLast4, '7654');
  assert.ok(!/98[O0]6/.test(r.rawText));
});

test('빈 입력·비정상 입력은 예외 없이 null 필드', () => {
  for (const input of ['', '   ', null, undefined, 123, '!!!@@@###']) {
    const r = parseReceipt(input);
    assert.equal(r.merchant, null);
    assert.equal(r.date, null);
    assert.equal(r.totalAmount, null);
    assert.equal(r.cardLast4, null);
  }
});

test('fixDigits는 숫자 컨텍스트에서만 보정', () => {
  assert.equal(fixDigits('합계 1O,OOO원'), '합계 10,000원');
  assert.equal(fixDigits('l2,3OO'), '12,300');
  assert.equal(fixDigits('S5,000'), '55,000');
  assert.equal(fixDigits('SOLO TOTAL'), 'SOLO TOTAL');
  assert.equal(fixDigits('Total 5,000'), 'Total 5,000');
});

test('maskCardNumbers', () => {
  assert.equal(maskCardNumbers('1234-5678-9012-3456'), '****-****-****-3456');
  assert.equal(maskCardNumbers('1234567890123456'), '************3456');
  assert.equal(maskCardNumbers('사업자 999-99-99997'), '사업자 999-99-99997');
  assert.equal(maskCardNumbers('TEL 010-1234-5678'), 'TEL 010-1234-5678');
});

test('splitDateTime: 공백 없이 붙은 날짜·시간 분리', () => {
  assert.equal(splitDateTime('거래일시:2026-10-2712:34:56'), '거래일시:2026-10-27 12:34:56');
  assert.equal(splitDateTime('승차일시 26.10.1523:41'), '승차일시 26.10.15 23:41');
  assert.equal(splitDateTime('2026-10-27 12:34'), '2026-10-27 12:34');
  assert.equal(splitDateTime('TEL 02-000-0000'), 'TEL 02-000-0000');
  const r = parseReceipt('상호: 가상커피\n거래일시:2026-10-2712:34:56\n합계 14,000');
  assert.equal(r.date, '2026-10-27');
  assert.equal(r.time, '12:34:56');
});

test('totalSource: 키워드 줄이면 keyword', () => {
  assert.equal(parseReceipt('합계 14,000').totalSource, 'keyword');
  assert.equal(parseReceipt('합계 14,000.00').totalSource, 'keyword'); // 끝의 .00은 정상
  assert.equal(parseReceipt('가상가게').totalSource, null);
});

test('totalSource: 쉼표가 마침표로 깨진 결제금액은 malformed (tesseract 실제 출력, receipt02)', () => {
  const r = parseReceipt('합계       24,500\n할인       -2,000\n결제금액 = 22.5002)');
  assert.equal(r.totalAmount, 22);
  assert.equal(r.totalSource, 'malformed');
});

test('totalSource: 총액을 종액으로 읽어 키워드가 없으면 fallback (tesseract 실제 출력, receipt05)', () => {
  const r = parseReceipt('생수 50001 2 2,000\n삼각김밥 _ 1 1,500\n종액          3,500\n현금          5,000');
  assert.equal(r.totalAmount, 50001);
  assert.equal(r.totalSource, 'fallback');
});
