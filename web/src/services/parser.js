/**
 * OCR 원문 → 정규화된 영수증 객체.
 * 모든 필드는 추출 실패 시 null. 어떤 입력에도 예외를 던지지 않는다.
 */

// 우선순위가 낮을수록(0) 먼저 선택. 실제 결제된 금액 > 합계류
const TOTAL_KEYWORDS = [
  { re: /(결제금액|승인금액|받을금액|청구금액|결제합계|카드결제)/, rank: 0 },
  { re: /(총결제|총합계|총금액|총액|합계금액|합계|TOTAL)/i, rank: 1 },
];
// 합계 키워드가 있어도 합계가 아닌 줄
const TOTAL_EXCLUDE = /(공급가|부가세|부가가치세|세액|과세|면세|할인|거스름|받은금액|잔액|포인트|봉사료|수량)/;
const SUPPLY_KEYWORDS = /(공급가액|공급가|과세물품가액|과세물품|물품가액|과세금액)/;
const VAT_KEYWORDS = /(부가가치세|부가세|세액|VAT)/i;
const DATE_LINE_KEYWORDS = /(일시|일자|날짜|거래일|판매일|승인일|DATE)/i;
const BIZ_LINE_KEYWORDS = /(사업자|등록번호|BIZ)/i;
const MERCHANT_KEYWORD =
  /(?<![가-힣])(?:상\s*호\s*명?|가맹점\s*명?|매장\s*명|업체\s*명)(?!\s*(?:번호|주소|전화|코드|용|No))\s*[:：]?\s*(.*)$/i;
const MERCHANT_STOP = /(\s{2,}|대표자?|사업자|TEL|전화|주소|\bT\s*[:.])/i;
const HEADER_NOISE =
  /(영수증|매출전표|전표|고객용|가맹점용|RECEIPT|감사합니다|어서\s*오세요|환영합니다|WELCOME|사업자|대표|TEL|전화|주소|번호|일시|일자|합계|금액)/i;
// 금액 후보 탐색 시 무시할 줄(번호류)
const NON_AMOUNT_LINE = /(번호|No\.|TEL|전화|사업자|주소|유효기간|일련)/i;

const CONFUSABLE = { O: '0', o: '0', l: '1', I: '1', '|': '1', S: '5' };
const NUM_TOKEN = /(?<![A-Za-z])[0-9OolIS|](?:[0-9OolIS|,.\-/: ]*[0-9OolIS|])?(?![A-Za-z])/g;

/**
 * 공백이 빠져 날짜와 시간이 붙은 경우 분리: 2026-10-2712:34 → 2026-10-27 12:34, 26.10.1523:41 → 26.10.15 23:41
 * (PaddleOCR가 한 박스 안의 공백을 생략하는 경우가 있음. 일자는 2자리로 적혀 있다고 가정)
 */
export function splitDateTime(line) {
  return line.replace(/(?<!\d)(\d{2}|\d{4})([-./])(\d{1,2})\2(\d{2})(?=(?:[01]\d|2[0-3]):[0-5]\d)/g, '$1$2$3$2$4 ');
}

/** 숫자 컨텍스트(실제 숫자를 1개 이상 포함한 토큰)에서만 O→0, l/I→1, S→5 보정 */
export function fixDigits(line) {
  return line.replace(NUM_TOKEN, (tok) => (/\d/.test(tok) ? tok.replace(/[OolIS|]/g, (c) => CONFUSABLE[c]) : tok));
}

// 카드번호 형태: 4-4-4-(2~4) 또는 4-6-5(AMEX), 마스킹 문자(*, X) 포함 가능
const CARD_PATTERNS = [
  /(?<![\w*])(?:[\d*Xx]{4}[- ]?){3}[\d*Xx]{2,4}(?![\w*])/g,
  /(?<![\w*])[\d*Xx]{4}[- ]?[\d*Xx]{6}[- ]?[\d*Xx]{5}(?![\w*])/g,
];

const isCardToken = (tok) => (tok.match(/[\d*Xx]/g) || []).length >= 14 && /\d/.test(tok);

/** 카드번호로 보이는 토큰의 숫자를 끝 4자리만 남기고 * 처리 */
export function maskCardNumbers(text) {
  let out = text;
  for (const re of CARD_PATTERNS) {
    out = out.replace(re, (tok) => {
      if (!isCardToken(tok)) return tok;
      const total = (tok.match(/[\d*Xx]/g) || []).length;
      let idx = 0;
      return tok.replace(/[\d*Xx]/g, (c) => (++idx > total - 4 ? c : '*'));
    });
  }
  return out;
}

function extractCardLast4(lines) {
  for (const line of lines) {
    for (const re of CARD_PATTERNS) {
      for (const m of line.matchAll(re)) {
        if (!isCardToken(m[0])) continue;
        const tail = m[0].replace(/[- ]/g, '').slice(-4);
        if (/^\d{4}$/.test(tail)) return tail;
      }
    }
  }
  return null;
}

