// documents 행 변환(항상 실행)과 실제 MySQL 연결 테스트(npm run test:db 일 때만).
// DB 테스트는 web/.env 의 DB에 행을 만들고, 끝나면 자기가 만든 행만 지운다. 먼저 npm run db:migrate 가 필요하다.
import 'dotenv/config';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';
import { createRepository, connectionOptions, toDocumentRow, fromRow } from '../src/db/repository.js';
import { createMemoryRepository } from '../src/db/memoryRepository.js';

const sample = (over = {}) => ({
  status: 'REVIEW_REQUIRED',
  merchant: '가상커피 테스트점',
  bizNo: '999-99-99997',
  date: '2026-10-27',
  time: '12:34',
  totalAmount: 14000,
  supplyAmount: 12727,
  vat: 1273,
  paymentMethod: '카드',
  cardLast4: '7654',
  category: '식대',
  confidence: 0.96,
  ocrConfidence: 0.9,
  duplicate: false,
  dupHash: null,
  issues: [{ code: 'TOTAL_UNCERTAIN', message: '합계 키워드를 찾지 못해 가장 큰 금액으로 추정함' }],
  rawText: '상호: 가상커피 테스트점\n카드번호 **** **** **** 7654',
  // 계산용 값: 저장하지 않아야 한다
  valid: false,
  totalSource: 'fallback',
  ...over,
});

describe('documents 행 변환', () => {
  test('공통 값은 열, 문서별 값은 fields_json. 계산용 값(valid, totalSource)은 저장하지 않음', () => {
    const row = toDocumentRow(sample(), 'receipt');
    assert.equal(row.doc_type, 'receipt');
    assert.equal(row.doc_date, '2026-10-27');
    assert.equal(row.duplicate, 0);
    const fields = JSON.parse(row.fields_json);
    assert.equal(fields.merchant, '가상커피 테스트점');
    assert.equal(fields.totalAmount, 14000);
    assert.ok(!('date' in fields), '일자는 doc_date 열에만');
    assert.ok(!('valid' in fields) && !('totalSource' in fields) && !('valid' in row));
  });

  test('fromRow: JSON 열이 문자열이든 객체든 같은 결과 (MySQL은 객체, TiDB 드라이버 설정에 따라 문자열)', () => {
    const row = { id: 7, created_at: '2026-10-27 15:00:00', updated_at: null, confidence: 0.96, ocr_confidence: 0.9, ...toDocumentRow(sample(), 'receipt') };
    const a = fromRow(row);
    const b = fromRow({ ...row, fields_json: JSON.parse(row.fields_json), issues: JSON.parse(row.issues) });
    assert.deepEqual(a, b);
    assert.equal(a.date, '2026-10-27');
    assert.equal(a.duplicate, false);
    assert.equal(a.issues[0].code, 'TOTAL_UNCERTAIN');
  });

  test('memoryRepository: 부분 수정은 fields_json 의 다른 값을 유지', async () => {
    const repo = createMemoryRepository();
    const { id } = await repo.insert(sample());
    const updated = await repo.update(id, { totalAmount: 15000, status: 'CONFIRMED' });
    assert.equal(updated.totalAmount, 15000);
    assert.equal(updated.merchant, '가상커피 테스트점');
    assert.equal(updated.status, 'CONFIRMED');
    assert.match(updated.updatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

// npm 이 실행 중인 스크립트 이름. npm test 에서는 DB 테스트를 건너뛴다
const RUN_DB = process.env.npm_lifecycle_event === 'test:db';

describe('MySQL 저장소 (npm run test:db)', { skip: RUN_DB ? false : 'npm run test:db 로 실행할 때만' }, () => {
  const tag = `__dbtest__${randomUUID().slice(0, 8)}`;
  const dupHash = createHash('sha256').update(tag).digest('hex');
  const created = [];
  let repo;
  let raw;

  before(async () => {
    repo = createRepository(config.db);
    raw = mysql.createPool({ ...connectionOptions(config.db), connectionLimit: 1 });
    try {
      await repo.ping();
    } catch (err) {
      throw new Error(`MySQL 연결 또는 documents 테이블 확인 실패: ${err.message} (web/.env 확인, npm run db:migrate)`);
    }
  });

  after(async () => {
    // 이 테스트가 만든 행만 지운다
    if (raw && created.length) await raw.query('DELETE FROM documents WHERE doc_type = ? AND id IN (?)', ['receipt', created]);
    await repo?.close();
    await raw?.end();
  });

  test('접속한 DB가 DB_NAME 과 같음', async () => {
    const [[{ db }]] = await raw.query('SELECT DATABASE() AS db');
    assert.equal(db, config.db.database);
  });

  test('insert → getById: 한글·JSON·일자·소수가 그대로', async () => {
    const saved = await repo.insert(sample({ merchant: `가상커피 ${tag}`, dupHash }));
    created.push(saved.id);
    const got = await repo.getById(saved.id);
    assert.deepEqual(got, saved);
    assert.equal(got.merchant, `가상커피 ${tag}`);
    assert.equal(got.date, '2026-10-27');
    assert.equal(got.confidence, 0.96);
    assert.equal(got.ocrConfidence, 0.9);
    assert.equal(got.duplicate, false);
    assert.deepEqual(got.issues, sample().issues);
    assert.equal(got.rawText, sample().rawText);
    assert.match(got.createdAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.ok(!('totalSource' in got) && !('valid' in got));
  });

  test('update: 부분 수정, 나머지 필드 유지, updatedAt 기록', async () => {
    const id = created[0];
    const updated = await repo.update(id, { totalAmount: 15000, status: 'CONFIRMED', issues: [] });
    assert.equal(updated.totalAmount, 15000);
    assert.equal(updated.status, 'CONFIRMED');
    assert.deepEqual(updated.issues, []);
    assert.equal(updated.merchant, `가상커피 ${tag}`);
    assert.equal(updated.vat, 1273);
    assert.match(updated.updatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test('list: 일자·상태 필터, 일자 내림차순', async () => {
    const older = await repo.insert(sample({ merchant: `가상분식 ${tag}`, date: '2026-10-01', status: 'REVIEW_REQUIRED' }));
    created.push(older.id);
    const mine = (r) => created.includes(r.id);
    const all = (await repo.list({ from: '2026-10-01', to: '2026-10-31' })).filter(mine);
    assert.deepEqual(all.map((r) => r.id), [created[0], older.id]);
    const review = (await repo.list({ status: 'REVIEW_REQUIRED', from: '2026-10-01', to: '2026-10-31' })).filter(mine);
    assert.deepEqual(review.map((r) => r.id), [older.id]);
  });

  test('hasDupHash: 같은 해시 감지, 자기 자신은 제외', async () => {
    assert.equal(await repo.hasDupHash(dupHash), true);
    assert.equal(await repo.hasDupHash(dupHash, created[0]), false);
    assert.equal(await repo.hasDupHash(null), false);
  });

  test('getById: 없는 id는 null', async () => {
    assert.equal(await repo.getById(0), null);
  });

  test('count / pruneKeepLatest: 쿼리 동작 (공유 DB라 실제 삭제는 일어나지 않게 큰 값으로)', async () => {
    const [[{ n }]] = await raw.query('SELECT COUNT(*) AS n FROM documents');
    assert.equal(await repo.count(), Number(n));
    assert.equal(await repo.pruneKeepLatest(1_000_000_000), 0);
    assert.equal(await repo.count(), Number(n));
  });
});
