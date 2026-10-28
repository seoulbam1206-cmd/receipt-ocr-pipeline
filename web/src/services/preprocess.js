import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { config } from '../config.js';

// 대용량 이미지 디코딩 시 메모리 폭주 방지
sharp.cache(false);
sharp.concurrency(1);

/**
 * OCR용 전처리. 입력 파일을 한 번만 읽고 단일 sharp 파이프라인으로 처리한다.
 * EXIF 회전 → 긴 변 축소(확대 금지) → grayscale → normalize → sharpen → (threshold)
 * @param {string|Buffer} input 파일 경로 또는 버퍼
 * @param {{ maxLongSide?: number, threshold?: boolean, thresholdValue?: number }} [opts]
 * @returns {Promise<Buffer>} PNG 버퍼
 */
export async function preprocessImage(input, opts = {}) {
  const { maxLongSide, threshold, thresholdValue } = { ...config.preprocess, ...opts };
  const source = Buffer.isBuffer(input) ? input : await readFile(input);

  let pipeline = sharp(source, { failOn: 'error', limitInputPixels: 50_000_000 })
    .rotate()
    .resize({
      width: maxLongSide,
      height: maxLongSide,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .grayscale()
    .normalize()
    .sharpen();

  if (threshold) pipeline = pipeline.threshold(thresholdValue);

  // 1채널 출력(3채널 대비 메모리 1/3)
  return pipeline.toColourspace('b-w').png({ compressionLevel: 3 }).toBuffer();
}
