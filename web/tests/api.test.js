import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { createRepository } from '../src/db/repository.js';
import { createOcrService } from '../src/services/ocrService.js';
import { FIXTURES } from './fixtures.js';

const NOW = new Date(2026, 9, 27, 15, 0, 0);
let server, base, repo, uploadDir, png;
let nextText = FIXTURES[0].text;
let nextConfidence = 0.9;

const fakeEngine = {
  async init() {},
  async recognize() {
    return { text: nextText, confidence: nextConfidence };
  },
  async terminate() {},
};

before(async () => {
  uploadDir = await mkdtemp(path.join(os.tmpdir(), 'receipt-ocr-test-'));
  repo = createRepository(':memory:');
  const app = createApp({ repo, ocr: createOcrService(fakeEngine), uploadDir, now: () => NOW });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api/receipts`;
  png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } }).png().toBuffer();
});

after(async () => {
  server.close();
  repo.close();
  await rm(uploadDir, { recursive: true, force: true });
});

const uploadForm = (buf, name = 'receipt.png', type = 'image/png') => {
  const fd = new FormData();
  fd.append('image', new Blob([buf], { type }), name);
  return fd;
};
const post = (fd) => fetch(base, { method: 'POST', body: fd });
const patch = (id, body) =>
  fetch(`${base}/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('POST: 업로드 → 파싱·검증·저장 결과 반환, 업로드 파일 즉시 삭제', async () => {
  const res = await post(uploadForm(png));
  assert.equal(res.status, 201);
  const { data } = await res.json();
  assert.equal(data.merchant, '가상커피 테스트점');
  assert.equal(data.totalAmount, 14000);
  assert.equal(data.category, '식대');
  assert.equal(data.status, 'CONFIRMED');
  assert.equal(data.cardLast4, '7890');
  assert.equal(data.duplicate, false);
  assert.ok(!('dupHash' in data));
  assert.ok(!data.rawText.includes('1234-56'));
  assert.deepEqual(await readdir(uploadDir), []);
});

test('POST: 같은 영수증 재업로드 시 duplicate=true, REVIEW_REQUIRED', async () => {
  const { data } = await (await post(uploadForm(png))).json();
  assert.equal(data.duplicate, true);
  assert.equal(data.status, 'REVIEW_REQUIRED');
  assert.ok(data.issues.some((i) => i.code === 'DUPLICATE'));
});

test('POST: 확장자·크기·누락·손상 이미지 검증 (일관된 에러 JSON)', async () => {
  let res = await post(uploadForm(png, 'receipt.gif', 'image/gif'));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'INVALID_FILE_TYPE');

  res = await post(uploadForm(Buffer.alloc(5 * 1024 * 1024 + 1), 'big.png'));
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error.code, 'FILE_TOO_LARGE');

  res = await fetch(base, { method: 'POST', body: new FormData() });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'FILE_REQUIRED');

  res = await post(uploadForm(Buffer.from('not an image'), 'fake.jpg', 'image/jpeg'));
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error.code, 'INVALID_IMAGE');

  assert.deepEqual(await readdir(uploadDir), []);
});

test('GET 목록 필터 / 상세 / 404', async () => {
  nextText = FIXTURES[4].text; // 택시, 2026-10-26
  nextConfidence = 0.2; // 낮은 신뢰도 → 검토 필요
  const created = (await (await post(uploadForm(png))).json()).data;
  assert.equal(created.status, 'REVIEW_REQUIRED');

  const review = (await (await fetch(`${base}?status=REVIEW_REQUIRED`)).json()).data;
  assert.ok(review.length >= 2 && review.every((r) => r.status === 'REVIEW_REQUIRED'));
  const taxi = (await (await fetch(`${base}?category=교통비&from=2026-10-26&to=2026-10-26`)).json()).data;
  assert.deepEqual(taxi.map((r) => r.id), [created.id]);

  const detail = await (await fetch(`${base}/${created.id}`)).json();
  assert.equal(detail.data.merchant, '가상택시 운수');

  const nf = await fetch(`${base}/99999`);
  assert.equal(nf.status, 404);
  assert.equal((await nf.json()).error.code, 'NOT_FOUND');

  const bad = await fetch(`${base}?from=2026/10/01`);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'VALIDATION_ERROR');
});

test('PATCH: 수정 후 재검증, confirm으로 확정', async () => {
  nextText = '알수없는 텍스트';
  nextConfidence = 0.9;
  const created = (await (await post(uploadForm(png))).json()).data;
  assert.equal(created.status, 'REVIEW_REQUIRED');
  assert.ok(created.issues.some((i) => i.code === 'MISSING_FIELDS'));

  // 합계 불일치 상태로 저장 → 이슈 남음
  let res = await patch(created.id, { merchant: '가상문구', date: '2026-10-27', supplyAmount: 1000, vat: 100, totalAmount: 1200, category: '사무용품' });
  let { data } = await res.json();
  assert.equal(res.status, 200);
  assert.ok(data.issues.some((i) => i.code === 'AMOUNT_MISMATCH'));

  res = await patch(created.id, { totalAmount: 1100, confirm: true });
  ({ data } = await res.json());
  assert.equal(data.status, 'CONFIRMED');
  assert.deepEqual(data.issues, []);
  assert.equal(data.category, '사무용품');

  res = await patch(created.id, { totalAmount: 'abc' });
  assert.equal(res.status, 400);
  res = await patch(created.id, { unknownField: 1 });
  assert.equal(res.status, 400);
});

test('GET export.csv: UTF-8 BOM, 컬럼, 기간 필터', async () => {
  const res = await fetch(`${base}/export.csv?from=2026-10-27&to=2026-10-27`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const lines = buf.toString('utf8').slice(1).trim().split('\r\n');
  assert.equal(lines[0], '일자,가맹점,계정과목,공급가액,부가세,합계,상태');
  assert.ok(lines.slice(1).every((l) => l.startsWith('2026-10-27,')));
  assert.ok(lines.includes('2026-10-27,가상커피 테스트점,식대,12727,1273,14000,확정'));
  assert.ok(lines.includes('2026-10-27,가상문구,사무용품,1000,100,1100,확정'));
});
