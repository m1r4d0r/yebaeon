# 예배온 Sync · Mac Core

교회 macOS High Sierra + PP6를 위한 도구다. `.pro6` 서버 송수신·선택 적용·백업·복원을 구현했다. 색인·비교 도구도 유지한다. 네이티브 썸네일은 별도 실험 단계다. High Sierra와 실제 PP6 실행 검증은 교회에서 진행한다.

아래 명령은 **`mac-sync/` 안에서 실행**한다. 저장소 루트에서 시작한다면 먼저 `cd mac-sync`를 실행한다. `.command` 파일을 Finder에서 열어도 스크립트가 자신의 폴더로 이동한다. 빌드 결과도 이 폴더에 생성된다.

`run-test-compare.command`는 저장소 루트의 `test-pair/`를 읽는다. 실제 교회 자료는 GitHub에 없으므로 별도로 준비해야 한다. Windows에서는 네이티브 빌드 대신 [비교 도구](../tools/README.md)의 Python 검사를 사용할 수 있다.

[프로젝트 안내](../README.md) · [집에서 확인할 것](../docs/HOME-CHECK.md) · [남은 단계](../docs/NEXT-STAGE.md)

## 통합 앱

2026-10-01 기존 Native v0.2 앱 소스를 제공받아 재생목록·문서·미디어 화면을 [예배온 Sync.app](../mac-app/README.md)으로 통합했다. 일반 사용은 통합 앱을 권장하며, 아래 개별 실행 도구는 개발·진단용으로 계속 사용할 수 있다. 같은 문서 폴더의 기준 버전·백업 기록을 공유한다.

## 문서 동기화 시작하기

새 송수신 도구는 `pp6-sync`다. 기존 Indexer/Comparator와 별도로 빌드한다. 교회 Mac에서 소스를 최신으로 받은 뒤 **`run-sync.command`를 열면** 필요한 경우 자동 빌드하고 한국어 메뉴를 표시한다. 빌드에는 기존 Core와 같은 Apple Command Line Tools의 `clang`이 필요하다. Node.js·Python·Cloudflare 도구 설치는 필요 없다.

기본 문서 폴더는 **`~/Documents/YebaeOn-Sync-Test`**다. 실제 PP6 라이브러리 경로를 자동 선택하지 않는다.

1. 메뉴 **1 비교/입장**에서 작업자 이름과 공용 비밀번호를 입력한다. 비밀번호 입력은 표시되지 않는다. 비밀번호를 파일에 저장하지 않고, 30일 입장 세션만 macOS 키체인에 보관한다.
2. 메뉴 **2 서버에서 받기**에서 시험 문서의 번호를 선택한다. 적용 대상·경로를 확인한 뒤 `받기`를 입력한다. 첫 수신은 원본 그대로 새 파일을 만든다.
3. 받은 `.pro6`를 PP6에서 열어 내용과 화면을 확인한다. PP6에서 다시 저장했다면 PP6를 종료하고 메뉴 **3 서버로 보내기**로 보낸다.
4. 웹에서는 서버 문서를 수정·저장한다. Mac에서 다시 비교하면 `받기`로 표시된다. 메뉴 2로 백업 후 적용한다.

번호는 `1,3,5`처럼 입력하고, `all`은 현재 송수신 가능한 목록 전체를 선택한다. Enter는 취소다. 선택 결과를 다시 보여주며 `받기`/`보내기`를 입력하기 전에는 문서를 변경하지 않는다. `일치` 문서는 내용 변경 없이 기준만 기록한다. `충돌·확인 필요` 문서는 송수신 목록에서 제외한다.

시험 문서가 정상 동작하면 실제 문서 폴더를 지정한다. 아래는 **저장소 루트에서 실행하는 예시**다. 실제 교회 Mac의 라이브러리 경로에 맞춘다.

```bash
bash mac-sync/run-sync.command --documents "$HOME/Documents/ProPresenter6"
```

기존 도구처럼 `mac-sync/` 안에서 실행할 때는 `bash ./run-sync.command --documents "$HOME/Documents/ProPresenter6"`를 사용한다. 실제 문서 최초 업로드는 메뉴 3에서 선택한다. `.pro6`와 폴더 구조를 보내며 미디어·성경 파일 자체는 아직 보내지 않는다. 기본 서버는 예배온 사이트이고 `--server https://...`로 다른 서버를 명시할 수 있다. 사용자 실행에서는 HTTPS만 허용한다.

### 상태 판정과 충돌

| 로컬과 서버 상태 | 처리 |
|---|---|
| 서버에만 있음 | 선택하여 받기. 로컬 삭제를 서버 삭제로 전파하지 않음 |
| 로컬에만 있고 최초 등록 전 | 선택하여 보내기 |
| 원본 bytes가 같음 | 일치. 선택한 송수신 작업에서 기준 버전 연결 |
| 마지막 동기화 후 서버만 바뀜 | 받기 |
| 마지막 동기화 후 Mac만 바뀜 | 기준 서버 버전을 조건으로 보내기 |
| 양쪽 변경 또는 기준 없이 서로 다른 내용 | 충돌. 자동 덮어쓰기 없음 |
| 연결했던 문서가 서버에서 사라짐/식별자 변경 | 충돌. 임의 재등록 없음 |

