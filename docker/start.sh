#!/usr/bin/env bash
# 컨테이너 시작 순서
#   1) ocr-service(PaddleOCR) 기동 — 모델 로딩에 수십 초가 걸려 먼저 띄운다
#   2) 그동안 DB 마이그레이션 (TiDB가 깨어나는 시간을 고려해 재시도)
#   3) ocr-service 준비 확인 후 web 기동 → 7860 포트가 열리면 Space가 "Running"이 된다
# 둘 중 하나라도 죽으면 컨테이너를 끝낸다(반쯤 살아 있는 상태로 두지 않음)
set -uo pipefail
cd "$(dirname "$0")/.."

log() { echo "[start] $*"; }
START=$SECONDS

(cd ocr-service && exec python -m uvicorn app.main:app --host 127.0.0.1 --port 8000) &
OCR_PID=$!
WEB_PID=
trap 'kill -TERM $OCR_PID $WEB_PID 2>/dev/null' TERM INT

for i in 1 2 3 4 5; do
  (cd web && node scripts/migrate.js) && break
  if [ "$i" = 5 ]; then
    log "DB 마이그레이션 실패. Secrets의 DB_HOST, DB_USER, DB_PASSWORD 를 확인하세요"
    kill $OCR_PID 2>/dev/null
    exit 1
  fi
  log "마이그레이션 재시도 ${i}/5 ($((i * 3))초 뒤)"
  sleep $((i * 3))
done

ocr_ready() {
  node -e "fetch('http://127.0.0.1:8000/health').then((r) => r.json()).then((j) => process.exit(j.ok ? 0 : 1), () => process.exit(1))"
}
TIMEOUT=${OCR_STARTUP_TIMEOUT:-300}
until ocr_ready; do
  if ! kill -0 $OCR_PID 2>/dev/null; then
    log "ocr-service가 시작 중에 종료됐습니다"
    exit 1
  fi
  if [ $((SECONDS - START)) -ge "$TIMEOUT" ]; then
    log "ocr-service가 ${TIMEOUT}초 안에 준비되지 않았습니다"
    kill $OCR_PID 2>/dev/null
    exit 1
  fi
  sleep 1
done
log "ocr-service 준비 ($((SECONDS - START))초)"

(cd web && exec node src/server.js) &
WEB_PID=$!

wait -n $OCR_PID $WEB_PID
CODE=$?
log "프로세스 하나가 종료됨(코드 ${CODE}). 컨테이너를 끝냅니다"
kill -TERM $OCR_PID $WEB_PID 2>/dev/null
wait
exit $CODE
