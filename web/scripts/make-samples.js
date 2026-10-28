// 사용법: npm run make-samples
// 저장소 루트 samples/ 에 가상 영수증 이미지와 정답 JSON을 만든다.
// 모든 상호·전화번호·카드번호는 가짜이고, 사업자번호는 체크섬만 맞춘 가상 번호(999-xx-…)다.
// 글꼴은 Windows 기본 'Malgun Gothic'을 쓴다(없으면 시스템 기본 글꼴로 대체되어 결과가 달라질 수 있음).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../src/config.js';
import { bizNoCheckDigit } from '../src/services/validator.js';

const fakeBizNo = (first9) => {
  const d = first9 + bizNoCheckDigit(first9);
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
};

// degrade: 사진으로 찍은 영수증처럼 보이게 하는 열화(회전 각도, 블러, 대비 저하, JPEG 품질)
const SAMPLES = [
  {
    name: 'receipt01_cafe',
    lines: [
      '[영수증]',
      '상호: 가상커피 테스트점',
      `사업자번호: ${fakeBizNo('999999999')}`,
      'TEL: 02-000-0000',
      '거래일시: 2026-10-27 12:34:56',
      '--------------------------',
      '아메리카노  2   9,000',
      '카페라떼    1   5,000',
      '--------------------------',
      '공급가액        12,727',
      '부가세           1,273',
      '합계            14,000',
      '카드번호: 1234-56**-****-7890',
    ],
    answer: { merchant: '가상커피 테스트점', date: '2026-10-27', totalAmount: 14000 },
  },
  {
    name: 'receipt02_stationery',
    lines: [
      '*** 신용카드 매출전표 ***',
      '가맹점명 : 한빛문구 가상점',
      `사업자등록번호 : ${fakeBizNo('999110000')}`,
      '판매일 : 2026/10/20 09:05',
      '볼펜       3   4,500',
      'A4용지     1  20,000',
      '합 계         24,500',
      '할인          -2,000',
      '결제금액      22,500원',
    ],
    answer: { merchant: '한빛문구 가상점', date: '2026-10-20', totalAmount: 22500 },
    degrade: { rotate: 1.5, jpeg: 70 },
  },
  {
    name: 'receipt03_taxi',
    lines: [
      '가상운수 개인택시',
      `사업자번호 ${fakeBizNo('999220000')}`,
      '승차일시 26.10.15 23:41',
      '승차거리 12.4km',
      '요금           18,300',
      '받을금액       18,300',
      '카드 승인번호 00000000',
    ],
    answer: { merchant: '가상운수 개인택시', date: '2026-10-15', totalAmount: 18300 },
    degrade: { blur: 0.8, jpeg: 60 },
  },
  {
    name: 'receipt04_restaurant',
    lines: [
      '[고객용] 카드영수증',
      '상호명: 가상국밥 본점',
      `사업자번호: ${fakeBizNo('999330000')}`,
      '주소: 가상시 테스트구 예시로 1',
      '일시: 2026-09-30 19:12',
      '순대국밥   4   40,000',
      '수육(소)   1   25,000',
      '과세물품가액      59,091',
      '부가세             5,909',
      '합계금액          65,000',
    ],
    answer: { merchant: '가상국밥 본점', date: '2026-09-30', totalAmount: 65000 },
    degrade: { rotate: -2.5, blur: 1.0, contrast: 0.6, jpeg: 55 },
  },
  {
    name: 'receipt05_convenience',
    lines: [
      '가상편의점 샘플역점',
      `사업자 ${fakeBizNo('999440000')}`,
      '2026년 10월 01일 08:15',
      '생수 500ml   2   2,000',
      '삼각김밥     1   1,500',
      '총액               3,500',
      '현금               5,000',
      '거스름돈           1,500',
    ],
    answer: { merchant: '가상편의점 샘플역점', date: '2026-10-01', totalAmount: 3500 },
    degrade: { contrast: 0.5, jpeg: 50 },
  },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function render({ lines, degrade = {} }) {
  const W = 640;
  const LH = 44;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${LH * lines.length + 60}">
<rect width="100%" height="100%" fill="white"/>
${lines
  .map(
    (l, i) =>
      `<text x="30" y="${50 + i * LH}" font-family="Malgun Gothic" font-size="28" fill="black" xml:space="preserve">${esc(l)}</text>`,
  )
  .join('\n')}
</svg>`;
  let img = sharp(Buffer.from(svg)).flatten({ background: '#ffffff' });
  if (degrade.rotate) img = sharp(await img.png().toBuffer()).rotate(degrade.rotate, { background: '#ffffff' });
  if (degrade.blur) img = img.blur(degrade.blur);
  // 대비 저하: 검은 글자를 회색으로, 흰 배경은 유지
  if (degrade.contrast) img = img.linear(degrade.contrast, 255 * (1 - degrade.contrast));
  return degrade.jpeg ? img.jpeg({ quality: degrade.jpeg }).toBuffer() : img.png().toBuffer();
}

await mkdir(config.samplesDir, { recursive: true });
for (const s of SAMPLES) {
  const ext = s.degrade?.jpeg ? '.jpg' : '.png';
  await writeFile(path.join(config.samplesDir, s.name + ext), await render(s));
  await writeFile(path.join(config.samplesDir, s.name + '.json'), JSON.stringify(s.answer, null, 2) + '\n');
  console.log(`samples/${s.name}${ext}`);
}
