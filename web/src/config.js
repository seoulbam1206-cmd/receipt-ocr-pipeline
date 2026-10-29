import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const num = (v, d) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d);
const bool = (v, d) => (v === undefined || v === '' ? d : v === 'true');
/** TRUST_PROXY: 숫자(프록시 단계 수) | true | false | 서브넷 문자열. 기본 false(로컬) */
const trustProxy = (v) => (v === undefined || v === '' || v === 'false' ? false : v === 'true' ? true : /^\d+$/.test(v) ? Number(v) : v);

const demoMode = bool(process.env.DEMO_MODE, false);

export const config = {
  rootDir: ROOT,
  samplesDir: path.join(ROOT, '..', 'samples'),
  // 화면의 "샘플로 바로 테스트"용 이미지. 데모에서는 이 파일들만 처리한다
  publicSamplesDir: path.join(ROOT, 'public', 'samples'),
  port: num(process.env.PORT, 3000),
  trustProxy: trustProxy(process.env.TRUST_PROXY),
  // 공개 데모용 제한. 로컬 기본값은 모두 꺼져 있어 지금처럼 동작한다
  demo: {
    enabled: demoMode, // OCR 원문 미저장, 최근 keepLatest건만 유지, maxRows건 이상이면 저장 거부
    upload: bool(process.env.DEMO_UPLOAD, true), // false면 파일 업로드 차단(샘플만 처리)
    keepLatest: num(process.env.DEMO_KEEP_LATEST, 50),
    maxRows: num(process.env.DEMO_MAX_ROWS, 200),
  },
  // IP당 1분 요청 수. 0이면 끔(로컬 기본). 데모 모드 기본: API 전체 120, OCR 처리 10
  rateLimit: {
    windowMs: 60_000,
    apiMax: num(process.env.RATE_LIMIT_API_PER_MIN, demoMode ? 120 : 0),
    ocrMax: num(process.env.RATE_LIMIT_OCR_PER_MIN, demoMode ? 10 : 0),
  },
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
