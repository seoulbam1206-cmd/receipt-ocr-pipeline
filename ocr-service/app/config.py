"""환경 변수 설정. paddleocr/paddlex를 import하기 전에 불러와야 캐시 경로가 적용된다."""

import os
from pathlib import Path

SERVICE_DIR = Path(__file__).resolve().parent.parent

# PaddleX는 기본으로 ~/.paddlex 에 모델을 받는데, Windows 사용자 폴더명에 한글 등 비ASCII 문자가 있으면
# C++ 추론기가 모델 파일을 열지 못한다(inference.json "parse error ... empty input").
# 그래서 기본 캐시를 서비스 폴더 안(.paddlex)으로 둔다. 이 경로도 ASCII여야 한다.
os.environ.setdefault("PADDLE_PDX_CACHE_HOME", str(SERVICE_DIR / ".paddlex"))
# 모델 호스트 접속 확인(수 초)을 건너뛴다. 모델이 없으면 첫 기동 때 그대로 다운로드한다.
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

LANG = os.environ.get("OCR_LANG", "korean")
# 8GB RAM 환경 기준 mobile 모델. server 모델은 정확도가 조금 높지만 무겁다.
DET_MODEL = os.environ.get("OCR_DET_MODEL", "PP-OCRv5_mobile_det")
REC_MODEL = os.environ.get("OCR_REC_MODEL", "korean_PP-OCRv5_mobile_rec")
# paddlepaddle 3.3 CPU + oneDNN 조합에서 PP-OCRv5 추론 시
# "ConvertPirAttribute2RuntimeAttribute not support" 오류가 나서 기본 off
ENABLE_MKLDNN = os.environ.get("OCR_ENABLE_MKLDNN", "false").lower() == "true"
MAX_UPLOAD_BYTES = int(os.environ.get("OCR_MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
