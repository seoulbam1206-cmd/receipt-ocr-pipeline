import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { createReceiptsRouter, errorHandler, ApiError } from './routes/receipts.js';

/**
 * @param {{ repo: object, ocr: object, uploadDir?: string, now?: () => Date, demo?: typeof config.demo }} deps
 */
export function createApp(deps) {
  const demo = deps.demo ?? config.demo;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(config.rootDir, 'public')));
  app.get('/api/health', (req, res) => res.json({ ok: true, ocrPending: deps.ocr.pending ?? 0 }));
  // 화면이 데모 설정에 맞춰 업로드 영역 등을 바꾸도록
  app.get('/api/config', (req, res) => res.json({ data: { demoMode: demo.enabled, uploadEnabled: demo.upload } }));
  app.use('/api/receipts', createReceiptsRouter({ ...deps, demo }));
  app.use('/api', (req, res, next) => next(new ApiError(404, 'NOT_FOUND', '존재하지 않는 API입니다')));
  app.use(errorHandler);
  return app;
}
