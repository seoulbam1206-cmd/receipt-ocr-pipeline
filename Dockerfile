# Hugging Face Spaces(Docker, 무료 CPU)용 단일 컨테이너: web(Node) + ocr-service(Python, PaddleOCR)
# 밖으로 여는 포트는 7860(web) 하나. ocr-service는 컨테이너 안 127.0.0.1:8000 에서만 받는다.
# 접속 정보(DB_HOST, DB_USER, DB_PASSWORD)는 이미지에 넣지 않고 Space의 Secrets로 받는다.

# ── 1) web 의존성 (Linux용 sharp 바이너리 포함) ─────────────────────
FROM node:22-bookworm-slim AS web-deps
WORKDIR /web
COPY web/package.json web/package-lock.json web/.npmrc ./
RUN npm ci --omit=dev

# ── 2) 실행 이미지 ──────────────────────────────────────────────────
FROM python:3.12-slim-bookworm

# OpenCV·Paddle 실행에 필요한 시스템 라이브러리
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 libsm6 libxext6 \
 && rm -rf /var/lib/apt/lists/*
# Node는 1단계 이미지의 실행 파일만 가져온다 (같은 Debian bookworm 기반)
COPY --from=web-deps /usr/local/bin/node /usr/local/bin/node

# Hugging Face Spaces는 UID 1000 사용자로 실행한다
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
RUN mkdir -p $HOME/app/web/tessdata $HOME/app/web/uploads
WORKDIR $HOME/app

# ocr-service: 패키지 설치 후 PaddleOCR 모델을 미리 받아 둔다 (깨어날 때 다운로드하지 않게)
COPY --chown=user ocr-service/requirements.txt ocr-service/
RUN pip install --user -r ocr-service/requirements.txt
COPY --chown=user ocr-service/app ocr-service/app
RUN cd ocr-service && python -c "from app.engine import PaddleEngine; PaddleEngine().load(); print('PaddleOCR 모델 준비 완료')"

# tesseract.js 언어 파일 (OCR_ENGINE=tesseract 로 바꿔도 바로 동작하게)
RUN python -c "import urllib.request as u; [u.urlretrieve(f'https://github.com/tesseract-ocr/tessdata_fast/raw/main/{l}.traineddata', f'web/tessdata/{l}.traineddata') for l in ('kor', 'eng')]"

# web
COPY --from=web-deps --chown=user /web/node_modules web/node_modules
COPY --chown=user web/package.json web/
COPY --chown=user web/src web/src
COPY --chown=user web/public web/public
COPY --chown=user web/db web/db
COPY --chown=user web/scripts/migrate.js web/scripts/
COPY --chown=user docker/start.sh docker/start.sh
# Windows에서 CRLF로 체크아웃됐어도 bash가 읽을 수 있게
RUN sed -i 's/\r$//' docker/start.sh

# 공개 데모 기본값. Space의 Variables로 덮어쓸 수 있다
ENV PORT=7860 \
    NODE_ENV=production \
    OCR_ENGINE=paddle \
    OCR_SERVICE_URL=http://127.0.0.1:8000 \
    OMP_NUM_THREADS=2 \
    DEMO_MODE=true \
    DEMO_UPLOAD=false \
    TRUST_PROXY=1 \
    DB_PORT=4000 \
    DB_NAME=ocr_pipeline \
    DB_SSL=true

EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s \
  CMD node -e "fetch('http://127.0.0.1:7860/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["bash", "docker/start.sh"]
