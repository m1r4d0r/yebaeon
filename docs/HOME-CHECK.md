# 집에서 확인할 것

이 문서는 개발·문제 진단용 실행 참고입니다. 방문 때마다 전부 반복하는 과제가 아닙니다. 다음 교회 방문의 목표는 [서버 업로드와 .pro6 동기화](NEXT-STAGE.md)이며, 이미 실행한 검사는 결과를 우선 확인합니다.

교회 Mac의 새 JSON 없이도 현재 단계는 테스트할 수 있습니다. 아래 명령은 저장소 루트에서 실행합니다. 실제 교회 자료는 GitHub에 없으며 로컬 `test-pair/`에 별도로 준비합니다.

## 새로 추가된 웹 편집기

`web-editor/index.html`을 최신 Edge/Chrome에서 열면 안내용 예제 3장이 표시됩니다. **문서 열기**로 로컬 `test-pair/update/documents/토요일.pro6`를 선택하면 실제 수정본 37장을 확인할 수 있습니다. 문서/미디어 파일은 브라우저에서 로컬로만 읽습니다. 실제 샘플과 미디어는 GitHub에서 제외합니다.

- 텍스트 수정, 기존 장 기반 추가/복사/정렬/그룹 이동/삭제와 되돌리기.
- 미디어 파일/폴더 연결, 이미지/영상 교체, PNG와 업데이트 ZIP 저장.
- 내보낸 ZIP은 아직 PP6 실기 검증 전이며 media 경로 설치/rewrite가 필요합니다.

[사용법](../web-editor/README.md) · [검토 결과와 교회에서 수집할 파일](archive/PROJECT-REVIEW-2026-09-28.md)

## 1. 이미 검증한 실제 토요일 파일 pair

이 패키지의:

- `test-pair/local-documents/토요일.pro6`
- `test-pair/update/documents/토요일.pro6`

는 실제 원본/수정본입니다.

PC에서:

```bash
python tools/pp6-doc-compare-ref.py "test-pair/local-documents/토요일.pro6" "test-pair/update/documents/토요일.pro6" -o my-diff.json
```

기대 결과:

```text
added: 14
deleted: 32
modified: 2
moved: 0
technical: 11
```

이 기준 구현은 현재 PASS 상태입니다.

## 2. UI 확인

`tools/document-diff-viewer.html`을 브라우저에서 열고

`test-pair/expected-document-diff.json`

을 선택하세요.

확인 포인트:

- 슬라이드 1 배경 교체
- 원본 2–33 32개 삭제
- 마가복음 15:37 줄바꿈 변경
- 신규 24–37 14개 추가
- 기술 차이를 켜면 UUID/미디어 경로 변화가 별도 표시

## 3. Mac Core를 빌드하거나 변경 사항을 확인할 때

Mac에서:

```bash
chmod +x mac-sync/*.command
./mac-sync/build.command
./mac-sync/run-test-compare.command
```

Mac Objective-C 결과도 `14 / 32 / 2 / 0 / 11`이면,
PC reference 알고리즘과 High Sierra Core가 같은 판단을 하는 것입니다.

그 뒤:

```bash
./mac-sync/run-index.command
```

으로 실제 전체 `pp6-index-v0.2.json`을 생성합니다.

## 4. Thumbnail 실험

별도 빌드라 기본 Core를 방해하지 않습니다.

```bash
./mac-sync/build-thumbnail.command
./mac-sync/pp6-thumbnail --document "$HOME/Documents/ProPresenter6/토요일.pro6" --slide 1
```

이 렌더러는 아직 High Sierra 실기 검증 전입니다.
