"""OCR 서비스 (FastAPI).

  GET  /health  → { ok, engine, peakRssMb }
  POST /ocr     multipart 필드 image → { text, confidence, lines }

web(Node)의 OcrEngine 인터페이스(recognize(buffer) → { text, confidence })를 HTTP로 구현한다.
"""

from contextlib import asynccontextmanager

import psutil
from fastapi import FastAPI, File, HTTPException, UploadFile

from . import config
from .engine import ImageDecodeError, PaddleEngine


def _peak_rss_mb() -> float:
    m = psutil.Process().memory_info()
    # Windows는 peak_wset(최대 작업 집합), 그 외는 현재 RSS
    return round(getattr(m, "peak_wset", m.rss) / 2**20, 1)


def create_app(engine=None, preload: bool = True) -> FastAPI:
    engine = engine or PaddleEngine()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if preload:
            engine.load()  # 첫 요청이 모델 로딩 시간을 떠안지 않게 기동 시 로드
        yield

    app = FastAPI(title="ai-ocr-pipeline ocr-service", lifespan=lifespan)

    @app.get("/health")
    def health():
        return {"ok": engine.ready, "engine": engine.name, "peakRssMb": _peak_rss_mb()}

    # 동기 함수: FastAPI가 스레드풀에서 실행해 이벤트 루프를 막지 않는다
    @app.post("/ocr")
    def ocr(image: UploadFile = File(...)):
        data = image.file.read(config.MAX_UPLOAD_BYTES + 1)
        if len(data) > config.MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"이미지는 {config.MAX_UPLOAD_BYTES // 2**20}MB 이하여야 합니다")
        try:
            return engine.recognize(data)
        except ImageDecodeError as e:
            raise HTTPException(422, str(e)) from e

    return app


app = create_app()
