# 프로젝트 문서

세 파일이 기준이다. 세션마다 새 인계 파일을 만들지 않는다.

- [STATUS.md](STATUS.md) — 지금 상태와 다음 세 가지. 세션마다 덮어쓴다.
- [BACKLOG.md](BACKLOG.md) — 남은 일의 유일한 목록.
- [CHANGELOG.md](CHANGELOG.md) — 끝난 일 한 줄씩.

Sync 재설계안과 결함 분석은 claude.ai 프로젝트 「예배온」의 문서에 있다(저장소에 넣지 않음).

## 유효한 설계·규칙

- [Mac ↔ Windows 시행착오·재발 방지](CROSS-PLATFORM-LESSONS.md) — 앞부분 원칙 절이 규칙이고, 날짜별 절은 기록이다.
- [플레이리스트 중심 흐름](PLAYLIST-WORKFLOW.md), [저장 범위와 서버 기획](SERVER-PLAN.md), [브랜드](BRANDING.md)
- [이미지 범위·전송](IMAGE-SYNC-PLAN-2026-10-03.md), [자료 생명주기 계약](SYNC-LIFECYCLE-CONTRACT-HANDOFF-2026-10-03.md) — 미디어 범위는 IMAGE-SYNC-PLAN이 우선
- [Studio 렌더 결정](STUDIO-RENDER-DECISIONS-2026-10-02.md), [카테고리 정책과 정리 결과](LIBRARY-CLEANUP-NEXT-2026-10-03.md)
- [주보·Dropbox](BULLETIN-PREP.md), [PPT 가져오기](PPT-IMPORT.md)
- 사용법: [Studio](../web-editor/README.md) · [Sync 0.6.x](../mac-app/README.md) · [Sync 2](../mac-sync2/README.md) · [엔진·CLI](../mac-sync/README.md) · [배포](../cloudflare/README.md)

## 교회 이관

- [빈 서버 재구축 절차(0.6.5 기준)](SYNC-RESET-COMPARE-2026-10-03.md), [클라우드 인계·초기화 범위](CLOUD-NEXT-SESSION-2026-10-03.md), [현장 단계·중단 대처](CHURCH-MIGRATION-2026-10-03.md) — 보관 7개는 마지막에 처리한다는 최신 결정이 우선이다.

## 기록 (당시 상태, 현재 기준 아님)

SESSION-HANDOFF, SYNC-STUDIO-FOLLOWUP-PLAN, STUDIO-EDITING-FOLLOWUP, SYNC-UX-REPAIR, UX-HANDOFF-REVIEW, INTEGRATION-HANDOFF, SYNC-NEXT-SESSION-2026-10-02, SYNC-MAC-LOCAL-CHECK, NEXT-STAGE, CHURCH-TEST, HOME-CHECK, UPDATE-PACKAGE-SPEC. 「예배온-저장소-문서정리안」대로 `archive/`로 옮길 예정이다.

`archive/`: [2026-09-28 프로젝트 검토](archive/PROJECT-REVIEW-2026-09-28.md), [Cloudflare 최초 연결 기록](archive/cloudflare-bindings-2026-09-28.jsonc)
