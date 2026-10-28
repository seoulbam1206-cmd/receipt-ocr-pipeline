"""PaddleOCR 텍스트 박스 → 줄 단위 텍스트.

PaddleOCR는 '합계'와 '14,000'처럼 같은 줄의 텍스트를 별도 박스로 돌려준다.
web(Node)의 파서는 줄 단위 규칙이라, 세로로 겹치는 박스를 한 줄로 묶고 왼쪽→오른쪽 순으로 잇는다.
"""

from dataclasses import dataclass


@dataclass
class Box:
    text: str
    score: float
    x1: float
    y1: float
    x2: float
    y2: float

    @property
    def height(self) -> float:
        return max(1.0, self.y2 - self.y1)

    @property
    def cy(self) -> float:
        return (self.y1 + self.y2) / 2


# 두 박스의 세로 겹침이 작은 쪽 높이의 이 비율 이상이면 같은 줄
MIN_OVERLAP = 0.5


def _same_line(line: list[Box], box: Box) -> bool:
    top = min(b.y1 for b in line)
    bottom = max(b.y2 for b in line)
    overlap = min(bottom, box.y2) - max(top, box.y1)
    line_h = sum(b.height for b in line) / len(line)
    return overlap >= MIN_OVERLAP * min(line_h, box.height)


def group_lines(boxes: list[Box]) -> list[dict]:
    """박스 목록을 줄로 묶는다. 반환: [{ text, confidence, bbox: [x1, y1, x2, y2] }] (위→아래)"""
    lines: list[list[Box]] = []
    for box in sorted((b for b in boxes if b.text.strip()), key=lambda b: b.cy):
        if lines and _same_line(lines[-1], box):
            lines[-1].append(box)
        else:
            lines.append([box])

    out = []
    for line in lines:
        line.sort(key=lambda b: b.x1)
        chars = sum(len(b.text) for b in line)
        out.append(
            {
                "text": " ".join(b.text.strip() for b in line),
                # 글자 수 가중 평균
                "confidence": round(sum(b.score * len(b.text) for b in line) / chars, 4),
                "bbox": [
                    round(min(b.x1 for b in line)),
                    round(min(b.y1 for b in line)),
                    round(max(b.x2 for b in line)),
                    round(max(b.y2 for b in line)),
                ],
            }
        )
    return out


def overall_confidence(lines: list[dict]) -> float:
    """전체 신뢰도(0~1): 줄 신뢰도의 글자 수 가중 평균. 텍스트가 없으면 0"""
    chars = sum(len(l["text"]) for l in lines)
    if not chars:
        return 0.0
    return round(sum(l["confidence"] * len(l["text"]) for l in lines) / chars, 4)
