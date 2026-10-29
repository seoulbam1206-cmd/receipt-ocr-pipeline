import mysql from 'mysql2/promise';

/**
 * documents 테이블 저장소 (MySQL 8.0 / TiDB). 스키마는 db/migrations/ 참고.
 * 공통 값은 열로, 문서 종류별 값은 fields_json 에 둔다. API 필드명(camelCase)은 SQLite 시절과 같다.
 */

// 문서 종류별로 fields_json 에 저장할 필드. 여기 없는 키(valid, totalSource 등 계산용 값)는 저장하지 않는다
export const DOC_FIELDS = {
  receipt: ['merchant', 'bizNo', 'time', 'totalAmount', 'supplyAmount', 'vat', 'paymentMethod', 'cardLast4'],
};

// API 필드명 ↔ 공통 열
const COMMON_COLUMNS = {
  status: 'status',
  confidence: 'confidence',
  ocrConfidence: 'ocr_confidence',
  issues: 'issues',
  date: 'doc_date',
  category: 'category',
  duplicate: 'duplicate',
  dupHash: 'dup_hash',
  rawText: 'raw_text',
};

/** config.db → mysql2 접속 옵션. TiDB Cloud는 TLS가 필수라 DB_SSL=true */
export function connectionOptions(db) {
  return {
    host: db.host,
    port: db.port,
    database: db.database,
    user: db.user,
    password: db.password,
    ssl: db.ssl ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
    charset: 'utf8mb4',
    dateStrings: true, // DATE/DATETIME을 'YYYY-MM-DD' 문자열 그대로 (SQLite 때와 같은 응답)
    decimalNumbers: true,
  };
}

/**
 * 세션 시간대(promise 연결용). created_at 기본값(CURRENT_TIMESTAMP)이 DB 서버 위치(TiDB Cloud는 UTC)와
 * 관계없이 같은 시간대가 되게 한다
 */
export const setTimeZone = (conn, timeZone) => conn.query('SET time_zone = ?', [timeZone]);

const parseJson = (v, fallback) => (v == null ? fallback : typeof v === 'string' ? JSON.parse(v) : v);

/** 레코드(부분 가능) → documents 열. fields 는 fields_json 으로 합칠 문서별 값 */
export function toColumns(rec) {
  const cols = {};
  for (const [field, col] of Object.entries(COMMON_COLUMNS)) {
    if (!(field in rec)) continue;
    let v = rec[field] ?? null;
    if (field === 'issues') v = JSON.stringify(v ?? []);
    if (field === 'duplicate') v = v ? 1 : 0;
    cols[col] = v;
  }
  return cols;
}

/** 레코드에서 fields_json 대상 필드만 */
export const pickFields = (rec, docType) =>
  Object.fromEntries(DOC_FIELDS[docType].filter((f) => f in rec).map((f) => [f, rec[f] ?? null]));

/** insert용 전체 행 */
export function toDocumentRow(rec, docType) {
  const empty = Object.fromEntries(DOC_FIELDS[docType].map((f) => [f, null]));
  return {
    doc_type: docType,
    ...toColumns({ issues: [], duplicate: false, ...rec }),
    fields_json: JSON.stringify({ ...empty, ...pickFields(rec, docType) }),
  };
}

export function fromRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    ...parseJson(row.fields_json, {}),
    date: row.doc_date,
    category: row.category,
    confidence: row.confidence,
    ocrConfidence: row.ocr_confidence,
    duplicate: row.duplicate === 1,
    dupHash: row.dup_hash,
    issues: parseJson(row.issues, []),
    rawText: row.raw_text,
  };
}

