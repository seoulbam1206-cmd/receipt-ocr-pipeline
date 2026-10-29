import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { createMemoryRepository } from '../src/db/memoryRepository.js';
import { createOcrService } from '../src/services/ocrService.js';
import { FIXTURES } from './fixtures.js';

const NOW = new Date(2026, 9, 27, 15, 0, 0);
const SAMPLE = 'receipt01_cafe.png'; // web/public/samples 의 실제 파일
let seq = 0;
// 매번 다른 합계를 돌려줘 중복 판정과 무관하게 행이 쌓이게 한다
const fakeEngine = {
  async init() {},
  async recognize() {
    return { text: FIXTURES[0].text.replace('14,000', `${14_000 + ++seq}`), confidence: 0.9 };
  },
  async terminate() {},
};

const servers = [];
const dirs = [];
after(async () => {
  for (const s of servers) s.close();
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

/** demo 설정으로 앱을 띄우고 { base, repo, uploadDir } 반환 */
async function start(demo) {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'receipt-ocr-demo-'));
  dirs.push(uploadDir);
  const repo = createMemoryRepository();
  const server = createApp({ repo, ocr: createOcrService(fakeEngine), uploadDir, now: () => NOW, demo }).listen(0);
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  return { base: `http://127.0.0.1:${server.address().port}/api`, repo, uploadDir };
}

const DEMO = { enabled: true, upload: false, keepLatest: 3, maxRows: 200 };
const postSample = (base, name = SAMPLE) => fetch(`${base}/receipts/samples/${encodeURIComponent(name)}`, { method: 'POST' });
const postUpload = (base) => {
  const fd = new FormData();
  fd.append('image', new Blob([Buffer.from('x')], { type: 'image/png' }), 'receipt.png');
  return fetch(`${base}/receipts`, { method: 'POST', body: fd });
};

test('GET /api/config: 화면에 데모 설정 전달', async () => {
  const { base } = await start(DEMO);
  assert.deepEqual((await (await fetch(`${base}/config`)).json()).data, { demoMode: true, uploadEnabled: false });
});

test('DEMO_UPLOAD=false: 파일 업로드는 403, 업로드 파일도 남지 않음', async () => {
  const { base, uploadDir } = await start(DEMO);
  const res = await postUpload(base);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, 'UPLOAD_DISABLED');
  assert.deepEqual(await readdir(uploadDir), []);
});

test('샘플 처리: 목록에 있는 파일만, 경로 조작은 404', async () => {
  const { base } = await start(DEMO);
  assert.equal((await postSample(base)).status, 201);
  for (const name of ['nope.png', '../app.js', '..\\..\\package.json']) {
    const res = await postSample(base, name);
    assert.equal(res.status, 404, name);
  }
});

test('DEMO_MODE: OCR 원문은 응답에만 있고 저장하지 않음', async () => {
  const { base } = await start(DEMO);
  const { data } = await (await postSample(base)).json();
  assert.ok(data.rawText.length > 0);
  const stored = (await (await fetch(`${base}/receipts/${data.id}`)).json()).data;
  assert.equal(stored.rawText, null);
});

test('DEMO_MODE: 최근 keepLatest건만 남기고 오래된 행은 삭제', async () => {
  const { base, repo } = await start(DEMO);
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await (await postSample(base)).json()).data.id);
  const kept = (await repo.list()).map((r) => r.id).sort((a, b) => a - b);
  assert.deepEqual(kept, ids.slice(-3));
});

test('DEMO_MODE: 저장 행이 maxRows건이면 새 저장 거부', async () => {
  const { base, repo } = await start({ ...DEMO, upload: true, keepLatest: 0, maxRows: 2 });
  assert.equal((await postSample(base)).status, 201);
  assert.equal((await postSample(base)).status, 201);
  for (const res of [await postSample(base), await postUpload(base)]) {
    assert.equal(res.status, 409);
    const { error } = await res.json();
    assert.equal(error.code, 'DEMO_STORAGE_FULL');
    assert.equal(error.message, '데모 저장 한도에 도달했습니다');
  }
  assert.equal(await repo.count(), 2);
});

test('데모 모드가 꺼져 있으면 원문 저장, 삭제·한도 없음', async () => {
  const { base, repo } = await start({ enabled: false, upload: true, keepLatest: 1, maxRows: 1 });
  const { data } = await (await postSample(base)).json();
  assert.equal((await postSample(base)).status, 201);
  assert.equal(await repo.count(), 2);
  assert.ok((await repo.getById(data.id)).rawText.length > 0);
});