처음에 서버와 Mac에 같은 경로의 서로 다른 파일이 있으면 어느 쪽이 원본인지 추측하지 않는다. 이 경우 시험 폴더에 서버본을 먼저 받고 원본과 비교한다. 실제 파일을 임의로 지워 충돌을 해소하지 않는다. 현재 버전은 충돌 해결 UI나 강제 덮어쓰기 옵션을 제공하지 않는다.

전송 직전 로컬 해시와 서버 버전을 다시 확인한다. 서버 저장은 `If-Match` 기준 버전으로 다른 작업자의 수정을 보호한다. 수신은 지정한 버전의 원본 bytes와 SHA-256·크기를 확인하고 XML을 검증한다. 원래 미디어 경로와 서식 bytes는 변환하지 않는다. Mac의 한글 분해형 파일명은 NFC 서버 경로와 연결하며 실제 이름은 유지한다. 대소문자 충돌·심볼릭 링크·안전하지 않은 경로는 작업을 멈춘다. 읽을 수 없거나 잘못된 문서도 조용히 건너뛰지 않고 알려준다.

### 백업과 복원

상태와 백업은 시작 화면에 표시되는 다음 폴더에 보관한다.

```text
~/Library/Application Support/YebaeOn Sync/<서버와 문서 폴더별 식별자>/
  state.json
  transactions/<백업 번호>/
    before.pro6       # 기존 파일이 있을 때의 원본
    after.pro6        # 받은 서버본
    transaction.json # 적용 단계, 해시, 이전 기준 버전
```

송수신할 때는 PP6를 먼저 종료한다. 적용·복원 직전에도 ProPresenter 실행 여부를 확인한다. 같은 문서 폴더에서는 Sync 하나만 실행할 수 있다. 다른 편집기도 해당 문서를 저장하지 않도록 한다. 파일 해시를 재확인하고 임시 파일을 디스크에 기록한 뒤 교체하지만, 마지막 확인과 교체 사이의 외부 프로그램 쓰기를 운영체제 수준으로 잠그는 것은 아니다.

- **메뉴 4 백업 복원**: 이 Mac의 파일과 동기화 기준을 적용 전으로 되돌린다. 최초 수신으로 새로 생긴 문서는 내용이 그대로일 때만 제거한다. 서버 이력은 유지한다.
- **메뉴 5 중단 작업 복구**: 적용 중 종료·저장 오류가 나면 새 송수신을 막고 복구를 안내한다. 기록과 현재 파일이 일치하면 원본과 이전 기준으로 되돌린다. 복구 중 다시 중단돼도 재시도할 수 있다.
- 적용 후 문서가 다시 바뀌었거나 백업이 손상됐으면 덮어쓰지 않는다. 현재 파일과 `before.pro6`를 각각 보관하여 비교한다.

여러 문서를 선택해도 적용은 **문서별**이다. 중간 실패 시 이미 완료한 문서는 유지하고, 실패한 문서의 중단 기록부터 복구한다. 자동 백그라운드 감시나 전체 배치의 일괄 취소는 아직 없다. 백업은 자동 삭제하지 않으므로 디스크 사용량을 확인한다.

### 개발 검사 범위

`.github/workflows/sync.yml`이 Intel Mac에서 macOS 10.13 대상으로 빌드하고 실제 네이티브 엔진을 검사한다. 2026-09-30 [자동 검사](https://github.com/m1r4d0r/yebaeon/actions/runs/36731804212)에서 안전성 검사 100개 확인 지점과 Worker 연동 18개 확인 지점이 통과했다. 임시 폴더에서 원본 보존, 한글 경로, 대소문자 충돌, 동시 실행 잠금, ProPresenter 실행 차단, 심볼릭 링크 거부, 중단·재시작 복구와 백업 손상/후속 수정 시 거부를 확인한다.

서버 연동 검사는 실제 Worker 코드를 Miniflare의 D1/R2와 함께 실행한다. 합성 문서와 시험 전용 비밀번호로 최초 업로드 → 다른 작업자 수정 → Mac 수신 → Mac 재수정/업로드, 버전 충돌, 이전 원본, 페이지 목록과 로그아웃을 검사한다. 운영 비밀번호나 교회 문서는 CI에 넣지 않는다.

Mac 개발 환경에서 `npm ci` 후 `bash mac-sync/test-sync.command`로 동일 검사를 실행할 수 있다. 이때만 Node.js가 필요하며 교회 사용자가 반복 실행할 절차는 아니다. **최신 Mac CI 성공은 High Sierra 실기·키체인·운영 서버 연결·PP6 화면 검증을 대신하지 않는다.**

## 기존 Core 도구

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

## 다음 단계

- 교회 High Sierra에서 새 Sync를 실행하고 운영 서버의 시험 문서 하나를 받아 PP6로 열기·저장하기. 새로 추가한 이 경로만 검증한다.
- 성공 후 실제 `.pro6` 라이브러리 최초 업로드와 선택 동기화.
- 사용 미디어 송수신과 경로 연결, 성경 자료, Playlist + Documents 통합.
- 통합한 `예배온 Sync.app`을 High Sierra에서 확인하고 미디어 송수신을 연결.

문서 자동 삭제, 미디어 자동 복사와 source path rewrite, 자동 병합은 아직 하지 않는다. 썸네일 검증을 송수신의 선행 조건으로 두지 않으며, 기존 Core 빌드·비교 수치 검사를 방문 때마다 반복하는 과제로 제시하지 않는다.
