// 사용법 (web 폴더에서): node scripts/export-demo.js [--engine paddle|tesseract]
// 정적 데모(GitHub Pages, docs/)용 결과 만들기. 로컬에서만 실행한다.
//   web/public/samples/ 의 가상 영수증 5장을 실제 파이프라인(전처리 → OCR → 파싱 → 검증 → 분류)으로 처리해
//   docs/data/results.json 에 저장하고, 이미지를 docs/samples/ 로 복사한다. DB는 쓰지 않는다.
//   paddle(기본)은 ocr-service가 실행 중이어야 한다 (README 5-2).
import 'dotenv/config';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.js';
import { analyzeReceipt } from '../src/services/pipeline.js';
import { createOcrService, createEngine } from '../src/services/ocrService.js';

const args = process.argv.slice(2);
const engineIdx = args.indexOf('--engine');
const engineName = engineIdx >= 0 ? args[engineIdx + 1] : 'paddle';
const DOCS = path.join(config.rootDir, '..', 'docs');

// 화면의 "샘플로 바로 테스트"와 같은 5장 (web/public/app.js 의 SAMPLES)
const SAMPLES = [
  { file: 'receipt01_cafe.png', name: '카페', note: '공급가액·부가세' },
  { file: 'receipt02_stationery.jpg', name: '문구점', note: '할인 · 1.5° 회전' },
  { file: 'receipt03_taxi.jpg', name: '택시', note: '2자리 연도 · 블러' },
  { file: 'receipt04_restaurant.jpg', name: '식당', note: '회전 · 블러 · 저대비' },
  { file: 'receipt05_convenience.jpg', name: '편의점', note: '현금 · 거스름돈' },
];

// 화면에 필요한 값만 남긴다 (dupHash 같은 내부 값 제외)
const pick = (r) => ({
  status: r.status,
  merchant: r.merchant,
  bizNo: r.bizNo,
  date: r.date,
  time: r.time,
  totalAmount: r.totalAmount,
  supplyAmount: r.supplyAmount,
  vat: r.vat,
  paymentMethod: r.paymentMethod,
  cardLast4: r.cardLast4,
  category: r.category,
  confidence: r.confidence,
  ocrConfidence: r.ocrConfidence,
  duplicate: r.duplicate,
  issues: r.issues,
  valid: r.valid,
  rawText: r.rawText, // 카드번호는 파서에서 이미 마스킹됨
});

async function main() {
  if (engineName === 'paddle') {
    const health = await fetch(`${config.ocr.serviceUrl}/health`).then((r) => r.json()).catch(() => null);
    if (!health?.ok) {
      throw new Error(`ocr-service(${config.ocr.serviceUrl})가 응답하지 않습니다. README 5-2대로 먼저 실행하세요`);
    }
  }

  const ocr = createOcrService(createEngine(engineName));
  await ocr.init();
  await mkdir(path.join(DOCS, 'data'), { recursive: true });
  await mkdir(path.join(DOCS, 'samples'), { recursive: true });

  const results = [];
  try {
    for (const [i, s] of SAMPLES.entries()) {
      const src = path.join(config.publicSamplesDir, s.file);
      const t0 = performance.now();
      const r = await analyzeReceipt(src, { ocr });
      const ms = Math.round(performance.now() - t0);
      await copyFile(src, path.join(DOCS, 'samples', s.file));
      results.push({ id: i + 1, ...s, ms, ...pick(r) });
      console.log(`${s.file}  ${r.status}  ${r.merchant} / ${r.date} / ${r.totalAmount}  (${ms}ms)`);
    }
  } finally {
    await ocr.terminate();
  }

  const out = { engine: engineName, preprocess: true, generatedAt: new Date().toISOString(), results };
  const file = path.join(DOCS, 'data', 'results.json');
  await writeFile(file, JSON.stringify(out, null, 2) + '\n');
  console.log(`\n저장: ${path.relative(path.join(config.rootDir, '..'), file)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
