# 예배온 · 다음 단계 — 2026-10-01 업데이트

확정 이름은 **예배온(YebaeOn)**이며, 웹 편집기는 **예배온 Studio**, Mac 도구는 **예배온 Sync**다. [브랜드 기준](BRANDING.md). [예배온 Studio](https://yebaeon.grace-jean-p.workers.dev/) 배포를 완료했다. 비공개 저장소 [m1r4d0r/yebaeon](https://github.com/m1r4d0r/yebaeon)의 `main`에서 앱 코드가 바뀌면 GitHub Actions가 검사 후 Cloudflare에 자동 배포한다. 실제 예배 자료는 소스와 공개 사이트에서 제외한다.

현재는 **집 Windows PC**, 교회는 **macOS High Sierra + PP6**입니다. [상세 검토와 장소별 계획](archive/PROJECT-REVIEW-2026-09-28.md)을 기준으로 진행합니다.

## 우선순위 변경: 웹 편집기·클라우드 라이브러리를 지금 병행

서버 범위는 **전체 `.pro6`·성경 자료·사용된 미디어 업로드**로 정정했습니다. 서버는 라이브러리 저장·편집 버전 관리·동기화를 담당합니다. [저장 범위와 서버 비교/추천](SERVER-PLAN.md)을 최신 기준으로 사용합니다. 편집기에 공용 비밀번호·이름 입장, `.pro6` 업로드·검색·버전 저장·작업자 이력 API를 구현했습니다. 운영 서버의 비밀번호 설정은 [배포 안내](../cloudflare/README.md)를 따릅니다.

`web-editor/index.html`에 첫 버전을 구현했습니다. 문서 불러오기, 근사 썸네일, 텍스트 수정, 기존 장 기반 추가/복사/삭제, 정렬/그룹 이동, 되돌리기, 미디어 연결/교체, PNG/ZIP 저장을 집에서 시험할 수 있습니다. [사용법과 제한](../web-editor/README.md).

## 네이티브 통합 앱

2026-10-01 `PP6-Playlist-Sync-Native-v0.2.zip`을 제공받았다. 기존 `main.m`의 재생목록 화면·비교·선택 적용을 `mac-app/`으로 옮기고, 서버 문서 송수신·Core 내용 비교·백업 복원과 미디어 연결 점검을 세 탭으로 연결했다. [실행 안내](../mac-app/README.md) · [패키지 구분과 인수인계](INTEGRATION-HANDOFF.md). 미디어 서버 업로드, 재생목록 서버 저장, 전체 자료 일괄 적용은 후속 작업이다.

## 다음 교회 방문 목표: 서버 업로드와 .pro6 동기화

2026-09-30 사용자 피드백을 반영했다. 교회에서 자료를 서버에 직접 올리고, 웹에서 수정한 `.pro6`를 Mac Sync로 받아 PP6에서 확인하는 흐름을 우선한다. ZIP은 오프라인 예비 수단으로 유지한다.

### 방문 전에 개발할 범위

1. **구현·운영 서버 검증 완료:** 공용 비밀번호·작업자 이름, `.pro6` 원본 업로드, 폴더 경로를 유지하는 문서 목록과 버전 저장.
2. **구현·운영 서버 검증 완료:** 서버 문서 열기·수정·저장·재열기, 이전 버전 다운로드, 작업자 기록과 충돌 방지.
3. **구현 완료, 교회 실기 검증 대기:** High Sierra용 `.pro6` 송수신: 변경 목록, 원본 bytes의 SHA-256 검증, 기준 버전/로컬 수정 충돌 표시, 선택한 문서 수신.
4. **구현 완료, 교회 실기 검증 대기:** 적용 전 백업, PP6 종료 확인, 검증 후 교체, 복원. 먼저 시험용 복사본에서 한 문서의 왕복을 확인한 뒤 실제 자료에 적용한다.

1~2는 운영 서버에서도 검증했다. 공용 비밀번호 등록 후 시험용 폴더에 실제 문서 복사본을 업로드하고, 텍스트 수정·슬라이드 순서 변경·새 버전 저장·새로고침 후 재열기·두 버전 다운로드를 확인했다. 원본 버전은 업로드 전 bytes와 일치하며, 편집본은 의도한 텍스트 1곳과 순서 이동 1건 외의 XML 내용과 미디어 경로를 보존했다. **3~4는 네이티브 클라이언트와 Intel Mac 자동 검사를 추가했다.** 실행 메뉴, 키체인 세션, 폴더별 기준 버전, 선택 송수신, 원본 백업·교체·복원과 중단 후 복구를 구현했다. 실제 Worker/D1/R2와 네이티브 클라이언트의 왕복은 합성 자료로 검사한다. [Sync 실행 및 검증 범위](../mac-sync/README.md). 다음은 교회 High Sierra의 운영 서버 연결과 PP6 열기/저장 확인이다. 웹 문서 저장 완료를 교회 PP6 동기화 완료로 취급하지 않는다.

### 기본 작업 흐름

최초에 원본 라이브러리를 서버에 등록한다. 이후 웹은 서버 라이브러리에서 문서를 열어 수정·저장하며, 로컬 파일을 매번 다시 업로드하지 않는다. Mac Sync는 서버 변경분을 받아 백업 후 적용하고, 교회에서 수정한 로컬 문서도 기준 버전을 확인해 다시 서버로 보낸다. 로컬 파일 열기와 ZIP은 가져오기·오프라인 작업용으로 유지한다.

### 교회에서 할 일

1. `.pro6` 한 문서로 서버 업로드 → 웹 수정/저장 → Mac Sync 수신/적용 → PP6 열기·다시 저장을 확인한다. 성공하면 전체 `.pro6` 라이브러리의 최초 업로드를 진행한다.
2. 성경 자료는 원본 업로드를 목표로 준비하되, 번역본/파일 형식 확인과 검색·슬라이드 생성 기능은 분리한다. 초기 `.pro6` 왕복을 성경 해석이나 미디어 동기화 완료 때문에 지연하지 않는다.
3. 대표 슬라이드와 줄바꿈 문제가 난 말씀 장의 정상 PP6 화면을 캡처한다. 슬라이드 전체가 잘리지 않고 가로세로 비율이 유지되면 확대된 미리보기 캡처도 줄바꿈·상대 배치 비교에 사용할 수 있다. 픽셀 크기만으로 글꼴 포인트 크기를 단정하지 않는다.
4. 누락 배경을 찾는다. 기존 목록에는 `/Users/Shared/Renewed Vision Media/Images/찬양-PPT_2 2.jpg`와 `/Users/procg/Desktop/pp6-test/__Media/Images/찬양-PPT_2 2.jpg`가 있었다. 현재 파일 존재 여부는 교회에서 확인한다.

폰트 폴더는 사용자가 이미 통째로 복사해 두었다. 재수집 과제에서 제외하고, 확보한 폰트의 이름·버전 대조를 후속 작업으로 둔다.

기본 빌드·`14/32/2/0/11` 비교·전체 색인을 방문 때마다 반복하는 필수 과제로 제시하지 않는다. 사용자는 이전에도 실행했을 가능성을 지적했다. 이 저장소에서 해당 Mac 실행 결과를 확인하지 못한 것과 실제로 미실행인 것은 구분한다. 기존 결과를 먼저 확인하고, 코드 변경이나 구체적인 실패를 진단할 때 필요한 검사만 실행한다.

### 그다음

사용 미디어 업로드·동기화, 성경 본문 검색·슬라이드 생성, Playlist 통합을 이어간다. 글꼴·줄바꿈·부분 서식과 비교기의 변경 누락은 `.pro6` 왕복 개발과 함께 보완한다.

아래는 기존 Core 단계별 설계입니다.

현재 교회 Mac 없이 개발 가능한 Core 영역은 아래까지 진행함.

## 완료/구현됨

- Local Documents index 설계
- media resolver 설계/구현
- semantic document fingerprint
- group/slide semantic parsing
- slide identity matching
- UUID 재생성 무시
- path-only 변화 technical 분리
- 의미 있는 이동 판정
- folder-level document added/modified/same/conflict 비교
- JSON report
- HTML diff viewer
- thumbnail renderer 실험 코드
- offline update package 구조

## 적용 엔진과 이후 통합 범위

### A. Documents 적용 엔진 — 첫 구현 완료

- 메뉴에서 문서 번호 선택·최종 대상 확인
- 적용 직전 PP6 종료·현재 파일 SHA-256 확인
- `~/Library/Application Support/YebaeOn Sync/<프로필>/transactions/<번호>/`에 원본과 적용 기록 보관
- 신규 문서 추가·기존 문서 임시 파일 검증 후 교체
- 서버 원본 bytes·SHA-256 일치 확인, 원래 미디어 경로 유지
- 복원과 중단 작업 복구, 복원 이후 수정된 문서 보호
- 이후 GUI 체크박스·의미 차이 미리보기를 연결할 수 있음

### B. Media 적용 엔진

Incoming `.pro6`가 `package-asset`을 요구하는 경우:

- image → Renewed Vision Media/Images
- video → Renewed Vision Media/Video
- audio → Renewed Vision Media/Audio
- same basename/same hash → 기존 사용
- same basename/different hash → 별도 안전 이름 생성
- incoming `.pro6` source path rewrite
- 원래 존재한 media 파일은 삭제/덮어쓰기 금지

### C. Playlist + Documents 통합

적용 트랜잭션:

```text
backup
→ media install
→ documents apply
→ documents verify
→ playlist apply
→ playlist verify
→ complete
```

### D. Web editor

로컬 contract 검증과 병행해 집 PC에서 편집기 사용성을 맞춘다. 2026-09-28 첫 버전을 추가했다.

웹 편집기는 나중에 export 시:

- `.pro6` document
- 필요한 새 media만 `assets/`
- playlist 변경이 있으면 `.pro6pl`

을 **브라우저에서 로컬 package로 생성**할 수 있다. 이 ZIP은 오프라인 전달 경로다. 클라우드 버전에서는 전체 문서·성경 자료·사용 미디어를 서버에 보관하고 웹 편집기에서 불러온다. 현재 ZIP의 새 미디어만 포함하는 방식과 서버 라이브러리의 저장 범위는 다르다.

### E. Server

집에서 웹 편집기와 병행한다. Cloudflare Workers/Static Assets + R2 + D1을 추천하며, 상세 비교·비용·확인 중인 항목은 [서버 기획](SERVER-PLAN.md)에 기록했다.

전체 `.pro6` 라이브러리, 성경 자료, 사용된 미디어와 편집 버전을 보관한다. 교회 Mac의 적용 엔진과 분리해 목록·업로드·편집본 저장을 먼저 개발하고, 실기 검증 후 변경분 수신/적용을 연결한다.
