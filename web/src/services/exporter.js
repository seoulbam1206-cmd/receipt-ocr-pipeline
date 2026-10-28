const BOM = '﻿';
const STATUS_LABEL = { CONFIRMED: '확정', REVIEW_REQUIRED: '검토필요' };
const COLUMNS = [
  ['일자', (r) => r.date],
  ['가맹점', (r) => r.merchant],
  ['계정과목', (r) => r.category],
  ['공급가액', (r) => r.supplyAmount],
  ['부가세', (r) => r.vat],
  ['합계', (r) => r.totalAmount],
  ['상태', (r) => STATUS_LABEL[r.status] ?? r.status],
];

function cell(v) {
  if (v == null) return '';
  let s = String(v);
  // 엑셀 수식 주입 방지 (OCR 텍스트가 =, +, -, @ 로 시작하는 경우)
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 지출결의서용 CSV (UTF-8 BOM, CRLF) */
export function toExpenseCsv(receipts) {
  const lines = [COLUMNS.map(([h]) => h).join(',')];
  for (const r of receipts) lines.push(COLUMNS.map(([, get]) => cell(get(r))).join(','));
  return BOM + lines.join('\r\n') + '\r\n';
}
