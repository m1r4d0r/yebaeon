# 현재 상태

이 파일은 세션마다 **덮어써서** 갱신한다. 새 인계 파일을 만들지 않는다. 끝난 일은 [CHANGELOG](CHANGELOG.md), 남은 일은 [BACKLOG](BACKLOG.md)에 둔다.

갱신: 2026-10-04 오전 · main d8a1d5a(클라우드 브랜치 `claude/determined-goodall-c379kc` 병합) · push와 Deploy 확인은 아직

## 운영

- Studio: main `fbcab5b`(PR #31) 배포가 마지막 확인. 사이트 https://yebaeon.grace-jean-p.workers.dev/
- Sync 최신 설치본: 0.6.6 build19 (Mac CI 37123714623, SHA-256 `444827b8…0266`). **재생목록 비교에는 쓰지 않는다**(아래 참고).
- 서버 자료(10-04 08:50 현황판): 문서 2,884개 전부 원본 있음(미업로드 0), 72.0 MB, 재생목록 파일 1개. 교회 Mac에서 `bulk-upload.sh`로 올렸다. Mac의 `upload-log.tsv`에서 different/rejected/failed 확인은 아직.

## 교회 이관

- 완료: 로컬 정리본(2,902 → Mac 2,884), 서버 비움(10-03), 장부 등록, 원본 2,884개 전부 업로드(10-04, `bulk-upload.sh`), 보관 7/삭제 5/활성 7 선정. Sync 2 1차로 1부·2부 받기 실기 확인.
- 남은 것: 이미지. 교회 Mac의 `Renewed Vision Media/Images`·`ImportedImages`를 집 PC로 복사해 `bulk-media.mjs`(scan → upload)로 올리고, 서버 3차의 `PUT /api/media/paths`가 생기면 `--register`. 서버와 교신하는 이미지 폴더는 `Images`·`ImportedImages`·`YebaeOn`(웹 가져오기 전용, 신설) 세 개(재설계안 5.4).

## Sync 재설계 (`sync2` 브랜치)

- 설계 문서는 claude.ai 프로젝트 「예배온-Sync-재설계안」(저장소에 넣지 않음). 핵심: 서버가 정본, 비교는 서버 번호 + Mac 영수증, 단위는 예배(노드), 원본 없는 참조는 적용을 막지 않음, 양쪽 수정은 서버 적용 + Mac 백업, 상주 모드.
- 1차(받기 전용) 구현: `mac-sync2/`. 서버는 plan에 `applicable`·`missing` 추가, 머리글 없는 재생목록 전체 PUT 426 거절. 이 서버 변경은 main ad1f881로 **운영 배포됨**(Deploy run 37160263447 성공).
- Mac 검사: Verify Mac Sync 2 run 37160685710(bdd0e64, 수동 실행) 성공 — Worker 65, 엔진 통합 33, Apple clang 10.13 대상 빌드. 설치본 artifact `YebaeOn-Sync-2.0.0`(ZIP SHA-256 `01c2bbdb…0652`, 11-02 만료). 최신 macOS CI 결과이며 High Sierra 실기는 아님.
- 첫 실행 run 37160263776 실패 원인: `tests/playlist-nodes.test.mjs`의 `ok()`가 `Response.clone()`으로 본문을 읽다 'Body has already been consumed'로 실패(느린 CI Mac에서만, 로컬 재현 안 됨 — 원인은 추정). 본문을 즉시 한 번만 읽도록 고침.
- 2차 서버(재설계안 7.1)는 작업 브랜치에 구현했다(배포·병합 전, 로컬 Worker 검사 69개 통과). `cloudflare/sync2.mjs`:
  - `GET /api/sync/changes?since=&limit=` (limit=0은 head만), 문서·노드·보관 쓰기마다 `sync_log` 한 줄(write_id 가드)
  - `POST/GET/DELETE /api/sync/devices`, `POST /api/sync/devices/:id/applied`, `Authorization: Bearer ybd_…`
  - `POST /api/sync/manifest`(50개, 한 문장), `POST /api/sync/usage`(id, json_each 한 문장, MAX, `reported_used`)
  - `POST/GET /api/sync/revisions`(교회 Mac 수정본, R2 `revisions/`), `GET/PUT /api/playlists/:id/nodes?node=`
  - 요청 경로 스키마 확인을 표시 행 1개(`schema-ready-sync2-v1`)로 줄임. 첫 배포 첫 요청에 한 번만 전체 초기화·이전.
- 교회 Mac 실기(10-04): Sync 2 1차로 서버 순서 내려받기 정상 적용. PP6는 `~/…` 경로를 연다. 송출하면 lastDateUsed를 갱신해 저장하고, 재생목록이 바뀌면 종료 때 다시 저장한다(사용자 확인).
- Mac 2차(a732290, 사용자 진행 지시): 올리기, 사용일만 바뀜 판정, 양쪽 수정 시 서버 보관본, PP6 되돌림 감지, 받을 때 Mac 사용일 유지, 상주 모드(15분 일지·PP6 종료·잠자기 깸·메뉴 막대·로그인 시 실행), 장치 열쇠. 재설계안 11장 결정 1~4는 제안값으로 구현했다. Mac 검사: run 37163648715 실패(검사 기대값: 6번 시나리오도 보관본을 남김) → 318e83b → run 37163928226 성공(Worker 69, 엔진 통합, 10.13 대상 빌드). 설치본 artifact `YebaeOn-Sync-2.0.0`(ZIP SHA-256 `b9d56db5…7d5d`, 11-03 만료). 서버 2단계 배포 뒤에 교회 Mac에 설치한다.
- 서버 2단계는 main 병합(d8a1d5a)에 들어 있다. push하면 Deploy가 돌고, 첫 요청에서 `schema-ready-sync2-v1` 이전이 한 번 실행된다. 배포 전에는 2차 앱이 쿠키·1시간 전체 비교로 동작한다.
- 426 차단 때문에 0.6.6의 자동 전체 PUT 경로를 쓰는 옛 Mac 검사(`sync.yml`의 playlist 통합)는 실패한다. 0.6.6은 더 검사하지 않는다.
- Sync 0.6.6의 알려진 결함(F01–F08, A1–A16)은 프로젝트 문서 「yebaeon-sync-audit-2026-10-03」「예배온-Sync-추가결함」에 있다. 0.6.6은 고치지 않고 Sync 2로 대체한다.

## 다음 세 가지

1. main push → Deploy 성공 확인 → 교회 Mac에 Sync 2 2차 설치본(run 37163928226) 설치, 올리기·상주 모드 실기.
2. 원격 브랜치 정리와 문서 정리(「예배온-저장소-문서정리안」), `sync2` 브랜치는 main으로 흡수.
3. 서버 3차: 이미지 경로표(`/api/media/paths`)와 Sync 2 이미지 받기(허용 폴더 3개, sha 비교, 사본 금지).

## 주의

- 공개 저장소다. 교회 원본·진단 자료·인증 정보를 새로 커밋하지 않는다. `church-resources/`(개역개정 본문·폰트 원본)가 공개돼 있는 문제는 BACKLOG O4.
- 운영 D1은 자동 검사가 쳐서 하루 500만 행을 넘긴 적이 있다. 검사는 로컬 모사만 쓴다.
