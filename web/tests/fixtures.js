// 모든 상호·사업자번호·카드번호는 가상 값이다.
// 사업자번호는 validator.bizNoCheckDigit로 체크섬 자리를 직접 계산해 만들었다.
export const FIXTURES = [
  {
    name: '표준 카드 영수증(공급가/부가세/합계)',
    text: `[영수증]
상호: 가상커피 테스트점
사업자번호: 999-99-99997  대표: 김가상
TEL: 02-123-4567
거래일시: 2026-10-27 12:34:56
-----------------
아메리카노   2   4,500   9,000
카페라떼     1   5,000   5,000
-----------------
공급가액            12,727
부가세               1,273
합계                14,000
카드번호: 1234-56**-****-7890
승인번호: 12345678`,
    expected: {
      merchant: '가상커피 테스트점',
      bizNo: '999-99-99997',
      date: '2026-10-27',
      time: '12:34:56',
      supplyAmount: 12727,
      vat: 1273,
      totalAmount: 14000,
      paymentMethod: '카드',
      cardLast4: '7890',
    },
    category: '식대',
  },
  {
    name: 'O/0 오인식 + 슬래시 날짜 + 할인 후 결제금액 우선',
    text: `*** 신용카드 매출전표 ***
가맹점명 : 한빛문구 (가상)
사업자등록번호 : 555-55-55553
판매일 : 2026/10/2O 09:05
볼펜 3 1,5OO 4,5OO
A4용지 1 2O,OOO 2O,OOO
합 계 24,5OO
할인 -2,000
결제금액 22,5OO원`,
    expected: {
      merchant: '한빛문구 (가상)',
      bizNo: '555-55-55553',
      date: '2026-10-20',
      time: '09:05',
      supplyAmount: null,
      vat: null,
      totalAmount: 22500,
      paymentMethod: '카드',
      cardLast4: null,
    },
    category: '사무용품',
  },
  {
    name: '2자리 연도(26.10.27) + 받을금액 + 키워드 없는 상호 + 현금',
    text: `행복분식
서울시 가상구 테스트로 12
사업자 246-80-13573
26.10.27 18:20
김밥 2 7,000
라면 1 5,000
받을금액 12,000
현금`,
    expected: {
      merchant: '행복분식',
      bizNo: '246-80-13573',
      date: '2026-10-27',
      time: '18:20',
      totalAmount: 12000,
      paymentMethod: '현금',
      cardLast4: null,
    },
    category: '식대',
  },
  {
    name: '한글 날짜(년월일) + 오후 시간 + 총액 + 과세물품가액',
    text: `=== 가상정육식당 ===
사업자번호 777-00-12343
2026년 10월 25일 오후 7:45
한우등심 2인분 96,000
소주 2 10,000
총액 106,000
과세물품가액 96,364
부가세 9,636
체크카드 ****-****-****-4321`,
    expected: {
      merchant: '가상정육식당',
      bizNo: '777-00-12343',
      date: '2026-10-25',
      time: '19:45',
      supplyAmount: 96364,
      vat: 9636,
      totalAmount: 106000,
      paymentMethod: '카드',
      cardLast4: '4321',
    },
    category: '접대비',
  },
  {
    name: '카드 전표(가맹점명이 중간) + 승인금액 + l→1 오인식 + 비마스킹 카드번호',
    text: `카드 매출전표 [고객용]
카드종류 가상카드
카드번호 9876 5432 1098 7654
거래일자 2026.10.26
승인금액 l2,3OO원
가맹점명 가상택시 운수
사업자등록번호 314-15-92650`,
    expected: {
      merchant: '가상택시 운수',
      bizNo: '314-15-92650',
      date: '2026-10-26',
      time: null,
      totalAmount: 12300,
      paymentMethod: '카드',
      cardLast4: '7654',
    },
    category: '교통비',
  },
  {
    name: '합계 키워드 없음 → 가장 큰 금액, 영문 영수증',
    text: `GASANG MART
Biz No: 000-00-00015
Date 2026-10-01 08:10
MILK 1 2,500
BREAD 2 6,000
EGG 1 7,980`,
    expected: {
      merchant: 'GASANG MART',
      bizNo: '000-00-00015',
      date: '2026-10-01',
      time: '08:10',
      totalAmount: 7980,
      paymentMethod: null,
    },
    category: '기타',
  },
  {
    name: '합계(VAT포함) + 다음 줄 금액 + 계좌이체',
    text: `(주)가상텔레콤 대리점
사업자번호 876-54-32106
2026-09-30 14:00:00
휴대폰 요금 수납
공급가액 50,000
부가세 5,000
합계(VAT포함)
55,000
결제방법: 계좌이체`,
    expected: {
      merchant: '(주)가상텔레콤 대리점',
      bizNo: '876-54-32106',
      date: '2026-09-30',
      time: '14:00:00',
      supplyAmount: 50000,
      vat: 5000,
      totalAmount: 55000,
      paymentMethod: '계좌이체',
    },
    category: '통신비',
  },
  {
    name: 'S→5 오인식 + 공백 섞인 날짜 + "결제 금액" 띄어쓰기 + 매장명',
    text: `매장명: 가상오피스 디포
사업자등록번호: 220-00-11116
일자: 2026. 10. 2
복사용지 박스 1 S5,000
토너 1 4S,000
합계 1OO,OOO
결제 금액 1OO,OOO
신용카드 결제`,
    expected: {
      merchant: '가상오피스 디포',
      bizNo: '220-00-11116',
      date: '2026-10-02',
      time: null,
      totalAmount: 100000,
      paymentMethod: '카드',
    },
    category: '사무용품',
  },
  {
    name: '하이픈 2자리 연도 + 전화번호 함정 + 합계금액',
    text: `가상호프 본점
T. 031-999-1234
26-10-15 23:10
생맥주 4 20,000
치킨 1 22,000
합계금액 42,000`,
    expected: {
      merchant: '가상호프 본점',
      bizNo: null,
      date: '2026-10-15',
      time: '23:10',
      totalAmount: 42000,
    },
    category: '접대비',
  },
];
