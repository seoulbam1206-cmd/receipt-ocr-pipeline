/**
 * 룰 기반 계정과목 분류. 키워드를 추가/수정하려면 아래 사전만 고치면 된다.
 * 배열 순서 = 동점일 때의 우선순위.
 */
export const CATEGORY_KEYWORDS = {
  접대비: ['호프', '주점', '포차', '이자카야', '와인', '한우', '정육식당', '횟집', '일식', '오마카세', '룸', '골프', '꽃집', '화환', '선물'],
  교통비: ['택시', '운수', '버스', '지하철', '철도', 'KTX', 'SRT', '코레일', '고속', '주유', '주차', '하이패스', '톨게이트', '항공', '렌터카'],
  사무용품: ['문구', '오피스', '복사용지', 'A4', '토너', '잉크', '프린터', '사무용품', '다이소', '볼펜', '파일철', '전산'],
  통신비: ['텔레콤', '통신', 'SKT', 'KT', 'LG U+', '유플러스', '인터넷', '휴대폰', '요금 수납', '우편', '택배'],
  식대: ['식당', '분식', '김밥', '국밥', '커피', '카페', '아메리카노', '라떼', '베이커리', '도시락', '편의점', '치킨', '피자', '버거', '한식', '중식', '라면'],
};
export const DEFAULT_CATEGORY = '기타';
export const CATEGORIES = [...Object.keys(CATEGORY_KEYWORDS), DEFAULT_CATEGORY];

// 가맹점명에 있는 키워드는 본문 키워드보다 가중치를 높게
const MERCHANT_WEIGHT = 3;

const norm = (s) => (s || '').toUpperCase();

/**
 * @param {{ merchant?: string|null, rawText?: string }} receipt
 * @returns {string} 계정과목
 */
export function categorize({ merchant, rawText } = {}) {
  const m = norm(merchant);
  const body = norm(rawText);
  let best = DEFAULT_CATEGORY;
  let bestScore = 0;
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      const k = kw.toUpperCase();
      if (m.includes(k)) score += MERCHANT_WEIGHT;
      else if (body.includes(k)) score += 1;
    }
    if (score > bestScore) {
      best = category;
      bestScore = score;
    }
  }
  return best;
}
