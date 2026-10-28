import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';

test('config 기본값', () => {
  assert.equal(config.port, 3000);
  assert.equal(config.upload.maxBytes, 5 * 1024 * 1024);
  assert.deepEqual(config.upload.allowedExt, ['jpg', 'jpeg', 'png', 'webp']);
  assert.equal(config.preprocess.maxLongSide, 1800);
  assert.equal(config.ocr.confidenceThreshold, 0.75);
});
