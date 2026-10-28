import { existsSync } from 'node:fs';
import path from 'node:path';
import { createWorker } from 'tesseract.js';
import { config } from '../config.js';

/**
 * OCR 엔진 인터페이스
 * @typedef {Object} OcrEngine
 * @property {() => Promise<void>} init
 * @property {(buffer: Buffer) => Promise<{ text: string, confidence: number }>} recognize  confidence: 0~1
 * @property {() => Promise<void>} terminate
 */

/** tessdata 폴더에 없는 언어 파일 목록 */
export function missingTessdata(langs = config.ocr.langs, langPath = config.ocr.langPath) {
  return langs
    .split('+')
    .filter((l) => !existsSync(path.join(langPath, `${l}.traineddata`)));
}

/** tesseract.js 어댑터: 워커 1개를 생성해 재사용 */
export function createTesseractEngine({ langs = config.ocr.langs, langPath = config.ocr.langPath } = {}) {
  let worker = null;
  return {
    name: 'tesseract',
    async init() {
      if (worker) return;
      const missing = missingTessdata(langs, langPath);
      const local = missing.length === 0;
      worker = await createWorker(langs.split('+'), 1, {
        // 로컬 파일 우선. 없으면 tesseract.js 기본 CDN으로 폴백
        ...(local ? { langPath, gzip: false } : {}),
        cacheMethod: 'none',
      });
    },
    async recognize(buffer) {
      if (!worker) await this.init();
      const { data } = await worker.recognize(buffer);
      return { text: data.text ?? '', confidence: Math.max(0, Math.min(1, (data.confidence ?? 0) / 100)) };
    },
    async terminate() {
      if (worker) await worker.terminate();
      worker = null;
    },
  };
}

/**
 * ocr-service(Python, PaddleOCR) HTTP 어댑터
 * POST {url}/ocr (multipart image) → { text, confidence, lines }
 */
export function createHttpEngine({
  url = config.ocr.serviceUrl,
  timeoutMs = config.ocr.serviceTimeoutMs,
  fetchImpl = fetch,
} = {}) {
  const base = url.replace(/\/+$/, '');
  const call = async (pathname, init) => {
    let res;
    try {
      res = await fetchImpl(base + pathname, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new Error(`ocr-service 연결 실패 (${base}): ${err.message}`);
    }
    if (!res.ok) throw new Error(`ocr-service 응답 오류 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };
  return {
    name: 'paddle',
    async init() {
      const health = await call('/health');
      if (!health.ok) throw new Error('ocr-service가 준비되지 않았습니다');
    },
    async recognize(buffer) {
      const form = new FormData();
      form.append('image', new Blob([buffer], { type: 'image/png' }), 'image.png');
      const data = await call('/ocr', { method: 'POST', body: form });
      return {
        text: typeof data.text === 'string' ? data.text : '',
        confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
      };
    },
    async terminate() {},
  };
}

/** OCR_ENGINE 값으로 엔진 선택 */
export function createEngine(name = config.ocr.engine) {
  if (name === 'tesseract') return createTesseractEngine();
  if (name === 'paddle') return createHttpEngine();
  throw new Error(`알 수 없는 OCR_ENGINE: ${name} (tesseract | paddle)`);
}

/**
 * 엔진을 감싸 동시 실행 1개의 순차 큐로 OCR을 처리하는 서비스
 * @param {OcrEngine} engine
 */
export function createOcrService(engine = createTesseractEngine()) {
  let tail = Promise.resolve();
  let pending = 0;

  return {
    engine,
    init: () => engine.init(),
    get pending() {
      return pending;
    },
    /** @returns {Promise<{ text: string, confidence: number }>} */
    recognize(buffer) {
      pending++;
      const run = tail.then(() => engine.recognize(buffer));
      // 실패해도 다음 작업은 계속 진행
      tail = run.catch(() => {}).finally(() => pending--);
      return run;
    },
    async terminate() {
      await tail;
      await engine.terminate();
    },
  };
}