const DATE_RE = /(?<!\d)\d{4}\s*[-./]\s*\d{1,2}\s*[-./]\s*\d{1,2}(?!\d)|(?<!\d)\d{2}[-./]\d{1,2}[-./]\d{1,2}(?!\d)|(?<!\d)(?:\d{2}|\d{4})\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일?/g;
const TIME_RE = /(?<![\d:])(오전|오후|AM|PM)?\s*([01]?\d|2[0-3])\s*:\s*([0-5]\d)(?:\s*:\s*([0-5]\d))?(?![\d:])/i;
const BIZ_RE = /(?<!\d)(\d{3})\s*-\s*(\d{2})\s*-\s*(\d{5})(?!\d)/;
const PHONE_RE = /(?<!\d)0\d{1,2}\s*[-)]\s*\d{3,4}\s*-\s*\d{4}(?!\d)/g;
const AMOUNT_RE = /(?<![\d.,])(-)?(\d{1,3}(?:\s?,\s?\d{3})+|\d{1,9})(?:\s*원)?(?![\d,])/g;

function toIsoDate(y, m, d) {
  let year = Number(y);
  if (String(y).length === 2) year += 2000;
  const month = Number(m);
  const day = Number(d);
  if (year < 1990 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCMonth() !== month - 1) return null; // 2/30 같은 존재하지 않는 날짜
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDateToken(tok) {
  const parts = tok.match(/\d+/g);
  if (!parts || parts.length !== 3) return null;
  return toIsoDate(...parts);
}

function extractDate(lines) {
  const ordered = [...lines.filter((l) => DATE_LINE_KEYWORDS.test(l)), ...lines];
  for (const line of ordered) {
    for (const m of line.matchAll(DATE_RE)) {
      const iso = parseDateToken(m[0]);
      if (iso) return iso;
    }
    // 날짜 키워드 줄의 8자리 연속 숫자(20261027)
    if (DATE_LINE_KEYWORDS.test(line)) {
      const m = line.match(/(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/);
      const iso = m && toIsoDate(m[1], m[2], m[3]);
      if (iso) return iso;
    }
  }
  return null;
}

function extractTime(lines) {
  const ordered = [...lines.filter((l) => DATE_LINE_KEYWORDS.test(l)), ...lines];
  for (const line of ordered) {
    const m = line.replace(DATE_RE, ' ').match(TIME_RE);
    if (!m) continue;
    let h = Number(m[2]);
    const ampm = (m[1] || '').toUpperCase();
    if ((ampm === '오후' || ampm === 'PM') && h < 12) h += 12;
    if ((ampm === '오전' || ampm === 'AM') && h === 12) h = 0;
    const hh = String(h).padStart(2, '0');
    return m[4] ? `${hh}:${m[3]}:${m[4]}` : `${hh}:${m[3]}`;
  }
  return null;
}

function extractBizNo(lines) {
  const ordered = [...lines.filter((l) => BIZ_LINE_KEYWORDS.test(l)), ...lines];
  for (const line of ordered) {
    const m = line.match(BIZ_RE);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    if (BIZ_LINE_KEYWORDS.test(line)) {
      const d = line.match(/(?<!\d)(\d{3})(\d{2})(\d{5})(?!\d)/);
      if (d) return `${d[1]}-${d[2]}-${d[3]}`;
    }
  }
  return null;
}

/** 줄에서 날짜/시간/번호류를 지운 뒤 양의 정수 금액 목록 */
export function amountsInLine(line) {
  let s = line.replace(DATE_RE, ' ').replace(PHONE_RE, ' ').replace(BIZ_RE, ' ');
  for (const re of CARD_PATTERNS) s = s.replace(re, ' ');
  s = s.replace(new RegExp(TIME_RE.source, 'gi'), ' ');
  const out = [];
  for (const m of s.matchAll(AMOUNT_RE)) {
    if (m[1]) continue; // 음수(할인 등)
    const n = parseInt(m[2].replace(/[\s,]/g, ''), 10);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

/** 키워드 줄의 금액(없으면 다음 줄). 같은 줄 여러 개면 가장 큰 값 */
function amountAt(lines, i) {
  const own = amountsInLine(lines[i]);
  if (own.length) return Math.max(...own);
  const next = lines[i + 1];
  if (next && /^[\s\d,원₩\\]+$/.test(next)) {
    const a = amountsInLine(next);
    if (a.length) return Math.max(...a);
  }
  return null;
}

function extractTotal(lines) {
  const candidates = [];
  lines.forEach((line, i) => {
    const compact = line.replace(/\(?\s*(부가세|VAT)\s*포함\s*\)?/gi, '').replace(/\s+/g, '');
    if (TOTAL_EXCLUDE.test(compact)) return;
    const kw = TOTAL_KEYWORDS.find((k) => k.re.test(compact));
    if (!kw) return;
    const amount = amountAt(lines, i);
    if (amount !== null) candidates.push({ amount, rank: kw.rank });
  });
  if (candidates.length) {
    const best = Math.min(...candidates.map((c) => c.rank));
    return Math.max(...candidates.filter((c) => c.rank === best).map((c) => c.amount));
  }
  // 키워드가 없으면 번호류 줄을 제외한 가장 큰 금액
  const all = lines.filter((l) => !NON_AMOUNT_LINE.test(l)).flatMap(amountsInLine);
  return all.length ? Math.max(...all) : null;
}

function extractByKeyword(lines, keywordRe, excludeRe) {
  for (let i = 0; i < lines.length; i++) {
    const compact = lines[i].replace(/\s+/g, '');
    if (!keywordRe.test(compact) || (excludeRe && excludeRe.test(compact))) continue;
    const a = amountAt(lines, i);
    if (a !== null) return a;
  }
  return null;
}

const cleanName = (s) =>
  s
    .replace(MERCHANT_STOP, '\u0000')
    .split('\u0000')[0]
    .replace(/^[\s*=\-_~#|:：[\]<>]+|[\s*=\-_~#|:：[\]<>]+$/g, '')
    .trim();

function extractMerchant(lines) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(MERCHANT_KEYWORD);
    if (!m) continue;
    const name = cleanName(m[1] || '') || (lines[i + 1] && cleanName(lines[i + 1]));
    if (name && name.length >= 2) return name;
  }
  for (const line of lines.slice(0, 5)) {
    if (HEADER_NOISE.test(line)) continue;
    const name = cleanName(line);
    const letters = (name.match(/[A-Za-z가-힣]/g) || []).length;
    if (name.length >= 2 && letters >= 2 && letters / name.length >= 0.4) return name;
  }
  return null;
}

function extractPaymentMethod(lines, cardLast4) {
  const text = lines.join('\n');
  const explicit = text.match(/결제\s*(?:수단|방법|방식)\s*[:：]?\s*(\S+)/);
  if (explicit) {
    if (/카드/.test(explicit[1])) return '카드';
    if (/현금/.test(explicit[1])) return '현금';
    if (/이체/.test(explicit[1])) return '계좌이체';
  }
  if (cardLast4 || /(신용|체크)\s*카드|카드\s*결제|카드\s*번호|승인\s*번호|CARD/i.test(text)) return '카드';
  if (/현금/.test(text)) return '현금';
  if (/계좌\s*이체/.test(text)) return '계좌이체';
  return null;
}

const EMPTY = Object.freeze({
  merchant: null,
  bizNo: null,
  date: null,
  time: null,
  supplyAmount: null,
  vat: null,
  totalAmount: null,
  paymentMethod: null,
  cardLast4: null,
  rawText: '',
});

/**
 * @param {string} text OCR 원문
 */
export function parseReceipt(text) {
  if (typeof text !== 'string' || !text.trim()) return { ...EMPTY, rawText: typeof text === 'string' ? text : '' };
  const result = { ...EMPTY };
  const safe = (fn) => {
    try {
      return fn() ?? null;
    } catch {
      return null;
    }
  };

  const rawLines = text.replace(/\r/g, '').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
  const numLines = rawLines.map((l) => splitDateTime(fixDigits(l)));

  result.cardLast4 = safe(() => extractCardLast4(numLines));
  // 이후 모든 처리는 카드번호가 마스킹된 텍스트로 진행
  const lines = numLines.map(maskCardNumbers);

  result.merchant = safe(() => extractMerchant(rawLines.map(maskCardNumbers)));
  result.bizNo = safe(() => extractBizNo(lines));
  result.date = safe(() => extractDate(lines));
  result.time = safe(() => extractTime(lines));
  result.totalAmount = safe(() => extractTotal(lines));
  result.supplyAmount = safe(() => extractByKeyword(lines, SUPPLY_KEYWORDS, /면세/));
  result.vat = safe(() => extractByKeyword(lines, VAT_KEYWORDS, /(공급가|포함|과세물품)/));
  result.paymentMethod = safe(() => extractPaymentMethod(lines, result.cardLast4));
  result.rawText = safe(() => maskCardNumbers(fixCardContext(text))) ?? '';
  return result;
}

/** 원문 저장용: 카드번호 토큰 안의 오인식 문자만 보정해 마스킹이 누락되지 않게 한다 */
function fixCardContext(text) {
  return text.replace(/[\dOolIS|*Xx]{4}(?:[- ]?[\dOolIS|*Xx]{2,6}){2,3}/g, (tok) => {
    const fixed = fixDigits(tok);
    return CARD_PATTERNS.some((re) => new RegExp(re.source).test(fixed)) ? fixed : tok;
  });
}
