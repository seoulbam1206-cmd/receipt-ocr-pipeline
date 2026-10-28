import 'dotenv/config';
import { config } from './config.js';
import { createApp } from './app.js';
import { createRepository } from './db/repository.js';
import { createOcrService, createEngine, missingTessdata } from './services/ocrService.js';

const missing = config.ocr.engine === 'tesseract' ? missingTessdata() : [];
if (missing.length) {
  console.warn(
    [
      '',
      `[경고] tessdata 폴더에 언어 파일이 없습니다: ${missing.map((l) => l + '.traineddata').join(', ')}`,
      `  위치: ${config.ocr.langPath}`,
      '  다운로드(PowerShell):',
      ...missing.map(
        (l) =>
          `    Invoke-WebRequest -Uri https://github.com/tesseract-ocr/tessdata_fast/raw/main/${l}.traineddata -OutFile tessdata\\${l}.traineddata`,
      ),
      '  파일이 없으면 tesseract.js가 CDN에서 받아오려 시도합니다(네트워크 필요). 자세한 내용은 README 참고.',
      '',
    ].join('\n'),
  );
}

const repo = createRepository(config.db);
try {
  await repo.ping();
  console.log(`[db] MySQL 연결 확인 (${config.db.host}:${config.db.port}/${config.db.database})`);
} catch (err) {
  // DB 없이는 저장·조회가 모두 안 되므로 기동하지 않는다
  console.error(
    [
      `[db] MySQL 연결 실패: ${err.message}`,
      '  1) web/.env 의 DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD 를 확인하세요 (예시: web/.env.example)',
      '  2) 테이블이 없다는 오류면 npm run db:migrate 를 먼저 실행하세요',
    ].join('\n'),
  );
  await repo.close().catch(() => {});
  process.exit(1);
}
const ocr = createOcrService(createEngine());

try {
  console.log(
    config.ocr.engine === 'tesseract'
      ? `[ocr] tesseract 워커 초기화 중 (${config.ocr.langs})...`
      : `[ocr] ocr-service 연결 확인 중 (${config.ocr.serviceUrl})...`,
  );
  await ocr.init();
  console.log('[ocr] 준비 완료');
} catch (err) {
  // OCR 없이도 조회·수정·내보내기 API는 동작하도록 기동은 계속한다
  console.error(`[ocr] 초기화 실패: ${err.message}`);
}

const server = createApp({ repo, ocr }).listen(config.port, () => {
  console.log(`[server] http://localhost:${config.port}`);
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`[server] ${signal} 수신, 종료 중...`);
  server.close();
  await ocr.terminate().catch(() => {});
  await repo.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
