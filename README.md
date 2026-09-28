# 예배온 · YebaeOn

집에서 예배 자료를 준비하고 교회 Mac과 연결하는 프로젝트. 웹 편집기는 **예배온 Studio**, Mac 동기화 도구는 **예배온 Sync**로 부른다. [이름·주소 기준](BRANDING.md).

현재 패키지는 PP6 Local Sync Core v0.2의 Documents/Media 골조와 웹 편집기를 포함한다. 클라우드 자료 저장은 아직 미구현이며, 전체 `.pro6`·성경 자료·사용 미디어를 보관하는 라이브러리를 다음 단계로 개발한다.

## GitHub 소스와 로컬 자료

[비공개 저장소: m1r4d0r/yebaeon](https://github.com/m1r4d0r/yebaeon) · 기본 브랜치 `main`.

GitHub에는 소스·문서와 안내용 웹 예제 3장만 포함한다. 실제 `.pro6`·성경·미디어·파일 목록, `test-pair/`, 이전 `web-editor/sample-data.js`, 테스트 출력물·인증 정보는 포함하지 않는다. 기존 자료는 집 PC에 그대로 보관한다. 실제 라이브러리는 이후 로그인 기능을 갖춘 R2/D1에 연결한다.

웹 편집기는 `web-editor/index.html`에서 열고, 실제 문서는 **문서 열기**로 선택한다. 교회 샘플이 필요한 회귀 검사는 로컬 자료가 없는 GitHub 복사본에서 건너뛴다. Mac 명령 파일은 LF 줄바꿈으로 관리한다.

## 웹 배포

사이트 주소는 https://yebaeon.grace-jean-p.workers.dev/ 이다. 루트 `wrangler.jsonc`와 GitHub Actions로 기존 Worker에 배포한다. 앱 파일 9개와 응답 헤더만 선별하며, 원본 자료는 공개하지 않는다. 로그인·클라우드 자료 저장 기능은 아직 없다. [배포 구성과 실행 방법](cloudflare/README.md).

집 Windows에서 Node.js 24를 사용해 `npm ci`, `npm test`, `npm run deploy:check`로 준비 상태를 검사할 수 있다. 교회 High Sierra에서는 기존 Mac 도구를 사용한다.

## 2026-09-28 · 집 Windows 개발 업데이트

- `web-editor/index.html`: 로컬 웹 편집기 첫 버전. 문서 열기, 근사 썸네일, 텍스트 수정, 슬라이드 추가/복사/정렬/삭제, 미디어 교체, PNG/업데이트 ZIP 저장.
- [웹 편집기 사용법과 현재 제한](web-editor/README.md)
- [프로젝트 검토 / 집·교회 작업 분담](PROJECT-REVIEW-2026-09-28.md)
- [남은 단계](NEXT-STAGE.md)
- [서버·자료 업로드 범위 / Netlify·Cloudflare 비교](SERVER-PLAN.md)

Windows Edge에서 기능과 export 파일을 검증했습니다. High Sierra 빌드와 PP6에서 파일을 열어 보는 검증은 아직 남아 있습니다. 아래 v0.2 Core 설명의 원래 구현 상태와 구분해 보세요.

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

`document-diff-viewer.html`

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

아래 파일은 집 PC의 개발 패키지에만 있으며 GitHub에서는 제외한다.

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
python pp6-doc-compare-ref.py OLD.pro6 NEW.pro6 -o diff.json
```

실제 토요일 파일로 현재 기대값을 생성한 코드다.

## 아직 하지 않는 것

다음은 일부러 보류한다.

- 실제 Documents 덮어쓰기
- media 자동 복사
- `.pro6` source path rewrite
- 문서 삭제
- Playlist + Document 트랜잭션 통합
- 서버 연결 (다음 단계에서 웹 편집기와 병행)

위험한 write 기능은 Index/Compare/Thumbnail 결과를 집에서 먼저 확인한 뒤 붙인다.

## 다음 개발 단계

교회 Mac에서 다음번에 확인할 것은 3가지다.

1. `build.command`가 High Sierra에서 Core v0.2를 컴파일하는지
2. `run-test-compare.command` 결과가 `14 / 32 / 2 / 0 / 11`인지
3. `build-thumbnail.command` 후 실제 slide 1/2/23 preview가 어느 정도 PP6와 일치하는지

그 검증이 끝나면 기존 `PP6 Playlist Sync.app`에 Documents 탭을 합치고 실제 백업/적용 엔진을 연결한다.