const insertSql = (row) => {
  const cols = Object.keys(row);
  return [`INSERT INTO documents (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, Object.values(row)];
};

/**
 * @param {{ host: string, port: number, database: string, user: string, password: string, ssl: boolean, timeZone: string, connectionLimit: number }} db config.db
 * @param {{ docType?: string }} [opts] 이 저장소가 다루는 문서 종류
 */
export function createRepository(db, { docType = 'receipt' } = {}) {
  if (!DOC_FIELDS[docType]) throw new Error(`알 수 없는 문서 종류: ${docType}`);
  const pool = mysql.createPool({
    ...connectionOptions(db),
    connectionLimit: db.connectionLimit,
    waitForConnections: true,
    // 무료 서버가 오래 잠들었다 깨면 끊긴 연결을 다시 쓰지 않도록: TCP keepalive + 쉬는 연결은 1분 뒤 닫는다
    enableKeepAlive: true,
    maxIdle: 1,
    idleTimeout: 60_000,
  });
  // 풀이 새 연결을 만들 때마다 세션 시간대를 맞춘다. 콜백 API 연결이고, 같은 연결의 명령은 순서대로 실행된다
  pool.pool.on('connection', (conn) =>
    conn.query('SET time_zone = ?', [db.timeZone], (err) => err && console.error(`[db] time_zone 설정 실패: ${err.message}`)),
  );

  const byId = async (conn, id, lock = false) => {
    const [rows] = await conn.query(
      `SELECT * FROM documents WHERE id = ? AND doc_type = ?${lock ? ' FOR UPDATE' : ''}`,
      [id, docType],
    );
    return rows[0];
  };

  return {
    docType,
    /** 접속과 테이블 존재 확인 (기동 시) */
    async ping() {
      await pool.query('SELECT 1 FROM documents LIMIT 0');
    },
    async insert(rec) {
      const [info] = await pool.query(...insertSql(toDocumentRow(rec, docType)));
      return fromRow(await byId(pool, info.insertId));
    },
    async getById(id) {
      return fromRow(await byId(pool, id));
    },
    /** 부분 수정. fields_json 은 기존 값과 합친다 */
    async update(id, rec) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const row = await byId(conn, id, true);
        if (row) {
          const cols = toColumns(rec);
          const fields = pickFields(rec, docType);
          if (Object.keys(fields).length) {
            cols.fields_json = JSON.stringify({ ...parseJson(row.fields_json, {}), ...fields });
          }
          if (Object.keys(cols).length) {
            const set = Object.keys(cols).map((c) => `${c} = ?`);
            await conn.query(`UPDATE documents SET ${set.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [
              ...Object.values(cols),
              id,
            ]);
          }
        }
        await conn.commit();
      } catch (err) {
        await conn.rollback();
        throw err;
      } finally {
        conn.release();
      }
      return this.getById(id);
    },
    /** @param {{ status?: string, from?: string, to?: string, category?: string }} filters 일자 내림차순 */
    async list({ status, from, to, category } = {}) {
      const where = ['doc_type = ?'];
      const params = [docType];
      if (status) (where.push('status = ?'), params.push(status));
      if (category) (where.push('category = ?'), params.push(category));
      if (from) (where.push('doc_date >= ?'), params.push(from));
      if (to) (where.push('doc_date <= ?'), params.push(to));
      const [rows] = await pool.query(
        `SELECT * FROM documents WHERE ${where.join(' AND ')} ORDER BY doc_date DESC, id DESC`,
        params,
      );
      return rows.map(fromRow);
    },
    /** 다른 레코드에 같은 해시가 있는지 */
    async hasDupHash(hash, excludeId = 0) {
      if (!hash) return false;
      const [rows] = await pool.query(
        'SELECT 1 FROM documents WHERE doc_type = ? AND dup_hash = ? AND id <> ? LIMIT 1',
        [docType, hash, excludeId],
      );
      return rows.length > 0;
    },
    /** documents 전체 행 수(문서 종류 무관). 데모 저장 한도 확인용 */
    async count() {
      const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM documents');
      return Number(n);
    },
    /** 이 종류의 최근 keep건(id 기준)만 남기고 삭제. 반환: 삭제한 행 수 */
    async pruneKeepLatest(keep) {
      const [rows] = await pool.query('SELECT id FROM documents WHERE doc_type = ? ORDER BY id DESC LIMIT 1 OFFSET ?', [
        docType,
        keep - 1,
      ]);
      if (!rows.length) return 0;
      const [info] = await pool.query('DELETE FROM documents WHERE doc_type = ? AND id < ?', [docType, rows[0].id]);
      return info.affectedRows;
    },
    async close() {
      await pool.end();
    },
  };
}
