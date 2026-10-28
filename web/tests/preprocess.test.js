import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { preprocessImage } from '../src/services/preprocess.js';

const makeImage = (width, height) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg()
    .toBuffer();

test('긴 변을 1800px 이하로 축소하고 grayscale로 변환', async () => {
  const out = await preprocessImage(await makeImage(3600, 1200));
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 1800);
  assert.equal(meta.height, 600);
  assert.equal(meta.format, 'png');
  const { channels } = await sharp(out).stats();
  assert.equal(channels.length, 1);
});

test('작은 이미지는 확대하지 않음', async () => {
  const out = await preprocessImage(await makeImage(400, 300));
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 400);
  assert.equal(meta.height, 300);
});

test('threshold 옵션 시 픽셀이 0 또는 255로 이진화', async () => {
  const out = await preprocessImage(await makeImage(200, 100), { threshold: true });
  const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data.every((v) => v === 0 || v === 255));
});
