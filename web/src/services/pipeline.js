import { readFile } from 'node:fs/promises';
import { preprocessImage } from './preprocess.js';
import { parseReceipt } from './parser.js';
import { validateReceipt, computeDupHash, STATUS } from './validator.js';
import { categorize } from './categorizer.js';

/**
 * 전처리 → OCR → 파싱 → 중복 검사 → 검증 → 분류 (저장은 호출자가)
 * @param {string|Buffer} input
 * @param {{ ocr: { recognize(buf: Buffer): Promise<{text: string, confidence: number}> }, repo?: object, preprocess?: boolean, now?: Date }} deps
 */
export async function analyzeReceipt(input, { ocr, repo, preprocess = true, now } = {}) {
  let image;
  try {
    image = preprocess ? await preprocessImage(input) : Buffer.isBuffer(input) ? input : await readFile(input);
  } catch (err) {
    throw Object.assign(new Error(`이미지 처리 실패: ${err.message}`), { code: 'INVALID_IMAGE' });
  }
  const { text, confidence: ocrConfidence } = await ocr.recognize(image);
  image = null;

  const parsed = parseReceipt(text);
  const dupHash = computeDupHash(parsed);
  const duplicate = repo ? await repo.hasDupHash(dupHash) : false;
  const validation = validateReceipt(parsed, { ocrConfidence, now, duplicate });

  return {
    ...parsed,
    category: categorize(parsed),
    ocrConfidence,
    dupHash,
    duplicate,
    status: validation.status,
    confidence: validation.confidence,
    issues: validation.issues,
    valid: validation.valid,
  };
}

/**
 * 검토 화면에서 수정한 값을 반영해 재검증. 사람이 검토한 값이므로 OCR 신뢰도는 1로 본다.
 * confirm=true면 필수 필드가 있을 때 CONFIRMED로 확정한다.
 */
export async function revalidate(existing, changes, { repo, now, confirm = false } = {}) {
  const merged = { ...existing, ...changes };
  const dupHash = computeDupHash(merged);
  const duplicate = repo ? await repo.hasDupHash(dupHash, existing.id) : false;
  const validation = validateReceipt(merged, { ocrConfidence: 1, now, duplicate });
  const missing = validation.issues.some((i) => i.code === 'MISSING_FIELDS');
  return {
    ...changes,
    dupHash,
    duplicate,
    ocrConfidence: 1,
    confidence: validation.confidence,
    issues: validation.issues,
    status: confirm && !missing ? STATUS.CONFIRMED : validation.status,
  };
}
