import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { createReceiptsRouter, errorHandler, ApiError } from './routes/receipts.js';

/**
 * @param {{ repo: object, ocr: object, uploadDir?: string, now?: () => Date }} deps
 */
export function createApp(deps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(config.rootDir, 'public')));
  app.get('/api/health', (req, res) => res.json({ ok: true, ocrPending: deps.ocr.pending ?? 0 }));
  app.use('/api/receipts', createReceiptsRouter(deps));
  app.use('/api', (req, res, next) => next(new ApiError(404, 'NOT_FOUND', '존재하지 않는 API입니다')));
  app.use(errorHandler);
  return app;
}
