import { createHash } from 'node:crypto';
import { config } from '../config.js';

const BIZ_WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5];
// confidence = OCR 신뢰도 * w + 검증 통과율 * (1 - w)
export const OCR_WEIGHT = 0.4;
export const STATUS = Object.freeze({ CONFIRMED: 'CONFIRMED', REVIEW_REQUIRED: 'REVIEW_REQUIRED' });
// parser의 totalSource 중 검토가 필요한 값 (reconciled는 합계·할인 두 줄과 일치하므로 제외)
const TOTAL_UNCERTAIN_MESSAGES = {
  malformed: '합계 줄의 금액 형식이 깨져 있음(OCR 오인식 가능)',
  fallback: '합계 키워드를 찾지 못해 가장 큰 금액으로 추정함',
};

/** 사업자등록번호 체크섬 (가중치 1,3,7,1,3,7,1,3,5) */
export function isValidBizNo(bizNo) {
  if (typeof bizNo !== 'string') return false;
  const d = bizNo.replace(/-/g, '');
  if (!/^\d{10}$/.test(d)) return false;
  const digits = [...d].map(Number);
  let sum = BIZ_WEIGHTS.reduce((acc, w, i) => acc + digits[i] * w, 0);
  sum += Math.floor((digits[8] * 5) / 10);
  return (10 - (sum % 10)) % 10 === digits[9];
}

/** 앞 9자리로 체크섬 자리를 계산 (테스트용 가상 번호 생성) */
export function bizNoCheckDigit(first9) {
  const digits = [...first9.replace(/-/g, '')].map(Number);
  const sum = BIZ_WEIGHTS.reduce((acc, w, i) => acc + digits[i] * w, 0) + Math.floor((digits[8] * 5) / 10);
  return (10 - (sum % 10)) % 10;
}

const localIso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** (가맹점 + 일자 + 합계) 중복 감지 해시. 필드가 하나라도 없으면 null */
export function computeDupHash({ merchant, date, totalAmount }) {
  if (!merchant || !date || totalAmount == null) return null;
  const key = [merchant.replace(/\s+/g, '').toLowerCase(), date, String(totalAmount)].join('|');
  return createHash('sha256').update(key).digest('hex');
}

/**
 * @param {object} r parseReceipt 결과(또는 수정된 값)
 * @param {{ ocrConfidence?: number, now?: Date, threshold?: number, duplicate?: boolean }} [opts]
 * @returns {{ valid: boolean, issues: {code: string, message: string}[], confidence: number, status: string, duplicate: boolean }}
 */
export function validateReceipt(r, opts = {}) {
  const { ocrConfidence = 1, now = new Date(), threshold = config.ocr.confidenceThreshold, duplicate = false } = opts;
  const issues = [];
  let evaluated = 0;
  let passed = 0;
  const check = (ok, code, message) => {
    evaluated++;
    if (ok) passed++;
    else issues.push({ code, message });
  };

  // (d) 필수 필드
  const missing = ['merchant', 'date', 'totalAmount'].filter((k) => r[k] == null || r[k] === '');
  check(missing.length === 0, 'MISSING_FIELDS', `필수 필드 누락: ${missing.join(', ')}`);

  // (a) 공급가액 + 부가세 = 합계 (±1원). 값이 없으면 검증 대상에서 제외
  if (r.supplyAmount != null && r.vat != null && r.totalAmount != null) {
    const diff = r.supplyAmount + r.vat - r.totalAmount;
    check(Math.abs(diff) <= 1, 'AMOUNT_MISMATCH', `공급가액+부가세(${r.supplyAmount + r.vat}) ≠ 합계(${r.totalAmount})`);
  }

  // (b) 사업자번호 체크섬
  if (r.bizNo) check(isValidBizNo(r.bizNo), 'INVALID_BIZ_NO', `사업자등록번호 체크섬 오류: ${r.bizNo}`);

  // (c) 날짜: 미래 아님, 5년 이내
  if (r.date) {
    const today = localIso(now);
    const limit = new Date(now);
    limit.setFullYear(limit.getFullYear() - 5);
    const oldest = localIso(limit);
    if (r.date > today) check(false, 'FUTURE_DATE', `미래 날짜: ${r.date}`);
    else check(r.date >= oldest, 'DATE_TOO_OLD', `5년 초과 날짜: ${r.date}`);
  }

  if (duplicate) issues.push({ code: 'DUPLICATE', message: '동일 가맹점·일자·합계의 영수증이 이미 등록됨' });

  // (e) 합계 근거. 공급가액/부가세가 없으면 (a)를 건너뛰므로, 근거가 약한 합계는 그대로 확정되지 않게 한다.
  // totalSource는 파서 결과에만 있다(사람이 수정한 값은 DB에서 읽어 와 없음)
  const totalUncertain = r.totalAmount != null && TOTAL_UNCERTAIN_MESSAGES[r.totalSource];
  if (totalUncertain) issues.push({ code: 'TOTAL_UNCERTAIN', message: totalUncertain });

  const passRate = evaluated ? passed / evaluated : 0;
  const ocr = Math.max(0, Math.min(1, Number(ocrConfidence) || 0));
  const confidence = Math.round((ocr * OCR_WEIGHT + passRate * (1 - OCR_WEIGHT)) * 1000) / 1000;
  // 임계값 미만은 검토 필요. 필수 필드 누락·중복·불확실한 합계는 신뢰도와 무관하게 검토 필요
  const status =
    confidence < threshold || missing.length > 0 || duplicate || totalUncertain
      ? STATUS.REVIEW_REQUIRED
      : STATUS.CONFIRMED;

  return { valid: issues.length === 0, issues, confidence, status, duplicate };
}
