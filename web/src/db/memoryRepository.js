import { DOC_FIELDS, toDocumentRow, toColumns, pickFields, fromRow } from './repository.js';

const pad = (n) => String(n).padStart(2, '0');
const nowText = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/**
 * 테스트용 메모리 저장소. createRepository(MySQL)와 같은 인터페이스·같은 행 변환을 쓴다.
 * 행은 documents 열 형태로 보관해 MySQL 저장소와 결과가 같게 한다.
 */
export function createMemoryRepository({ docType = 'receipt' } = {}) {
  if (!DOC_FIELDS[docType]) throw new Error(`알 수 없는 문서 종류: ${docType}`);
  const rows = [];
  let seq = 0;
  const find = (id) => rows.find((r) => r.id === id && r.doc_type === docType);

  return {
    docType,
    async ping() {},
    async insert(rec) {
      const row = { id: ++seq, ...toDocumentRow(rec, docType), created_at: nowText(), updated_at: null };
      rows.push(row);
      return fromRow({ ...row });
    },
    async getById(id) {
      const row = find(id);
      return row ? fromRow({ ...row }) : null;
    },
    async update(id, rec) {
      const row = find(id);
      if (!row) return null;
      const cols = toColumns(rec);
      const fields = pickFields(rec, docType);
      if (Object.keys(fields).length) cols.fields_json = JSON.stringify({ ...JSON.parse(row.fields_json), ...fields });
      if (Object.keys(cols).length) Object.assign(row, cols, { updated_at: nowText() });
      return fromRow({ ...row });
    },
    async list({ status, from, to, category } = {}) {
      return rows
        .filter(
          (r) =>
            r.doc_type === docType &&
            (!status || r.status === status) &&
            (!category || r.category === category) &&
            (!from || (r.doc_date != null && r.doc_date >= from)) &&
            (!to || (r.doc_date != null && r.doc_date <= to)),
        )
        // MySQL ORDER BY doc_date DESC, id DESC 와 같게 (NULL 일자는 마지막)
        .sort((a, b) => (b.doc_date ?? '').localeCompare(a.doc_date ?? '') || b.id - a.id)
        .map((r) => fromRow({ ...r }));
    },
    async hasDupHash(hash, excludeId = 0) {
      return Boolean(hash && rows.some((r) => r.doc_type === docType && r.dup_hash === hash && r.id !== excludeId));
    },
    async count() {
      return rows.length;
    },
    async pruneKeepLatest(keep) {
      const ids = rows.filter((r) => r.doc_type === docType).map((r) => r.id).sort((a, b) => b - a);
      if (ids.length <= keep) return 0;
      const cutoff = ids[keep - 1];
      const before = rows.length;
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].doc_type === docType && rows[i].id < cutoff) rows.splice(i, 1);
      return before - rows.length;
    },
    async close() {},
  };
}
