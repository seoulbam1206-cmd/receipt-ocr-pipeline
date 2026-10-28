import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  rootDir: ROOT,
  samplesDir: path.join(ROOT, '..', 'samples'),
  port: num(process.env.PORT, 3000),
  upload: {
    dir: path.join(ROOT, 'uploads'),
    maxBytes: 5 * 1024 * 1024,
    allowedExt: ['jpg', 'jpeg', 'png', 'webp'],
  },
  preprocess: {
    maxLongSide: 1800,
    threshold: process.env.OCR_THRESHOLD === 'on', // 이진화 on/off (기본 off)
    thresholdValue: 160,
  },
  ocr: {
    // tesseract: tesseract.js(로컬 WASM) | paddle: ocr-service(Python, PaddleOCR) HTTP 호출
    engine: process.env.OCR_ENGINE || 'tesseract',
    serviceUrl: process.env.OCR_SERVICE_URL || 'http://127.0.0.1:8000',
    serviceTimeoutMs: num(process.env.OCR_SERVICE_TIMEOUT_MS, 60_000),
    langs: 'kor+eng',
    langPath: path.join(ROOT, 'tessdata'),
    confidenceThreshold: num(process.env.OCR_CONFIDENCE_THRESHOLD, 0.75),
  },
  // MySQL 8.0 / TiDB. 값은 .env 에서 읽는다(web/.env.example 참고). 비밀번호 기본값은 없다
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: num(process.env.DB_PORT, 3306),
    database: process.env.DB_NAME || 'ocr_pipeline',
    user: process.env.DB_USER || '',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true', // TiDB Cloud는 true
    timeZone: process.env.DB_TIMEZONE || '+09:00',
    connectionLimit: num(process.env.DB_CONNECTION_LIMIT, 5),
  },
};
