---
title: AI OCR Pipeline
emoji: 🧾
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: 영수증 OCR → 필드 추출 → 검증 데모 (가상 샘플 전용)
---

# AI OCR Pipeline — 영수증 자동 입력·검증

<table>
  <tr>
    <td valign="top"><img src="docs/screenshots/desktop.png" alt="PC 화면: 원본 영수증과 추출 결과를 나란히 보여 주는 데모" width="640"></td>
    <td valign="top"><img src="docs/screenshots/mobile.png" alt="모바일 화면: 결과가 세로로 쌓이고 처리 내역이 카드로 바뀜" width="200"></td>
  </tr>
  <tr>
    <td align="center">PC (1280px) · 카페 샘플 → 확정</td>
    <td align="center">모바일 (390px) · 편의점 샘플 → 검토 필요</td>
  </tr>
</table>

- **데모**: 배포 후 추가 (Hugging Face Spaces 무료 CPU, 가상 샘플 5장만 처리. [배포 방법](#5-5-hugging-face-spaces에-배포-무료))
- 중복 감지: 같은 영수증(가맹점·일자·합계가 같음)을 다시 올리면 `DUPLICATE` 이슈와 함께 `REVIEW_REQUIRED`로 분류됩니다.
- 샘플 이미지는 `samples/`(원본, 벤치마크용)와 `web/public/samples/`(데모 화면의 "샘플로 바로 테스트"용 복사본) 두 곳에 있습니다. `npm run make-samples`로 다시 만들면 `web/public/samples/`에도 복사해 주세요.

영수증 이미지를 올리면 **전처리 → OCR → 필드 추출 → 검증 → 계정과목 분류 → 저장**까지 자동으로 처리하고, 확신이 없는 건만 `REVIEW_REQUIRED`로 골라 사람이 검토한 뒤 지출결의서용 CSV로 내보냅니다.

- **web** (Node.js / Express): 업로드 API, 파싱·검증 파이프라인, MySQL 저장, 검토 화면, CSV 내보내기
- **ocr-service** (Python / FastAPI): PaddleOCR 기반 OCR 엔진 서비스
- OCR 엔진은 환경 변수 하나(`OCR_ENGINE`)로 바꿀 수 있습니다. Python 없이 Node만으로도 실행됩니다(tesseract.js).

| 가상 샘플 5장 기준 | 가맹점 | 일자 | 합계 | 처리시간 | 최대 메모리 |
|---|---|---|---|---|---|
| tesseract.js (Node 내장) | 5/5 | 5/5 | 5/5 | 0.3초/건 | 128MB |
| **PaddleOCR (ocr-service)** | 5/5 | 5/5 | **5/5** | 4.7초/건 | 477MB (+ Node 66MB) |

> 측정 조건과 한계는 [벤치마크](#7-벤치마크)를 참고하세요. 샘플이 5장뿐이라 일반적인 인식률을 나타내는 수치는 아닙니다.

## 구현 현황

✅ 구현됨 · 🗓 예정 (예정 항목은 아직 코드가 없습니다)

| 영역 | 기능 | 상태 |
|---|---|---|
| 입력 | 영수증 이미지 업로드 (jpg/png/webp, 5MB) | ✅ |
| 입력 | 지출결의서 문서 OCR (입력 문서로 읽기) | 🗓 |
| OCR | tesseract.js (Node 단독 실행) / PaddleOCR (Python 서비스) 전환 | ✅ |
| 처리 | 전처리 → 필드 추출 → 검증 → 계정과목 분류 | ✅ |
| 처리 | 확신 없는 건만 `REVIEW_REQUIRED`로 분류 (신뢰도·필수 필드·중복·합계 근거) | ✅ |
| 처리 | 문서 종류별 처리 구조 (영수증 / 지출결의서 / 세금계산서) | 🗓 |
| 처리 | 표 형태 문서의 품목·수량·금액 열 복원 | 🗓 |
| 출력 | 검토 화면, 수정 후 재검증 | ✅ |
| 저장 | MySQL 8.0 `documents` 테이블 (`doc_type` + `fields_json`), 마이그레이션 스크립트, 예전 SQLite 데이터 이전 | ✅ |
| 저장 | TiDB Cloud(무료) 전환: 환경 변수만 바꾸도록 구성 (호환 문법·TLS 옵션). 실제 TiDB 연결은 아직 검증 안 함 | 🗓 |
| 출력 | 지출결의서용 CSV 내보내기 | ✅ |
| 출력 | 지출결의서 xlsx 양식 직접 출력 | 🗓 |
| 품질 | 단위·API 테스트 (Node 61개 + MySQL 연결 테스트, Python 9개), 가상 샘플 벤치마크 | ✅ |
| 운영 | Docker 단일 컨테이너(web + ocr-service), Hugging Face Spaces 배포 준비 | ✅ |
| 운영 | 공개 데모 제한: 데모 모드(원문 미저장·최근 50건·저장 한도 200건), 업로드 차단, IP당 요청 제한 | ✅ |
| 운영 | 실제 배포 (데모 링크) | 🗓 |
| 운영 | CI (GitHub Actions), docker compose | 🗓 |
| 운영 | 인증·다중 사용자 | 🗓 |

## 1. 문제 정의

총무·경리 담당자는 매달 수십~수백 장의 종이/사진 영수증을 손으로 옮겨 적어 지출결의서를 만듭니다.

- **반복 입력**: 가맹점, 일자, 공급가액, 부가세, 합계를 영수증마다 엑셀에 다시 타이핑합니다.
- **검증 누락**: 합계 불일치, 잘못된 사업자번호, 중복 제출된 영수증을 사람이 눈으로 찾아야 합니다.
- **분류 편차**: 같은 지출도 담당자에 따라 식대·접대비 등 계정과목이 다르게 들어갑니다.
- **개인정보 위험**: 카드번호가 찍힌 원본 이미지가 공유 폴더와 메일에 오래 남습니다.

이 프로젝트는 입력을 자동화하고, **확신이 없는 건만 골라내** 사람이 그 건만 확인하게 만드는 것을 목표로 합니다.

## 2. 시스템 구성

```mermaid
flowchart LR
    U[브라우저<br/>web/public/index.html] -- "POST /api/receipts<br/>(multipart image)" --> W

    subgraph W["web (Node.js · Express)"]
        direction TB
        M[multer 업로드<br/>5MB · jpg/png/webp] --> P1[① 전처리<br/>sharp]
        P1 --> E{② OcrEngine<br/>OCR_ENGINE}
        E -- tesseract --> T[tesseract.js<br/>WASM · kor+eng]
        E -- paddle --> H[HTTP 어댑터]
        T --> P3[③ 파서<br/>정규식 필드 추출]
        H --> P3
        P3 --> P4[④ 검증<br/>합계식·체크섬·날짜·중복]
        P4 --> P5[⑤ 계정과목 분류<br/>키워드 사전]
        P5 --> DB[(MySQL 8.0<br/>documents)]
        DB --> CSV[CSV 내보내기]
    end

    H -- "POST /ocr" --> S
    subgraph S["ocr-service (Python · FastAPI)"]
        direction TB
        PO[PaddleOCR<br/>PP-OCRv5 mobile] --> L[박스 → 줄 복원<br/>layout.py]
    end

    CSV -. 예정 .-> X[지출결의서 xlsx 양식]
```

| 단계 | 위치 | 내용 |
|---|---|---|
| ① 전처리 | [web/src/services/preprocess.js](web/src/services/preprocess.js) | EXIF 회전 → 긴 변 ≤1800px → grayscale → normalize → sharpen → (선택) 이진화 |
| ② OCR | [web/src/services/ocrService.js](web/src/services/ocrService.js) | 순차 큐(동시 1건)로 엔진 호출. `tesseract` 또는 `paddle`(HTTP) |
| ② OCR (Python) | [ocr-service/app/](ocr-service/app/) | PaddleOCR 추론 후, 같은 줄의 박스(`합계` / `14,000`)를 좌표로 묶어 줄 단위 텍스트로 복원 |
| ③ 파싱 | [web/src/services/parser.js](web/src/services/parser.js) | O→0, l/I→1, S→5 보정, 날짜·시간 붙음 분리, 가맹점·사업자번호·일자·금액·결제수단 추출, 카드번호 마스킹 |
| ④ 검증 | [web/src/services/validator.js](web/src/services/validator.js) | 합계식, 사업자번호 체크섬, 날짜 범위, 필수 필드, 중복 → 신뢰도·상태 |
| ⑤ 분류 | [web/src/services/categorizer.js](web/src/services/categorizer.js) | 가맹점명·본문 키워드 점수로 계정과목 결정 |
| 저장/출력 | [web/src/db/repository.js](web/src/db/repository.js), [exporter.js](web/src/services/exporter.js) | MySQL 저장(mysql2 풀), 검토 후 수정(PATCH), CSV(UTF-8 BOM) |

### 왜 Python 서비스를 분리했나

- 한국어 인식에 강한 OCR 모델(PaddleOCR)과 이미지 처리(OpenCV) 생태계가 Python 쪽에 있습니다.
- OCR은 메모리를 많이 쓰고 느리므로, 웹 서버와 프로세스를 분리해 두면 따로 재시작·확장할 수 있습니다.
- 두 레이어는 `recognize(image) → { text, confidence }` 계약 하나로만 연결됩니다. Node 쪽은 엔진이 바뀌어도 파서·검증 코드를 고치지 않습니다.

### 확장 구조 (실제 구현 범위)

- **OCR 엔진**: `OcrEngine` 인터페이스(`init / recognize / terminate`)와 어댑터 2개(`createTesseractEngine`, `createHttpEngine`)가 구현되어 있고, `createEngine(name)`이 환경 변수로 하나를 고릅니다. 새 엔진(예: 클라우드 OCR)은 어댑터 하나를 추가하면 됩니다.
- **문서 종류**: 현재는 **영수증 한 종류**만 처리합니다. 문서 종류별로 파서·검증 규칙을 바꾸는 구조는 아직 없습니다([로드맵](#9-한계와-로드맵) 참고). 저장 쪽은 먼저 준비해 두었습니다: `documents` 테이블은 `doc_type`으로 문서 종류를 나누고, 종류별 필드는 `fields_json`(JSON)에 둡니다. 목록 필터에 쓰는 일자·계정과목만 일반 열(`doc_date`, `category`)로 뺐습니다.

## 3. 영수증 처리 규칙

| 항목 | 규칙 |
|---|---|
| 합계 선택 | 키워드 줄 우선. `결제금액/승인금액/받을금액/청구금액` > `합계/총액/합계금액/TOTAL`(`총`→`종` 오인식 허용). 같은 등급이 여러 개면 가장 큰 금액. 결제금액 줄의 형식이 깨졌으면 `합계 − 할인`과 숫자가 일치할 때 계산값을 씀. 키워드가 없으면 번호류 줄(승인번호·전화 등)과 현금·받은금액·거스름돈 줄을 뺀 전체에서 가장 큰 금액 |
| 금액 검증 | `공급가액 + 부가세 = 합계` (±1원 허용). 둘 중 하나라도 없으면 건너뜀 |
| 사업자번호 | 가중치 `1,3,7,1,3,7,1,3,5` 체크섬 |
| 날짜 | 미래 날짜 불가, 5년 이내 |
| 신뢰도 | `confidence = OCR 신뢰도 × 0.4 + 검증 통과율 × 0.6` |
| 합계 근거 | 합계 키워드를 못 찾아 가장 큰 금액으로 추정했거나, 키워드 줄의 금액 형식이 깨졌는데 `합계 − 할인`으로도 맞지 않으면(`22.5002` 등) `TOTAL_UNCERTAIN` |
| 상태 | `confidence < 0.75`, 필수 필드(가맹점·일자·합계) 누락, 중복, `TOTAL_UNCERTAIN` 중 하나면 `REVIEW_REQUIRED`, 아니면 `CONFIRMED` |
| 중복 | `sha256(공백 제거·소문자 가맹점 \| 일자 \| 합계)`가 DB에 이미 있으면 `duplicate=true` |
| 계정과목 | `식대 · 교통비 · 사무용품 · 접대비 · 통신비 · 기타`. 키워드는 [categorizer.js](web/src/services/categorizer.js) 상단 사전에서 수정 |

**개인정보 처리**
- 업로드한 원본 이미지는 처리가 끝나면 성공·실패와 관계없이 바로 삭제합니다(`finally`에서 `unlink`).
- 카드번호는 끝 4자리(`card_last4`)만 저장합니다. DB에 저장하는 OCR 원문에서도 카드번호는 끝 4자리만 남기고 `*`로 바꿉니다.
- 저장소의 샘플 이미지와 테스트 데이터는 모두 가상 값입니다(아래 [샘플](#6-입출력-예시) 참고).

## 4. 기술 스택

| 영역 | 사용 기술 |
|---|---|
| web | Node.js 22+, Express 5, multer, zod 4, sharp, tesseract.js 7, mysql2, dotenv |
| DB | MySQL 8.0 (TiDB Cloud 호환 문법). better-sqlite3는 예전 데이터 이전 스크립트에서만 사용(devDependency) |
| ocr-service | Python 3.12, FastAPI, uvicorn, PaddleOCR 3.7 (PP-OCRv5 mobile det + korean rec), paddlepaddle 3.3 (CPU), OpenCV, psutil |
| 테스트 | `node:test` (단위·API 61개, MySQL 연결 10개), pytest (9개) |
| 배포 | Docker (Hugging Face Spaces, 무료 CPU), TiDB Cloud Starter (무료) |
| 프론트엔드 | 단일 HTML + vanilla JS (빌드 없음) |

```
ai-ocr-pipeline/
├─ web/                    Node.js 웹/API 레이어
│  ├─ src/
│  │  ├─ server.js         진입점 (엔진 선택, 기동)
│  │  ├─ app.js            Express 조립
│  │  ├─ rateLimit.js      IP당 요청 제한
│  │  ├─ config.js         환경 변수
│  │  ├─ routes/           REST API
│  │  ├─ services/         preprocess · ocrService · parser · validator · categorizer · exporter · pipeline
│  │  └─ db/               repository(MySQL) · memoryRepository(테스트용)
│  ├─ db/migrations/       테이블 생성 SQL
│  ├─ public/index.html    검토 화면
│  ├─ scripts/             migrate.js, import-sqlite.js, benchmark.js, make-samples.js
│  └─ tests/
├─ docker/start.sh        컨테이너 시작 순서 (ocr-service → 마이그레이션 → web)
├─ Dockerfile              Hugging Face Spaces용 단일 이미지
├─ ocr-service/            Python OCR 서비스
│  ├─ app/                 main.py(FastAPI) · engine.py(PaddleOCR) · layout.py(줄 복원) · config.py
│  └─ tests/
└─ samples/                가상 영수증 이미지 + 정답 JSON
```

## 5. 설치 및 실행 (Windows / PowerShell)

필요 환경: **Node.js 22 이상**, **MySQL 8.0**, (PaddleOCR 사용 시) **Python 3.12**

> **주의**: 저장소를 **한글 등 비ASCII 문자가 없는 경로**에 두세요(예: `D:\projects\ai-ocr-pipeline`). PaddleOCR의 C++ 추론기는 비ASCII 경로의 모델 파일을 열지 못합니다. 모델 캐시는 사용자 폴더 대신 `ocr-service\.paddlex`에 저장하도록 되어 있어서 Windows 사용자명이 한글이어도 괜찮습니다.

### 5-0. MySQL 준비

이 프로젝트 전용 DB와 계정을 하나 만들고, 그 DB에만 권한을 줍니다(MySQL 관리자 계정으로 실행).

```sql
CREATE DATABASE ocr_pipeline CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'ocr_user'@'%' IDENTIFIED BY '<비밀번호>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX ON ocr_pipeline.* TO 'ocr_user'@'%';
```

### 5-1. web (Node.js) — Python 없이도 실행됩니다

```powershell
cd web
npm ci

# tesseract.js 언어 파일 (약 6MB, 처음 한 번). tessdata 폴더는 저장소에 없으니 먼저 만든다
New-Item -ItemType Directory -Force tessdata | Out-Null
Invoke-WebRequest -Uri https://github.com/tesseract-ocr/tessdata_fast/raw/main/kor.traineddata -OutFile tessdata\kor.traineddata
Invoke-WebRequest -Uri https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata -OutFile tessdata\eng.traineddata

copy .env.example .env   # DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD 를 채운다
npm run db:migrate       # documents 테이블 생성 (처음 한 번, 여러 번 실행해도 안전)
npm start                # http://localhost:3000
```

- DB에 연결하지 못하면 서버는 이유와 확인할 항목을 출력하고 종료합니다.
- `web/.npmrc`에 `ignore-scripts=true`가 들어 있습니다. better-sqlite3(데이터 이전용 개발 의존성)는 Windows용 바이너리를 패키지에 포함하는데, npm 11이 소스 빌드(node-gyp)를 시도해 Visual Studio가 없는 PC에서 설치가 실패하기 때문입니다.
- `npm run dev`(자동 재시작), `npm test`, `npm run test:db`, `npm run benchmark`, `npm run make-samples`

**예전 SQLite 데이터 옮기기** (SQLite를 쓰던 버전에서 업그레이드할 때만)

```powershell
npm run db:import-sqlite                       # 기본: web/data/receipts.db
npm run db:import-sqlite -- D:\backup\old.db   # 다른 파일
```

SQLite 파일은 읽기만 하고 지우지 않습니다. 한 트랜잭션으로 넣고, 이미 옮긴 행(종류·생성 시각·원문이 같은 행)은 건너뛰므로 다시 실행해도 됩니다.

### 5-2. ocr-service (Python, PaddleOCR) — 선택

```powershell
cd ocr-service
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt      # 약 900MB

# 첫 기동 때 PP-OCRv5 mobile 모델(약 20MB)을 ocr-service\.paddlex 에 내려받습니다
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
# 확인: http://127.0.0.1:8000/health → {"ok": true, ...}
```

테스트: `.venv\Scripts\python -m pip install -r requirements-dev.txt` 후 `.venv\Scripts\python -m pytest`

### 5-3. web을 PaddleOCR로 연결

ocr-service를 띄운 상태에서 `web\.env`에 `OCR_ENGINE=paddle`을 넣거나, 실행할 때 지정합니다.

```powershell
cd web
$env:OCR_ENGINE='paddle'; npm start
```

| 변수 (web) | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | 포트 |
| `OCR_ENGINE` | `tesseract` | `tesseract` \| `paddle` |
| `OCR_SERVICE_URL` | `http://127.0.0.1:8000` | ocr-service 주소 |
| `OCR_SERVICE_TIMEOUT_MS` | `60000` | ocr-service 요청 제한 시간(ms) |
| `OCR_CONFIDENCE_THRESHOLD` | `0.75` | 검토 필요 판정 임계값 |
| `OCR_THRESHOLD` | (off) | `on`이면 전처리에 이진화 적용 |
| `DB_HOST` | `127.0.0.1` | MySQL 주소 |
| `DB_PORT` | `3306` | MySQL 포트 (`.env.example`은 3307) |
| `DB_NAME` | `ocr_pipeline` | 사용할 DB. 이 DB 하나만 사용합니다 |
| `DB_USER` / `DB_PASSWORD` | (없음) | 계정. 비밀번호는 `.env`에만 씁니다 |
| `DB_SSL` | `false` | 암호화 연결(TLS 1.2+, 인증서 검증). TiDB Cloud는 `true` |
| `DB_TIMEZONE` | `+09:00` | 세션 시간대 (`created_at` 기준) |
| `DB_CONNECTION_LIMIT` | `5` | 커넥션 풀 크기 |
| `DB_MIGRATE_USER` / `DB_MIGRATE_PASSWORD` | (없음) | 마이그레이션만 다른 계정으로 실행할 때 |
| `DEMO_MODE` | `false` | `true`면 OCR 원문 미저장, 최근 `DEMO_KEEP_LATEST`건만 유지, `DEMO_MAX_ROWS`건 이상이면 저장 거부 |
| `DEMO_KEEP_LATEST` / `DEMO_MAX_ROWS` | `50` / `200` | 데모 모드의 보관 건수 / 저장 한도(documents 전체 행 수) |
| `DEMO_UPLOAD` | `true` | `false`면 파일 업로드 차단, 화면의 샘플만 처리 |
| `RATE_LIMIT_API_PER_MIN` / `RATE_LIMIT_OCR_PER_MIN` | 끔 (데모 모드면 `120` / `10`) | IP당 1분 요청 수. `0`이면 끔 |
| `TRUST_PROXY` | `false` | 프록시 뒤에서 실제 사용자 IP를 쓸 때 프록시 단계 수(Spaces는 `1`) |

ocr-service 변수는 [ocr-service/.env.example](ocr-service/.env.example)에 있습니다.

### 5-4. 클라우드 DB(TiDB Cloud 무료)로 옮기기

코드는 MySQL 8.0과 TiDB에서 모두 되는 문법만 씁니다(트리거·프로시저·외래키 없음). `web\.env`의 값만 바꾸면 됩니다.

```
DB_HOST=gateway01.<region>.prod.aws.tidbcloud.com
DB_PORT=4000
DB_USER=<prefix>.root
DB_PASSWORD=<비밀번호>
DB_NAME=ocr_pipeline
DB_SSL=true
```

그다음 `npm run db:migrate`로 테이블을 만듭니다. 값은 TiDB Cloud 콘솔의 Connect 화면에 나옵니다. TiDB Cloud는 암호화 연결이 필수라 `DB_SSL=true`가 필요합니다. 아직 실제 TiDB Cloud 연결은 검증하지 않았습니다.

### 5-5. Hugging Face Spaces에 배포 (무료)

저장소 루트의 `Dockerfile` 하나로 web(Node)과 ocr-service(PaddleOCR)가 한 컨테이너에서 같이 돕니다. README 맨 위의 설정 블록(`sdk: docker`, `app_port: 7860`)은 Space가 읽는 설정이고, GitHub에서는 작은 표로 보입니다.

**비용**: Hugging Face 무료 CPU(CPU basic)와 TiDB Cloud Starter(무료) 모두 카드 등록 없이 쓸 수 있습니다. Space 설정에서 하드웨어 업그레이드나 Persistent storage를 켜면 유료가 되니 켜지 마세요. TiDB는 Spending limit을 0으로 두면 무료 한도 안에서만 동작합니다.

**컨테이너 기본값** (`Dockerfile`의 `ENV`. Space의 Variables로 바꿀 수 있음)

| 변수 | 값 |
|---|---|
| `PORT` | `7860` |
| `OCR_ENGINE` | `paddle` (tessdata도 들어 있어 `tesseract`로 바꿔도 동작) |
| `DEMO_MODE` / `DEMO_UPLOAD` | `true` / `false` |
| `TRUST_PROXY` | `1` |
| `DB_PORT` / `DB_NAME` / `DB_SSL` | `4000` / `ocr_pipeline` / `true` |

**Secrets에 넣을 값** (이미지와 코드에는 넣지 않음)

| 이름 | 값 |
|---|---|
| `DB_HOST` | TiDB Connect 화면의 Host (`gateway01.<region>.prod.aws.tidbcloud.com`) |
| `DB_USER` | 서버용 계정 (아래 권한 참고, 예: `<prefix>.ocr_app`) |
| `DB_PASSWORD` | 그 계정의 비밀번호 |
| `DB_MIGRATE_USER` / `DB_MIGRATE_PASSWORD` | (선택) 컨테이너에서 새 마이그레이션까지 적용하고 싶을 때만 |

**DB 계정 최소 권한**

| 용도 | 필요한 권한 | 이유 |
|---|---|---|
| 서버 실행 | `documents`에 `SELECT, INSERT, UPDATE, DELETE` | 조회·저장·수정, 데모 모드에서 오래된 행 삭제(데모 모드가 아니면 `DELETE`는 필요 없음) |
| 시작할 때 자동 마이그레이션 (적용할 파일이 없을 때) | `schema_migrations`에 `SELECT` | 이미 적용된 파일만 확인하고 끝남. CREATE 문을 보내지 않음 |
| 마이그레이션 적용 | DB 전체에 `CREATE, SELECT, INSERT` (나중에 열·인덱스를 바꾸는 파일이 생기면 `ALTER, INDEX`도) | 테이블 생성, `schema_migrations` 기록 |

`SELECT, INSERT, UPDATE, DELETE`만으로 서버는 동작합니다. 하지만 테이블을 처음 만들 때는 `CREATE`가 필요합니다. 그래서 **처음 한 번은 PC에서 관리자(`<prefix>.root`) 계정으로 마이그레이션**하고, Space에는 권한이 적은 서버용 계정만 넣습니다.

**잠들었다 깨어날 때**: 무료 Space는 48시간 동안 방문이 없으면 잠들고, 다음 방문 때 컨테이너가 처음부터 다시 시작합니다. `docker/start.sh`는 이 순서로 시작합니다.

1. ocr-service를 띄웁니다. PaddleOCR 모델은 빌드 때 받아 두었으므로 깨어날 때 다운로드하지 않습니다.
2. 그동안 마이그레이션을 실행합니다. TiDB가 깨어나는 중이라 실패하면 최대 5번 다시 시도합니다(약 45초).
3. ocr-service 준비(`/health`가 `ok: true`)를 확인한 뒤 web을 7860 포트로 엽니다. 포트가 열리기 전까지 Space는 "Starting" 화면을 보여 주므로, 준비되지 않은 OCR로 요청이 가지 않습니다.

PC(i7-1165G7, 모델 캐시 있음)에서 이 스크립트를 실행하니 web이 열리기까지 32초, 첫 OCR 8.5초, 이후 건당 3~5초가 걸렸습니다. Space에서는 다를 수 있습니다. DB 커넥션 풀은 TCP keepalive를 켜고 쉬는 연결을 1분 뒤 닫아, 오래 쉰 뒤 끊긴 연결을 다시 쓰지 않게 했습니다. `GET /api/health`는 요청 제한 없이 응답하고, Docker `HEALTHCHECK`도 이 주소를 씁니다(시작 유예 180초).

**로컬 Docker 테스트를 건너뛸 때** (RAM 8GB에서 Docker Desktop이 무거운 경우)

- 컨테이너가 하는 일을 PC에서 그대로 실행해 확인합니다. Git Bash에서:
  ```bash
  export PATH="$PWD/ocr-service/.venv/Scripts:$PATH" PORT=7860 OCR_ENGINE=paddle DEMO_MODE=true DEMO_UPLOAD=false TRUST_PROXY=1
  bash docker/start.sh        # 로컬 MySQL(web/.env) 사용. 끝낼 때 node·python 프로세스도 종료
  ```
- 이미지 빌드는 Space에 올린 뒤 Space의 **Logs → Build** 탭에서 확인합니다(무료). 실패하면 그 로그를 보고 고칩니다.

#### 배포 순서 (직접 할 일)

1. **TiDB 테이블 만들기**: PC에서 한 번만 합니다. 값은 PowerShell 창에만 넣고 파일에는 쓰지 않습니다(이 창의 값이 `web\.env`보다 우선합니다).
   ```powershell
   cd web
   $env:DB_HOST='<Host>'; $env:DB_PORT='4000'; $env:DB_USER='<prefix>.root'; $env:DB_NAME='ocr_pipeline'; $env:DB_SSL='true'
   $s = Read-Host 'TiDB 비밀번호' -AsSecureString; $env:DB_PASSWORD = [System.Net.NetworkCredential]::new('', $s).Password
   npm run db:migrate
   ```
2. **서버용 계정 만들기**: TiDB 콘솔의 SQL Editor에서 실행합니다. 비밀번호는 콘솔에서 직접 정합니다.
   ```sql
   CREATE USER '<prefix>.ocr_app' IDENTIFIED BY '<새 비밀번호>';
   GRANT SELECT, INSERT, UPDATE, DELETE ON ocr_pipeline.documents TO '<prefix>.ocr_app';
   GRANT SELECT ON ocr_pipeline.schema_migrations TO '<prefix>.ocr_app';
   ```
3. **Space 만들기**: huggingface.co에 가입(무료)하고 **New Space**에서 이름을 정합니다. License `MIT`, SDK `Docker` → `Blank`, Hardware `CPU basic · Free`, Public을 고릅니다.
4. **Secrets 넣기**: Space의 **Settings → Variables and secrets → New secret**에서 `DB_HOST`, `DB_USER`(`<prefix>.ocr_app`), `DB_PASSWORD`를 넣습니다.
5. **파일 올리기**: 커밋된 파일만 올라가도록 깨끗한 복사본을 만든 뒤 업로드합니다. 토큰은 huggingface.co **Settings → Access Tokens**에서 Write 권한으로 만들고, 로그인할 때 붙여 넣습니다.
   ```powershell
   pip install -U huggingface_hub
   hf auth login
   git clone D:\myproject\ai-ocr-pipeline $env:TEMP\ocr-space
   hf upload <사용자명>/<Space 이름> $env:TEMP\ocr-space . --repo-type space --exclude ".git/*"
   ```
6. **빌드 확인**: Space의 **Logs**에서 빌드가 끝나고(처음에는 10~20분 정도) `[server] http://localhost:7860`이 나오면 성공입니다. 실패하면 Build 로그를 확인합니다.
7. **동작 확인**: Space 화면에서 샘플 5장을 눌러 봅니다. 업로드 영역이 숨겨져 있고 "가짜 샘플만 사용하세요" 안내가 보여야 합니다.
8. **README에 링크 추가**: 위의 "데모: 배포 후 추가"를 Space 주소로 바꿉니다.

코드를 고친 뒤에는 커밋하고, 5번(복사본을 새로 clone)부터 다시 하면 Space가 다시 빌드됩니다.

## 6. 입출력 예시

[samples/](samples/)의 이미지는 [web/scripts/make-samples.js](web/scripts/make-samples.js)로 생성한 **가상 영수증**입니다. 상호·전화번호·카드번호는 가짜이고, 사업자번호는 체크섬만 맞춘 `999-` 대역의 가상 번호입니다. 4장에는 회전·블러·대비 저하·JPEG 압축을 넣어 사진으로 찍은 영수증을 흉내 냈습니다.

| 파일 | 특징 |
|---|---|
| `receipt01_cafe.png` | 공급가액/부가세/합계, 카드번호 마스킹 |
| `receipt02_stationery.jpg` | 슬래시 날짜, 할인 후 `결제금액` 우선, 1.5° 회전 |
| `receipt03_taxi.jpg` | 2자리 연도(`26.10.15`), `받을금액`, 블러 |
| `receipt04_restaurant.jpg` | `과세물품가액`, -2.5° 회전 + 블러 + 대비 저하 |
| `receipt05_convenience.jpg` | 한글 날짜(년월일), 현금, 거스름돈 함정 |

```powershell
curl.exe -F "image=@samples/receipt03_taxi.jpg" http://localhost:3000/api/receipts
```

입력 `samples/receipt03_taxi.jpg` → 출력 (`OCR_ENGINE=paddle`, `rawText` 생략):

```json
{
  "data": {
    "id": 1,
    "status": "CONFIRMED",
    "merchant": "가상운수 개인택시",
    "bizNo": "999-22-00003",
    "date": "2026-10-15",
    "time": "23:41",
    "totalAmount": 18300,
    "supplyAmount": null,
    "vat": null,
    "paymentMethod": "카드",
    "cardLast4": null,
    "category": "교통비",
    "confidence": 0.989,
    "ocrConfidence": 0.9716,
    "duplicate": false,
    "issues": [],
    "valid": true
  }
}
```

CSV 내보내기(`GET /api/receipts/export.csv`):

```csv
일자,가맹점,계정과목,공급가액,부가세,합계,상태
2026-10-15,가상운수 개인택시,교통비,,,18300,확정
```

### API

모든 에러 응답 형식: `{ "error": { "code": "...", "message": "...", "details": [...]? } }`

| 메서드 | 경로 | 설명 |
|---|---|---|
| `POST` | `/api/receipts` | multipart 필드 `image`. 처리 후 `201 { data: Receipt }` (`DEMO_UPLOAD=false`면 403) |
| `POST` | `/api/receipts/samples/:name` | 서버에 있는 샘플 이미지(`web/public/samples/`) 처리. 업로드가 꺼져도 동작 |
| `GET` | `/api/receipts?status=&from=&to=&category=` | 목록 (일자 내림차순) |
| `GET` | `/api/receipts/:id` | 상세 |
| `PATCH` | `/api/receipts/:id` | 수정 후 재검증. `confirm: true`면 필수 필드가 있을 때 `CONFIRMED`로 확정 |
| `GET` | `/api/receipts/export.csv?from=&to=` | 지출결의서 CSV (UTF-8 BOM) |
| `GET` | `/api/health` | 상태 및 OCR 대기 건수 (요청 제한 없음) |
| `GET` | `/api/config` | 화면용 설정 `{ demoMode, uploadEnabled }` |

에러 코드: `FILE_REQUIRED`(400), `INVALID_FILE_TYPE`(400), `FILE_TOO_LARGE`(413), `INVALID_IMAGE`(422), `VALIDATION_ERROR`(400), `UPLOAD_DISABLED`(403), `NOT_FOUND`·`SAMPLE_NOT_FOUND`(404), `DEMO_STORAGE_FULL`(409), `RATE_LIMITED`(429, `Retry-After`), `INTERNAL_ERROR`(500)
검증 이슈 코드: `MISSING_FIELDS`, `AMOUNT_MISMATCH`, `INVALID_BIZ_NO`, `FUTURE_DATE`, `DATE_TOO_OLD`, `DUPLICATE`, `TOTAL_UNCERTAIN`

ocr-service: `GET /health` → `{ ok, engine, peakRssMb }`, `POST /ocr`(multipart `image`) → `{ text, confidence, lines: [{ text, confidence, bbox }] }`

## 7. 벤치마크

```powershell
cd web
npm run make-samples                          # samples/ 재생성
npm run benchmark -- --engine tesseract       # 전처리 ON
npm run benchmark -- --engine paddle          # ocr-service 실행 중이어야 함
npm run benchmark -- --engine paddle --no-preprocess
```

측정 환경: Intel Core i7-1165G7, RAM 8GB, Windows 10, Node 24, Python 3.12, CPU만 사용

| 엔진 | 전처리 | 가맹점 | 일자 | 합계 | 평균 처리시간 | 최대 메모리 |
|---|---|---|---|---|---|---|
| tesseract.js | ON | 5/5 | 5/5 | 5/5 | 328ms | 128MB |
| tesseract.js | OFF | 5/5 | 5/5 | 5/5 | 291ms | 136MB |
| PaddleOCR | ON | 5/5 | 5/5 | 5/5 | 4,673ms | ocr-service 477MB + web 66MB |
| PaddleOCR | OFF | 5/5 | 5/5 | 5/5 | 3,825ms | ocr-service 477MB + web 62MB |

- tesseract.js는 처음에 합계 2건을 틀렸습니다. 할인 후 결제금액 22,500원 영수증을 `22`로, 거스름돈이 있는 편의점 영수증(총액 3,500원)을 `50001`로 추출했습니다.
  - 처음에는 이 2건이 신뢰도 0.94로 `CONFIRMED`가 됐습니다. 공급가액·부가세가 없는 영수증은 합계식 검증을 건너뛰기 때문입니다. 원인은 각각 `결제금액 = 22.5002)`(쉼표가 마침표로 깨짐)와 `총액`→`종액` 오인식(키워드 없음 → 가장 큰 숫자인 `500ml`→`50001` 선택)이었습니다. 먼저 합계 근거 검사(`TOTAL_UNCERTAIN`)를 추가해 두 건을 `REVIEW_REQUIRED`로 돌렸습니다.
  - 이어서 파서를 고쳐 두 건 모두 정답이 됐습니다. 깨진 결제금액은 `합계 24,500 − 할인 2,000 = 22,500`과 숫자가 일치하면 계산값을 쓰고(`reconciled`, 확정 가능), `종액`도 합계 키워드로 인식합니다. 키워드가 없을 때도 현금·거스름돈 줄은 후보에서 뺍니다. 지금은 5건 모두 `CONFIRMED`입니다. 처리시간·메모리 수치는 수정 전 측정값입니다.
- PaddleOCR는 정확하지만 CPU에서 건당 4~5초가 걸리고, 두 프로세스를 합쳐 tesseract.js보다 메모리를 4배 이상 씁니다. 그래서 기본값은 tesseract.js로 두고 PaddleOCR는 선택 사항으로 했습니다.
- PaddleOCR 연동 초기에는 일자 정확도가 3/5였습니다. 한 박스 안의 공백이 빠져 `2026-10-2712:34:56`처럼 날짜와 시간이 붙어 나왔기 때문입니다. 파서에 날짜·시간 분리 규칙(`splitDateTime`)을 추가해 5/5가 됐습니다.
- **한계**: 합성 이미지 5장이라 실제 영수증 사진(구김, 그림자, 감열지 변색) 성능을 대표하지 않습니다.

## 8. 테스트

```powershell
cd web; npm test                                  # 61개: 파서 fixture 9종, 검증, 전처리, OCR 큐/HTTP 어댑터, API, 데모 제한, DB 행 변환 (MySQL 불필요)
cd web; npm run test:db                           # MySQL 연결 10개: web/.env 의 DB 사용, 자기가 만든 행만 지움 (db:migrate 먼저)
cd ocr-service; .venv\Scripts\python -m pytest    # 9개: 줄 복원 로직, API (가짜 엔진)
```

## 9. 한계와 로드맵

**현재 한계**
- 문서 종류는 영수증 하나입니다. 지출결의서는 입력 문서가 아니라 CSV 출력 형식으로만 지원합니다.
- 파서는 줄 단위 정규식 규칙이라 품목·수량·금액이 열로 나뉜 표 형태 영수증에 약합니다.
- 기울기 보정(deskew)과 영수증 영역 자동 크롭이 없습니다.
- 계정과목 분류는 키워드 기반이라 식대와 접대비처럼 업종만으로 구분되지 않는 경우를 판단하지 못합니다.
- 중복 판정은 가맹점명 문자열에 의존하므로, OCR이 가맹점명을 다르게 읽으면 같은 영수증을 중복으로 잡지 못합니다.
- 인증·다중 사용자 기능이 없습니다. 공개 데모는 샘플만 처리하고 요청 수·저장 건수를 제한하는 방식으로 막아 둡니다.
- 요청 제한은 서버 메모리에서 세므로 서버 1대 기준이고, 재시작하면 초기화됩니다.

**로드맵**
1. **CI·로컬 컨테이너**: GitHub Actions로 테스트·이미지 빌드 확인, 로컬용 `docker compose`(MySQL 포함)
2. **문서별 처리 구조**: `DocumentProcessor { parse, validate, categorize }` 인터페이스로 영수증·세금계산서·거래명세서 등 문서 종류별 규칙 분리 (전략 패턴)
3. **ML 모델 추가 (ocr-service)**: 문서 종류 자동 분류, 금액·빈도 기반 이상 지출 탐지
4. **인식률 평가 지표**: 실제 영수증(비식별화) 평가셋 구축, 필드별 정확도·CER 자동 리포트
5. **레이아웃 분석**: ocr-service가 이미 돌려주는 줄 bbox(`lines`)로 표 영수증의 품목·수량·금액 열 복원
6. 전처리 강화(deskew, 적응형 이진화), 지출결의서 xlsx 양식 직접 출력

## 10. 라이선스

[MIT](LICENSE)
