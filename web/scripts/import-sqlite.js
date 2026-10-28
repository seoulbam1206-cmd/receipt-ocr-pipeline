// 예전 SQLite(receipts 테이블) 데이터를 MySQL documents 테이블로 옮긴다. SQLite 파일은 읽기만 하고 지우지 않는다.
// 사용: npm run db:import-sqlite [-- <SQLite 파일 경로>]   (기본: web/data/receipts.db, 접속 정보는 web/.env)
// 여러 번 실행해도 같은 행(종류·생성 시각·원문이 같은 행)은 다시 넣지 않는다.
import 'dotenv/config';
import { existsSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';
import { connectionOptions, toDocumentRow } from '../src/db/repository.js';

const file = path.resolve(process.argv[2] ?? path.join(config.rootDir, 'data', 'receipts.db'));
if (!existsSync(file)) {
  console.error(`[import] SQLite 파일이 없습니다: ${file}`);
  process.exit(1);
}

const sqlite = new Database(file, { readonly: true, fileMustExist: true });
const rows = sqlite.prepare('SELECT * FROM receipts ORDER BY id').all();
sqlite.close();

// SQLite 열 → API 필드명 (예전 repository 의 fromRow 와 같은 규칙)
const toRecord = (r) => ({
  status: r.status,
  merchant: r.merchant,
  bizNo: r.biz_no,
  date: r.date,
  time: r.time,
  totalAmount: r.total,
  supplyAmount: r.supply,
  vat: r.vat,
  paymentMethod: r.payment_method,
  cardLast4: r.card_last4,
  category: r.category,
  confidence: r.confidence,
  ocrConfidence: r.ocr_confidence,
  duplicate: r.duplicate === 1,
  dupHash: r.dup_hash,
  issues: JSON.parse(r.issues_json || '[]'),
  rawText: r.raw_text,
});

const conn = await mysql.createConnection(connectionOptions(config.db));
let inserted = 0;
let skipped = 0;
try {
  // .env 의 DB_NAME 외의 DB에는 손대지 않는다
  const [[{ db }]] = await conn.query('SELECT DATABASE() AS db');
  if (db !== config.db.database) throw new Error(`접속한 DB(${db})가 DB_NAME(${config.db.database})과 다릅니다`);

  await conn.beginTransaction();
  for (const r of rows) {
    const [dup] = await conn.query(
      'SELECT 1 FROM documents WHERE doc_type = ? AND created_at = ? AND raw_text <=> ? LIMIT 1',
      ['receipt', r.created_at, r.raw_text],
    );
    if (dup.length) {
      skipped++;
      continue;
    }
    // 생성·수정 시각은 SQLite 값을 그대로 쓴다(SQLite는 localtime 으로 저장했다)
    const row = { ...toDocumentRow(toRecord(r), 'receipt'), created_at: r.created_at, updated_at: r.updated_at };
    const cols = Object.keys(row);
    await conn.query(`INSERT INTO documents (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, Object.values(row));
    inserted++;
  }
  await conn.commit();
  console.log(`[import] ${file} → ${db}.documents: ${inserted}건 추가, ${skipped}건은 이미 있어 건너뜀 (전체 ${rows.length}건)`);
} catch (err) {
  await conn.rollback().catch(() => {});
  console.error(`[import] 실패, 아무것도 저장하지 않았습니다: ${err.message}`);
  process.exitCode = 1;
} finally {
  await conn.end();
}
