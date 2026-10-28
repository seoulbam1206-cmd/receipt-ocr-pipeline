"""PaddleOCR 래퍼. 모델은 프로세스당 한 번만 올리고, 추론기는 스레드 안전하지 않아 락으로 직렬화한다."""

import threading

import cv2
import numpy as np

from . import config
from .layout import Box, group_lines, overall_confidence


class ImageDecodeError(ValueError):
    pass


class PaddleEngine:
    name = "paddleocr"

    def __init__(self) -> None:
        self._ocr = None
        self._lock = threading.Lock()

    @property
    def ready(self) -> bool:
        return self._ocr is not None

    def load(self) -> None:
        if self._ocr is not None:
            return
        from paddleocr import PaddleOCR  # 무거운 import: 캐시 경로 설정(config) 이후에

        self._ocr = PaddleOCR(
            lang=config.LANG,
            text_detection_model_name=config.DET_MODEL,
            text_recognition_model_name=config.REC_MODEL,
            # 영수증 사진은 거의 정방향이라 문서 방향/왜곡 보정 모델은 끄고 메모리를 아낀다
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            enable_mkldnn=config.ENABLE_MKLDNN,
        )

    def recognize(self, image_bytes: bytes) -> dict:
        """반환: { text, confidence(0~1), lines: [{ text, confidence, bbox }] }"""
        img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ImageDecodeError("이미지를 해석할 수 없습니다")
        self.load()
        with self._lock:
            res = self._ocr.predict(img)[0]
        boxes = [
            Box(text, float(score), *map(float, box))
            for text, score, box in zip(res["rec_texts"], res["rec_scores"], res["rec_boxes"])
        ]
        lines = group_lines(boxes)
        return {
            "text": "\n".join(l["text"] for l in lines),
            "confidence": overall_confidence(lines),
            "lines": lines,
        }
