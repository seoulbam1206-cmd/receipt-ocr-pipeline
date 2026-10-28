from fastapi.testclient import TestClient

from app.engine import ImageDecodeError
from app.main import create_app


class FakeEngine:
    name = "fake"
    ready = True

    def load(self):
        pass

    def recognize(self, data: bytes):
        if data == b"broken":
            raise ImageDecodeError("이미지를 해석할 수 없습니다")
        return {"text": "합계 14,000", "confidence": 0.97, "lines": []}


client = TestClient(create_app(FakeEngine(), preload=False))


def test_health():
    body = client.get("/health").json()
    assert body["ok"] is True and body["engine"] == "fake" and body["peakRssMb"] > 0


def test_ocr_정상():
    r = client.post("/ocr", files={"image": ("a.png", b"png", "image/png")})
    assert r.status_code == 200
    assert r.json() == {"text": "합계 14,000", "confidence": 0.97, "lines": []}


def test_ocr_이미지_필드_없음은_422():
    assert client.post("/ocr").status_code == 422


def test_ocr_해석_불가_이미지는_422():
    r = client.post("/ocr", files={"image": ("a.png", b"broken", "image/png")})
    assert r.status_code == 422 and "해석" in r.json()["detail"]


def test_ocr_용량_초과는_413(monkeypatch):
    monkeypatch.setattr("app.config.MAX_UPLOAD_BYTES", 3)
    r = client.post("/ocr", files={"image": ("a.png", b"1234", "image/png")})
    assert r.status_code == 413
