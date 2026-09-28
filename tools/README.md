# 비교·검증 도구

웹 편집기와 Mac Core의 문서 비교 결과를 확인하는 개발 도구입니다. 아래 명령은 저장소 루트에서 실행합니다.

## Python 기준 비교기

```text
python tools/pp6-doc-compare-ref.py OLD.pro6 NEW.pro6 -o my-diff.json
python tests/test-reference.py
```

Python 표준 라이브러리만 사용합니다. 실제 문서 쌍과 웹 내보내기 결과가 필요한 검사는 로컬 자료가 있을 때 실행합니다. 자료 위치는 루트의 `test-pair/`와 `web-editor/test-output/`이며 Git에서 제외합니다.

## 비교 결과 뷰어

`tools/document-diff-viewer.html`을 브라우저에서 열고 비교 결과 JSON을 선택합니다. 문서·그룹·슬라이드의 추가·삭제·수정과 기술적 변경을 표시합니다.

[집에서 확인할 것](../docs/HOME-CHECK.md) · [발견된 비교기 문제](../docs/archive/PROJECT-REVIEW-2026-09-28.md)
