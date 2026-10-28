import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS receipts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at     TEXT,
  status         TEXT NOT NULL,
  merchant       TEXT,
  biz_no         TEXT,
  date           TEXT,
  time           TEXT,
  total          INTEGER,
  supply         INTEGER,
  vat            INTEGER,
  payment_method TEXT,
  card_last4     TEXT,
  category       TEXT,
  confidence     REAL,
  ocr_confidence REAL,
  duplicate      INTEGER NOT NULL DEFAULT 0,
  dup_hash       TEXT,
  issues_json    TEXT NOT NULL DEFAULT '[]',
  raw_text       TEXT
);
CREATE INDEX IF NOT EXISTS idx_receipts_dup_hash ON receipts(dup_hash);
CREATE INDEX IF NOT EXISTS idx_receipts_date ON receipts(date);
`;

// API 필드명(camelCase) ↔ 컬럼명
const FIELD_TO_COLUMN = {
  status: 'status',
  merchant: 'merchant',
  bizNo: 'biz_no',
  date: 'date',
  time: 'time',
  totalAmount: 'total',
  supplyAmount: 'supply',
  vat: 'vat',
  paymentMethod: 'payment_method',
  cardLast4: 'card_last4',
  category: 'category',
  confidence: 'confidence',
  ocrConfidence: 'ocr_confidence',
  duplicate: 'duplicate',
  dupHash: 'dup_hash',
  issues: 'issues_json',
  rawText: 'raw_text',
};

const toRow = (rec) => {
  const row = {};
  for (const [field, col] of Object.entries(FIELD_TO_COLUMN)) {
    if (!(field in rec)) continue;
    let v = rec[field];
    if (field === 'issues') v = JSON.stringify(v ?? []);
    if (field === 'duplicate') v = v ? 1 : 0;
    row[col] = v ?? null;
  }
  return row;
};

const fromRow = (row) =>
  row && {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    merchant: row.merchant,
    bizNo: row.biz_no,
    date: row.date,
    time: row.time,
    totalAmount: row.total,
    supplyAmount: row.supply,
    vat: row.vat,
    paymentMethod: row.payment_method,
    cardLast4: row.card_last4,
    category: row.category,
    confidence: row.confidence,
    ocrConfidence: row.ocr_confidence,
    duplicate: row.duplicate === 1,
    dupHash: row.dup_hash,
    issues: JSON.parse(row.issues_json || '[]'),
    rawText: row.raw_text,
  };

/** @param {string} file DB 파일 경로 또는 ':memory:' */
export function createRepository(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const byId = db.prepare('SELECT * FROM receipts WHERE id = ?');
  const dupStmt = db.prepare('SELECT 1 FROM receipts WHERE dup_hash = ? AND id != ? LIMIT 1');

  return {
    insert(rec) {
      const row = toRow(rec);
      const cols = Object.keys(row);
      const info = db
        .prepare(`INSERT INTO receipts (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`)
        .run(row);
      return fromRow(byId.get(info.lastInsertRowid));
    },
    getById(id) {
      return fromRow(byId.get(id)) ?? null;
    },
    update(id, rec) {
      const row = toRow(rec);
      const cols = Object.keys(row);
      if (cols.length) {
        db.prepare(
          `UPDATE receipts SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = datetime('now', 'localtime') WHERE id = @id`,
        ).run({ ...row, id });
      }
      return this.getById(id);
    },
    /** @param {{ status?: string, from?: string, to?: string, category?: string }} filters */
    list({ status, from, to, category } = {}) {
      const where = [];
      const params = {};
      if (status) (where.push('status = @status'), (params.status = status));
      if (category) (where.push('category = @category'), (params.category = category));
      if (from) (where.push('date >= @from'), (params.from = from));
      if (to) (where.push('date <= @to'), (params.to = to));
      const sql = `SELECT * FROM receipts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY date DESC, id DESC`;
      return db.prepare(sql).all(params).map(fromRow);
    },
    /** 다른 레코드에 같은 해시가 있는지 */
    hasDupHash(hash, excludeId = -1) {
      return Boolean(hash && dupStmt.get(hash, excludeId));
    },
    close() {
      db.close();
    },
  };
}
