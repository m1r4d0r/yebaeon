# 예배온 Sync · Mac Core

교회 macOS High Sierra + PP6에서 문서와 미디어를 색인·비교하는 도구다. 네이티브 썸네일은 실험 단계이며 실제 적용·복원과 서버 동기화는 아직 미구현이다.

아래 명령은 **`mac-sync/` 안에서 실행**한다. 저장소 루트에서 시작한다면 먼저 `cd mac-sync`를 실행한다. `.command` 파일을 Finder에서 열어도 스크립트가 자신의 폴더로 이동한다. 빌드 결과도 이 폴더에 생성된다.

`run-test-compare.command`는 저장소 루트의 `test-pair/`를 읽는다. 실제 교회 자료는 GitHub에 없으므로 별도로 준비해야 한다. Windows에서는 네이티브 빌드 대신 [비교 도구](../tools/README.md)의 Python 검사를 사용할 수 있다.

[프로젝트 안내](../README.md) · [집에서 확인할 것](../docs/HOME-CHECK.md) · [남은 단계](../docs/NEXT-STAGE.md)

## 이번 버전에서 진행한 범위

### 1. Indexer v0.2

`pp6-indexer`

- `~/Documents/ProPresenter6`의 모든 `.pro6` 검색
- 관리 미디어 폴더 색인
- `.pro6` XML 파싱
- 문서별 `semanticFingerprint` 생성
- 문서별 slide/group 수
- 각 slide의 media dependency 추출
- 현재 media 참조 상태 판정
  - `exact-managed`
  - `exact-external`
  - `relocated-unique`
  - `ambiguous`
  - `missing`
- 파일은 읽기만 함

출력 기본값:

```text
~/Desktop/pp6-index-v0.2.json
```

### 2. Document folder comparator v0.1

`pp6-doc-compare`

업데이트 폴더의 `documents/`와 실제 `~/Documents/ProPresenter6`를 비교한다.

문서 판정:

- `added`
- `modified`
- `same`
- `conflict`

같은 문서는 **NFC-normalized 상대경로**로 찾는다. 실제 Mac 파일명은 변경하지 않는다.

수정 문서는 slide-level semantic diff를 계산한다.

Slide matching:

1. group UUID
2. slide UUID
3. 추가/삭제 후보 사이에서 identity fingerprint LCS
4. 남은 후보의 unique semantic fingerprint
5. 매칭된 slide의 순서를 다시 LCS/LIS 방식으로 검사해 실제 이동만 분리

즉 Playlist에서 만들었던 것과 같은 원칙으로 **삭제/추가 때문에 번호만 밀린 slide는 이동으로 잡지 않는다.**

### 3. Technical-only difference 분리

PP6가 저장하면서 다음이 바뀌어도 화면 내용이 같을 수 있다.

- slide UUID 재생성
- media source 절대경로 변경

이를 일반 `수정`에서 분리해 `technical`로 센다.

실제 `토요일.pro6` 두 버전을 reference parser로 검증한 결과:

```text
55 → 37 slides
추가 14
삭제 32
내용 수정 2
의미 있는 이동 0
기술적 차이 11
```

사용자가 실제로 수행한 변경과 일치한다.

### 4. Document Diff Viewer

`../tools/document-diff-viewer.html`

Mac comparator가 만든 JSON 또는 PC reference comparator JSON을 읽는다.

- 문서 목록
- 추가/수정/삭제/이동 요약
- group별 변경
- 배경 교체 old/new
- 텍스트 old/new
- 연속 삭제/추가 묶음
- `기술적 차이도 보기`

### 5. Experimental Thumbnail Renderer

`pp6-thumbnail.m` + `build-thumbnail.command`

아직 High Sierra 실기 검증 전인 실험 도구다.

목표:

- `.pro6` 한 slide를 PNG로 로컬 렌더링
- 이미지 background 로드
- video는 AVFoundation으로 0.5초 poster frame 추출
- RTF text를 AppKit으로 렌더링
- missing media면 경고 placeholder

기본 Sync Core와 분리해서 빌드하므로 이 실험 코드의 문제가 Indexer/Comparator 테스트를 막지 않는다.

## High Sierra에서 기본 Core 빌드

```bash
chmod +x build.command run-index.command run-test-compare.command
./build.command
```

생성:

```text
pp6-indexer
pp6-doc-compare
```

## 실제 Index 실행

```bash
./run-index.command
```

또는:

```bash
./pp6-indexer
```

## Document folder 비교

업데이트 폴더 예:

```text
PP6-Update/
└─ documents/
   └─ 토요일.pro6
```

실행:

```bash
./pp6-doc-compare \
  --local-documents "$HOME/Documents/ProPresenter6" \
  --update "/path/to/PP6-Update" \
  --output "$HOME/Desktop/pp6-document-diff.json"
```

이 단계는 **읽기 전용**이다. 덮어쓰지 않는다.

## 로컬에 보관한 실제 test-pair

아래 파일은 저장소 루트의 `test-pair/`에 보관하며 GitHub에서는 제외한다. 현재 폴더에서는 `../test-pair/`로 접근한다.

```text
test-pair/
├─ local-documents/토요일.pro6       # 원본
├─ update/documents/토요일.pro6      # 수정본
└─ expected-document-diff.json       # PC reference algorithm 결과
```

High Sierra에서:

```bash
./run-test-compare.command
```

을 실행하면 Objective-C comparator 결과를 만들 수 있다.

그 결과를 `expected-document-diff.json`과 요약 수치 기준으로 비교할 예정이다.

기대값:

```text
added 14
deleted 32
modified 2
moved 0
technical 11
```

## PC reference comparator

Mac을 기다리지 않고 알고리즘을 검증하기 위한 Python 기준 구현도 포함했다.

```bash
python ../tools/pp6-doc-compare-ref.py OLD.pro6 NEW.pro6 -o diff.json
```

실제 토요일 파일로 현재 기대값을 생성한 코드다.

## 아직 하지 않는 것

다음은 일부러 보류한다.

- 실제 Documents 덮어쓰기
- media 자동 복사
- `.pro6` source path rewrite
- 문서 삭제
- Playlist + Document 트랜잭션 통합
- Mac의 클라우드 송수신·동기화 (웹의 공용 입장·자료 API·실제 서버 문서 왕복은 완료)

서버 송수신·충돌 처리와 백업/적용/복원은 집에서 먼저 개발한다. 파일 처리 흐름은 시험용 폴더로 확인하고, Mac 전용 빌드·실행과 PP6 호환성은 교회에서 확인한다. 썸네일 실기 검증을 송수신 개발의 선행 조건으로 두지 않는다.

## 다음 개발 단계

1. 집: [서버 API](../cloudflare/README.md)에 맞춰 공용 입장, 문서 목록/버전 확인, 최초 업로드와 변경분 송수신을 구현한다.
2. 집: 기준 버전·로컬 수정 충돌, 원본 SHA-256 검증, 백업·검증 후 교체·복원을 구현한다. 원래 미디어 경로를 유지한다.
3. 교회: 변경한 Sync를 High Sierra에서 빌드·실행하고, 서버의 시험 문서 한 개를 받아 PP6에서 열고 다시 저장하는 흐름을 확인한다.

기존 Core 빌드·비교 수치·썸네일 검사를 방문 때마다 반복하는 필수 과제로 두지 않는다. 이전 결과를 먼저 확인하고, 이번 코드 변경이나 구체적인 오류와 관련된 검사만 수행한다. 이후 기존 `PP6 Playlist Sync.app`에 Documents 작업 화면을 합친다.
