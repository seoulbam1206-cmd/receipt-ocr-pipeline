// db/migrations/*.sql 을 이름 순서로 한 번씩 실행한다. 실행한 파일은 schema_migrations 에 기록한다.
// 사용: npm run db:migrate   (접속 정보는 web/.env)
// DB_MIGRATE_USER / DB_MIGRATE_PASSWORD 가 있으면 그 계정으로 접속한다(서버 계정은 CREATE 권한 없이 운영).
// 이미 모두 적용된 상태면 SELECT 만 하므로 CREATE 권한이 없는 계정으로 실행해도 통과한다.
import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { config } from '../src/config.js';
import { connectionOptions, setTimeZone } from '../src/db/repository.js';

const DIR = path.join(config.rootDir, 'db', 'migrations');

/** 파일을 문장 단위로 나눈다(줄 끝의 ; 기준). 주석만 있는 조각은 버린다 */
const statements = (sql) =>
  sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.replace(/--.*$/gm, '').trim());

const migrateUser = process.env.DB_MIGRATE_USER;
const conn = await mysql.createConnection(
  connectionOptions(migrateUser ? { ...config.db, user: migrateUser, password: process.env.DB_MIGRATE_PASSWORD || '' } : config.db),
);
try {
  // .env 의 DB_NAME 외의 DB에는 손대지 않는다
  const [[{ db }]] = await conn.query('SELECT DATABASE() AS db');
  if (db !== config.db.database) throw new Error(`접속한 DB(${db})가 DB_NAME(${config.db.database})과 다릅니다`);
  await setTimeZone(conn, config.db.timeZone);

  // 표가 있으면 CREATE 문을 보내지 않는다(IF NOT EXISTS 여도 CREATE 권한을 검사하므로)
  const [exists] = await conn.query("SHOW TABLES LIKE 'schema_migrations'");
  if (!exists.length) {
    await conn.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    VARCHAR(100) PRIMARY KEY,
         applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
       ) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci`,
    );
  }
  const [rows] = await conn.query('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.version));
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    // MySQL DDL은 트랜잭션으로 되돌릴 수 없어, 파일 하나가 끝날 때마다 기록한다
    for (const stmt of statements(await readFile(path.join(DIR, file), 'utf8'))) await conn.query(stmt);
    await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
    console.log(`[migrate] 적용: ${file}`);
    count++;
  }
  console.log(`[migrate] ${db}: ${count ? `${count}개 적용` : '새로 적용할 파일 없음'} (전체 ${files.length}개)`);
} catch (err) {
  console.error(`[migrate] 실패: ${err.message}`);
  process.exitCode = 1;
} finally {
  await conn.end();
}
