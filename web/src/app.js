import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { createReceiptsRouter, errorHandler, ApiError } from './routes/receipts.js';
import { createRateLimiter } from './rateLimit.js';

/**
 * @param {{ repo: object, ocr: object, uploadDir?: string, now?: () => Date, demo?: typeof config.demo,
 *   rateLimit?: typeof config.rateLimit, trustProxy?: boolean | number | string }} deps
 */
export function createApp(deps) {
  const demo = deps.demo ?? config.demo;
  const limits = deps.rateLimit ?? config.rateLimit;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', deps.trustProxy ?? config.trustProxy);
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(config.rootDir, 'public')));
  // 헬스체크는 제한하지 않는다 (잠든 서버를 깨우는 확인 요청이 막히지 않게)
  app.get('/api/health', (req, res) => res.json({ ok: true, ocrPending: deps.ocr.pending ?? 0 }));
  app.use('/api', createRateLimiter({ windowMs: limits.windowMs, max: limits.apiMax }));
  // 화면이 데모 설정에 맞춰 업로드 영역 등을 바꾸도록
  app.get('/api/config', (req, res) => res.json({ data: { demoMode: demo.enabled, uploadEnabled: demo.upload } }));
  // OCR은 무거우므로 따로 더 적게 허용
  const ocrLimiter = createRateLimiter({ windowMs: limits.windowMs, max: limits.ocrMax, message: '영수증 처리 요청이 너무 많습니다' });
  app.use('/api/receipts', createReceiptsRouter({ ...deps, demo, ocrLimiter }));
  app.use('/api', (req, res, next) => next(new ApiError(404, 'NOT_FOUND', '존재하지 않는 API입니다')));
  app.use(errorHandler);
  return app;
}
