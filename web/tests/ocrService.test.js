import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOcrService, createHttpEngine, createEngine, missingTessdata } from '../src/services/ocrService.js';

const fakeEngine = () => {
  const state = { running: 0, maxRunning: 0, calls: 0, terminated: false };
  return {
    state,
    async init() {},
    async recognize(buf) {
      state.calls++;
      state.running++;
      state.maxRunning = Math.max(state.maxRunning, state.running);
      await new Promise((r) => setTimeout(r, 10));
      state.running--;
      if (buf.toString() === 'fail') throw new Error('boom');
      return { text: buf.toString(), confidence: 0.9 };
    },
    async terminate() {
      state.terminated = true;
    },
  };
};

test('동시 요청이 와도 OCR은 한 번에 1개만 실행', async () => {
  const engine = fakeEngine();
  const svc = createOcrService(engine);
  const results = await Promise.all(['a', 'b', 'c', 'd'].map((s) => svc.recognize(Buffer.from(s))));
  assert.deepEqual(results.map((r) => r.text), ['a', 'b', 'c', 'd']);
  assert.equal(engine.state.maxRunning, 1);
});

test('실패한 작업 이후에도 큐가 계속 동작', async () => {
  const engine = fakeEngine();
  const svc = createOcrService(engine);
  const p1 = svc.recognize(Buffer.from('fail'));
  const p2 = svc.recognize(Buffer.from('ok'));
  await assert.rejects(p1, /boom/);
  assert.equal((await p2).text, 'ok');
  await svc.terminate();
  assert.equal(engine.state.terminated, true);
});

test('missingTessdata는 없는 언어 파일을 보고', () => {
  assert.deepEqual(missingTessdata('zzz', 'C:/__no_such_dir__'), ['zzz']);
});

const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('httpEngine: /ocr 응답을 { text, confidence }로 변환하고 이미지를 multipart로 전송', async () => {
  const calls = [];
  const engine = createHttpEngine({
    url: 'http://ocr.test/',
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, method: init.method ?? 'GET', image: init.body?.get?.('image') });
      if (url.endsWith('/health')) return jsonRes({ ok: true });
      return jsonRes({ text: '합계 14,000', confidence: 1.7, lines: [] });
    },
  });
  await engine.init();
  const r = await engine.recognize(Buffer.from('png'));
  assert.deepEqual(r, { text: '합계 14,000', confidence: 1 });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['GET http://ocr.test/health', 'POST http://ocr.test/ocr']);
  assert.equal(await calls[1].image.text(), 'png');
});

test('httpEngine: 연결 실패·오류 응답은 원인이 담긴 에러', async () => {
  const down = createHttpEngine({ url: 'http://ocr.test', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  await assert.rejects(down.init(), /ocr-service 연결 실패.*ECONNREFUSED/);
  const bad = createHttpEngine({ url: 'http://ocr.test', fetchImpl: async () => new Response('boom', { status: 500 }) });
  await assert.rejects(bad.recognize(Buffer.from('x')), /응답 오류 500: boom/);
});

test('createEngine: 이름으로 엔진 선택, 모르는 이름은 에러', () => {
  assert.equal(createEngine('tesseract').name, 'tesseract');
  assert.equal(createEngine('paddle').name, 'paddle');
  assert.throws(() => createEngine('nope'), /알 수 없는 OCR_ENGINE/);
});
