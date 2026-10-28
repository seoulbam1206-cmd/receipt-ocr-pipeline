// 사용법: npm run benchmark [-- --no-preprocess] [-- --dir <폴더>] [-- --engine tesseract|paddle]
// 저장소 루트 samples/ 의 이미지와 같은 이름의 .json 정답 파일을 비교한다.
//   정답 형식: { "merchant": "가상커피", "date": "2026-10-27", "totalAmount": 14000 }
import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { analyzeReceipt } from '../src/services/pipeline.js';
import { createOcrService, createEngine, missingTessdata } from '../src/services/ocrService.js';

const args = process.argv.slice(2);
const preprocess = !args.includes('--no-preprocess');
const dirIdx = args.indexOf('--dir');
const dir = dirIdx >= 0 ? path.resolve(args[dirIdx + 1]) : config.samplesDir;
const engineIdx = args.indexOf('--engine');
const engineName = engineIdx >= 0 ? args[engineIdx + 1] : config.ocr.engine;
const IMAGE_EXT = new Set(config.upload.allowedExt.map((e) => '.' + e));
const FIELDS = ['merchant', 'date', 'totalAmount'];

const usage = () =>
  console.log(`
샘플이 없습니다. 아래처럼 준비한 뒤 다시 실행하세요.

  ${dir}
    receipt01.jpg
    receipt01.json   {"merchant": "가맹점명", "date": "YYYY-MM-DD", "totalAmount": 12000}

  npm run benchmark                    # 전처리 적용
  npm run benchmark -- --no-preprocess # 전처리 없이 (비교용)
`);

const normText = (s) => (s == null ? null : String(s).replace(/\s+/g, '').toLowerCase());
const same = (field, actual, expected) =>
  field === 'merchant' ? normText(actual) === normText(expected) : String(actual ?? '') === String(expected ?? '');

async function findSamples() {
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  return files
    .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
    .map((f) => ({ image: path.join(dir, f), answer: path.join(dir, path.basename(f, path.extname(f)) + '.json') }))
    .filter((s) => existsSync(s.answer));
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);

async function main() {
  const samples = await findSamples();
  if (!samples.length) {
    usage();
    return;
  }
  const missing = engineName === 'tesseract' ? missingTessdata() : [];
  if (missing.length) console.warn(`[경고] tessdata 누락: ${missing.join(', ')} (README의 다운로드 방법 참고)`);

  // 최대 메모리: 50ms 간격 샘플링 (OCR 도중 피크 포착)
  let peakRss = 0;
  let peakHeap = 0;
  const sample = () => {
    const m = process.memoryUsage();
    peakRss = Math.max(peakRss, m.rss);
    peakHeap = Math.max(peakHeap, m.heapUsed);
  };
  const timer = setInterval(sample, 50);

  const ocr = createOcrService(createEngine(engineName));
  const initStart = performance.now();
  await ocr.init();
  const initMs = performance.now() - initStart;

  const rows = [];
  const correct = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  let totalMs = 0;

  for (const s of samples) {
    const expected = JSON.parse(await readFile(s.answer, 'utf8'));
    const t0 = performance.now();
    let result;
    try {
      result = await analyzeReceipt(s.image, { ocr, preprocess });
    } catch (err) {
      result = { error: err.message };
    }
    const ms = performance.now() - t0;
    totalMs += ms;
    sample();

    const row = { file: path.basename(s.image), ms: Math.round(ms) };
    for (const f of FIELDS) {
      const ok = !result.error && same(f, result[f], expected[f]);
      if (ok) correct[f]++;
      row[f] = ok ? 'O' : `X (${result.error ? 'error' : (result[f] ?? 'null')})`;
    }
    row.conf = result.confidence ?? '-';
    rows.push(row);
  }

  clearInterval(timer);
  await ocr.terminate();

  // paddle 엔진은 OCR이 별도 Python 프로세스에서 돌므로 그쪽 최대 메모리도 함께 본다
  let serviceRss = null;
  if (engineName === 'paddle') {
    const health = await fetch(`${config.ocr.serviceUrl}/health`).then((r) => r.json()).catch(() => null);
    serviceRss = health?.peakRssMb ?? null;
  }

  const n = samples.length;
  console.log(
    `\n엔진: ${engineName} | 전처리: ${preprocess ? 'ON' : 'OFF'} | 샘플 ${n}개 | 엔진 초기화 ${Math.round(initMs)}ms\n`,
  );
  console.table(rows);
  console.table({
    가맹점: { 정확도: `${((correct.merchant / n) * 100).toFixed(1)}%`, 정답수: `${correct.merchant}/${n}` },
    일자: { 정확도: `${((correct.date / n) * 100).toFixed(1)}%`, 정답수: `${correct.date}/${n}` },
    합계: { 정확도: `${((correct.totalAmount / n) * 100).toFixed(1)}%`, 정답수: `${correct.totalAmount}/${n}` },
  });
  console.table({
    '평균 처리시간(ms/건)': { 값: Math.round(totalMs / n) },
    '최대 RSS(MB)': { 값: mb(peakRss) },
    '최대 Heap(MB)': { 값: mb(peakHeap) },
    ...(serviceRss != null ? { 'ocr-service 최대 RSS(MB)': { 값: serviceRss } } : {}),
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
