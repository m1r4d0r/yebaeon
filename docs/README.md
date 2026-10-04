# 문서 색인

세 파일이 기준이다. 세션마다 새 인계 파일을 만들지 않는다.

- [STATUS.md](STATUS.md) — 지금 상태와 다음 할 일. 세션마다 덮어쓴다.
- [BACKLOG.md](BACKLOG.md) — 남은 일의 유일한 목록.
- [CHANGELOG.md](CHANGELOG.md) — 끝난 일 한 줄씩.

## rules/ — 지켜야 할 규칙

- [working-rules.md](rules/working-rules.md) — 보고, 승인, Actions, 공개 저장소, 문서 규칙
- [d1-cost.md](rules/d1-cost.md) — D1 조회량과 운영 비용 원칙
- [cross-platform.md](rules/cross-platform.md) — 경로·한글(NFC/NFD), High Sierra 제약, PP6 동작, 서버·검사 교훈

## design/ — 결정된 설계

- [sync.md](design/sync.md) — Mac Sync 2 ↔ 서버 규약(정본·영수증·변경 일지·판정·이미지·상주 모드·전환)
- [server-storage.md](design/server-storage.md) — 자료별 저장 위치, 버전·CAS, 집과 교회의 역할
- [media.md](design/media.md) — 이미지 범위와 서버 저장. Mac 설치 규칙은 sync.md 5.4
- [library-policy.md](design/library-policy.md) — 카테고리별 검색·이력 설정, 옛날자료 숨김, 재생목록 정리
- [studio-render.md](design/studio-render.md) — 폰트·RTF 해석·미리보기
- [architecture.md](design/architecture.md) — 구성도, 코드 위치, 이름·표기

## guides/ — 절차

- [church-migration.md](guides/church-migration.md) — 교회 Mac 전환 단계, 이미지 올리기, 중단 대처, 현장 기록 칸
- [bulletin-dropbox.md](guides/bulletin-dropbox.md) — 주보 준비와 Dropbox 연결
- [ppt-import.md](guides/ppt-import.md) — PPT 가져오기

사용법은 각 폴더의 README: [Studio](../web-editor/README.md) · [Sync 2](../mac-sync2/README.md) · [서버](../cloudflare/README.md).

## archive/ — 당시 기록 (현재 기준 아님)

`archive/2026-09/`, `archive/2026-10/`에 원문 그대로 둔다. 인계 문서, 시행착오 일지, 옛 Sync(0.4~0.6.6) 설계, 옛 AGENTS.md가 여기 있다. 현재 규칙·설계와 어긋나면 위 문서가 우선이다.
