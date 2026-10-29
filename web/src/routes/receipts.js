import { mkdirSync, readdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { analyzeReceipt, revalidate } from '../services/pipeline.js';
import { toExpenseCsv } from '../services/exporter.js';
import { CATEGORIES } from '../services/categorizer.js';
import { STATUS } from '../services/validator.js';

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다');
const amount = z.number().int().nonnegative().nullable();

const listQuery = z.object({
  status: z.enum([STATUS.CONFIRMED, STATUS.REVIEW_REQUIRED]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  category: z.enum(CATEGORIES).optional(),
});
const exportQuery = listQuery.pick({ from: true, to: true });
const idParam = z.coerce.number().int().positive();
const patchBody = z
  .object({
    merchant: z.string().trim().min(1).max(200).nullable(),
    bizNo: z.string().regex(/^\d{3}-\d{2}-\d{5}$/).nullable(),
    date: isoDate.nullable(),
    time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).nullable(),
    supplyAmount: amount,
    vat: amount,
    totalAmount: amount,
    paymentMethod: z.string().max(20).nullable(),
    category: z.enum(CATEGORIES),
    confirm: z.boolean(),
  })
  .partial()
  .strict();

const parse = (schema, value) => {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw new ApiError(400, 'VALIDATION_ERROR', '요청 값이 올바르지 않습니다', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
};

/** 응답에서 내부용 필드 제외 */
const publicView = ({ dupHash, ...rest }) => rest;

/** 샘플 폴더의 이미지 파일명 목록 (이 이름만 처리하므로 경로 조작은 통하지 않는다) */
const listSamples = (dir) => {
  try {
    return readdirSync(dir).filter((f) => config.upload.allowedExt.includes(path.extname(f).slice(1).toLowerCase()));
  } catch {
    return [];
  }
};

/**
 * @param {{ repo: object, ocr: object, uploadDir?: string, now?: () => Date,
 *   demo?: typeof config.demo, samplesDir?: string, ocrLimiter?: import('express').RequestHandler }} deps
 */
export function createReceiptsRouter({
  repo,
  ocr,
  uploadDir = config.upload.dir,
  now = () => new Date(),
  demo = config.demo,
  samplesDir = config.publicSamplesDir,
  ocrLimiter = (req, res, next) => next(),
}) {
  mkdirSync(uploadDir, { recursive: true });
  const samples = new Set(listSamples(samplesDir));
  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: config.upload.maxBytes, files: 1 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).slice(1).toLowerCase();
      if (!config.upload.allowedExt.includes(ext)) {
        return cb(new ApiError(400, 'INVALID_FILE_TYPE', `허용 확장자: ${config.upload.allowedExt.join(', ')}`));
      }
      cb(null, true);
    },
  });

  const router = Router();

  /** 데모 저장 한도(문서 전체 행 수). OCR 전에 확인해 헛된 처리를 막는다 */
  const checkStorage = async () => {
    if (demo.enabled && demo.maxRows > 0 && (await repo.count()) >= demo.maxRows) {
      throw new ApiError(409, 'DEMO_STORAGE_FULL', '데모 저장 한도에 도달했습니다');
    }
  };

  /** OCR → 저장 → 응답. 데모 모드면 원문은 응답에만 담고 저장하지 않으며, 최근 keepLatest건만 남긴다 */
  const processImage = async (imagePath, res) => {
    let result;
    try {
      result = await analyzeReceipt(imagePath, { ocr, repo, now: now() });
    } catch (err) {
      if (err.code === 'INVALID_IMAGE') {
        throw new ApiError(422, 'INVALID_IMAGE', '이미지를 해석할 수 없습니다');
      }
      throw err;
    }
    const saved = await repo.insert(demo.enabled ? { ...result, rawText: null } : result);
    if (demo.enabled && demo.keepLatest > 0) await repo.pruneKeepLatest(demo.keepLatest);
    res.status(201).json({ data: publicView({ ...saved, rawText: result.rawText, valid: result.valid }) });
  };

  const uploadGuard = (req, res, next) =>
    demo.upload
      ? next()
      : next(new ApiError(403, 'UPLOAD_DISABLED', '데모에서는 파일 업로드가 꺼져 있습니다. 화면의 샘플을 눌러 테스트하세요'));

  router.post('/', uploadGuard, ocrLimiter, async (req, res, next) => {
    await checkStorage();
    next();
  }, upload.single('image'), async (req, res) => {
    if (!req.file) throw new ApiError(400, 'FILE_REQUIRED', "multipart 필드 'image'로 이미지를 첨부하세요");
    try {
      await processImage(req.file.path, res);
    } finally {
      // 원본 영수증은 처리 직후 삭제
      await unlink(req.file.path).catch(() => {});
    }
  });

  // 화면의 샘플 이미지(서버에 있는 가상 영수증)를 처리. 업로드가 꺼진 데모에서도 동작한다
  router.post('/samples/:name', ocrLimiter, async (req, res) => {
    const name = req.params.name;
    if (!samples.has(name)) throw new ApiError(404, 'SAMPLE_NOT_FOUND', `샘플 ${name}을(를) 찾을 수 없습니다`);
    await checkStorage();
    await processImage(path.join(samplesDir, name), res);
  });

  router.get('/', async (req, res) => {
    const filters = parse(listQuery, req.query);
    res.json({ data: (await repo.list(filters)).map(publicView) });
  });

  router.get('/export.csv', async (req, res) => {
    const { from, to } = parse(exportQuery, req.query);
    const csv = toExpenseCsv((await repo.list({ from, to })).reverse());
    const name = `expense_${from ?? 'all'}_${to ?? 'all'}.csv`;
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${name}"`);
    res.send(csv);
  });

  const load = async (req) => {
    const id = parse(idParam, req.params.id);
    const rec = await repo.getById(id);
    if (!rec) throw new ApiError(404, 'NOT_FOUND', `영수증 ${id}을(를) 찾을 수 없습니다`);
    return rec;
  };

  router.get('/:id', async (req, res) => {
    res.json({ data: publicView(await load(req)) });
  });

  router.patch('/:id', async (req, res) => {
    const existing = await load(req);
    const { confirm, ...changes } = parse(patchBody, req.body ?? {});
    const update = await revalidate(existing, changes, { repo, now: now(), confirm });
    res.json({ data: publicView(await repo.update(existing.id, update)) });
  });

  return router;
}

/** 일관된 JSON 에러 응답: { error: { code, message, details? } } */
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  let e = err;
  if (err instanceof multer.MulterError) {
    e =
      err.code === 'LIMIT_FILE_SIZE'
        ? new ApiError(413, 'FILE_TOO_LARGE', `파일 크기는 ${config.upload.maxBytes / 1024 / 1024}MB 이하여야 합니다`)
        : new ApiError(400, 'UPLOAD_ERROR', err.message);
  } else if (err.type === 'entity.parse.failed') {
    e = new ApiError(400, 'INVALID_JSON', 'JSON 본문을 해석할 수 없습니다');
  } else if (!(err instanceof ApiError)) {
    console.error('[error]', err.message);
    e = new ApiError(500, 'INTERNAL_ERROR', '서버 내부 오류');
  }
  res.status(e.status).json({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });
}
