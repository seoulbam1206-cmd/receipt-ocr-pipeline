from app.layout import Box, group_lines, overall_confidence


def test_같은_줄의_라벨과_금액을_왼쪽부터_한_줄로_묶는다():
    boxes = [
        Box("14,000", 0.9, 300, 102, 400, 130),  # 순서가 섞여 들어와도
        Box("합계", 1.0, 40, 100, 110, 128),
        Box("부가세", 1.0, 40, 60, 120, 88),
        Box("1,273", 1.0, 310, 61, 400, 89),
    ]
    lines = group_lines(boxes)
    assert [l["text"] for l in lines] == ["부가세 1,273", "합계 14,000"]
    assert lines[1]["bbox"] == [40, 100, 400, 130]


def test_조금_기울어진_줄도_세로로_절반_이상_겹치면_같은_줄():
    lines = group_lines([Box("일시", 1, 40, 200, 100, 230), Box("19:12", 1, 300, 212, 380, 242)])
    assert [l["text"] for l in lines] == ["일시 19:12"]


def test_겹침이_작으면_다른_줄():
    lines = group_lines([Box("A", 1, 0, 0, 50, 30), Box("B", 1, 60, 25, 100, 55)])
    assert [l["text"] for l in lines] == ["A", "B"]


def test_신뢰도는_글자_수_가중_평균이고_빈_입력은_0():
    lines = group_lines([Box("가나다라", 1.0, 0, 0, 80, 20), Box("1", 0.5, 100, 0, 110, 20)])
    assert lines[0]["confidence"] == 0.9
    assert overall_confidence(lines) == 0.9
    assert group_lines([Box("  ", 1, 0, 0, 1, 1)]) == []
    assert overall_confidence([]) == 0.0
