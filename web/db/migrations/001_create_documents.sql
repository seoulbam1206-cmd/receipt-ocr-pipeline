-- 문서 저장 테이블. MySQL 8.0 / TiDB 공통 문법만 쓴다(트리거·프로시저·외래키 없음)
-- 공통 값은 열로, 문서 종류별 값은 fields_json 에 둔다
CREATE TABLE documents (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  doc_type       VARCHAR(32)  NOT NULL,             -- 'receipt' (나중에 'expense_report' 등)
  status         VARCHAR(20)  NOT NULL,             -- CONFIRMED | REVIEW_REQUIRED
  confidence     DECIMAL(4,3),
  ocr_confidence DECIMAL(5,4),
  issues         JSON         NOT NULL,             -- [{code, message}]
  fields_json    JSON         NOT NULL,             -- 문서 종류별 필드 (src/db/repository.js DOC_FIELDS)
  doc_date       DATE,                              -- 목록 필터·정렬용 (영수증의 date)
  category       VARCHAR(20),                       -- 목록 필터용 (계정과목)
  duplicate      TINYINT(1)   NOT NULL DEFAULT 0,
  dup_hash       CHAR(64),
  raw_text       MEDIUMTEXT,                        -- 카드번호는 마스킹된 원문
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_type_date (doc_type, doc_date),
  KEY idx_type_dup  (doc_type, dup_hash),
  KEY idx_status    (status)
) DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
