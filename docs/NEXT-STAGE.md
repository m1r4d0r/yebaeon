# 예배온 · 다음 단계 — 2026-09-29 업데이트

확정 이름은 **예배온(YebaeOn)**이며, 웹 편집기는 **예배온 Studio**, Mac 도구는 **예배온 Sync**다. [브랜드 기준](BRANDING.md). [예배온 Studio](https://yebaeon.grace-jean-p.workers.dev/) 배포를 완료했다. 비공개 저장소 [m1r4d0r/yebaeon](https://github.com/m1r4d0r/yebaeon)의 `main`에서 앱 코드가 바뀌면 GitHub Actions가 검사 후 Cloudflare에 자동 배포한다. 실제 예배 자료는 소스와 공개 사이트에서 제외한다.

현재는 **집 Windows PC**, 교회는 **macOS High Sierra + PP6**입니다. [상세 검토와 장소별 계획](archive/PROJECT-REVIEW-2026-09-28.md)을 기준으로 진행합니다.

## 우선순위 변경: 웹 편집기·클라우드 라이브러리를 지금 병행

서버 범위는 **전체 `.pro6`·성경 자료·사용된 미디어 업로드**로 정정했습니다. 서버는 라이브러리 저장·편집 버전 관리·동기화를 담당합니다. [저장 범위와 서버 비교/추천](SERVER-PLAN.md)을 최신 기준으로 사용합니다. 편집기 호스팅과 상태 확인 API는 배포했고, 로그인·자료 저장 API는 아직 미구현입니다.

`web-editor/index.html`에 첫 버전을 구현했습니다. 문서 불러오기, 근사 썸네일, 텍스트 수정, 기존 장 기반 추가/복사/삭제, 정렬/그룹 이동, 되돌리기, 미디어 연결/교체, PNG/ZIP 저장을 집에서 시험할 수 있습니다. [사용법과 제한](../web-editor/README.md).

남은 순서:

1. **집:** 로그인·클라우드 문서 목록·업로드·편집본 저장/다시 열기, 사용 미디어 연결, 성경 자료 가져오기. 웹 줄바꿈·부분 서식 보존과 비교기 누락 보완을 병행.
2. **교회:** High Sierra Core 빌드, pair `14/32/2/0/11`, 전체 index, 수정본 1/2/23/24장 PP6와 렌더 대조.
3. **교회:** 웹 export 문서를 별도 복사본에서 열고 다시 저장해 호환성 확인. 새 media source 설치/rewrite 검증.
4. **그다음:** 백업/실제 적용/복원 엔진, Playlist 통합, 서버와 교회 Mac의 변경분 송수신·충돌 처리.

Mac 실기 검증과 적용 엔진이 끝나기 전 **웹 ZIP은 운영 Documents에 바로 덮어쓰는 배포물이 아닙니다.**

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

## 실기 검증 후 바로 붙일 것

### A. Documents 적용 엔진

- 선택된 modified/added 문서 체크박스
- apply 전 PP6 종료 확인
- `~/Documents/PP6-Sync-Backups/<timestamp>/documents/...` 백업
- 신규 document 추가
- 수정 document atomic replace
- 적용 후 semanticFingerprint 재검증
- 실패 시 restore

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
