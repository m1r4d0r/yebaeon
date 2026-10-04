# 현재 상태

이 파일은 세션마다 **덮어써서** 갱신한다. 새 인계 파일을 만들지 않는다. 끝난 일은 [CHANGELOG](CHANGELOG.md), 남은 일은 [BACKLOG](BACKLOG.md)에 둔다.

갱신: 2026-10-04 오후 · main 518f602(관리 기준 결론 구현 병합) · Deploy run 37180787650 성공

## 운영

- Dropbox 후속: 사용자 요청으로 `/` 전체 폴더 탐색 지원. 특정 폴더 선택과 읽기 전용 유지, 실제 계정 연결은 미완료. 로컬 합성 검사로 루트/하위 폴더/다운로드/커서 범위 확인.

- Studio: main `fbcab5b`(PR #31) 배포가 마지막 확인. 사이트 https://yebaeon.grace-jean-p.workers.dev/
- Sync 최신 설치본: 0.6.6 build19 (Mac CI 37123714623, SHA-256 `444827b8…0266`). **재생목록 비교에는 쓰지 않는다**(아래 참고).
- 서버 자료(10-04 08:50 현황판): 문서 2,884개 전부 원본 있음(미업로드 0), 72.0 MB, 재생목록 파일 1개. 교회 Mac에서 `bulk-upload.sh`로 올렸다. Mac의 `upload-log.tsv`에서 different/rejected/failed 확인은 아직.

## 교회 이관

- 완료: 로컬 정리본(2,902 → Mac 2,884), 서버 비움(10-03), 장부 등록, 원본 2,884개 전부 업로드(10-04, `bulk-upload.sh`), 보관 7/삭제 5/활성 7 선정. Sync 2 1차로 1부·2부 받기 실기 확인.
- 남은 것: 이미지. 교회 Mac의 `Renewed Vision Media/Images`·`ImportedImages`를 집 PC로 복사해 `bulk-media.mjs`(scan → upload)로 올리고, 서버 3차의 `PUT /api/media/paths`가 생기면 `--register`. 서버와 교신하는 이미지 폴더는 `Images`·`ImportedImages`·`YebaeOn`(웹 가져오기 전용, 신설) 세 개(재설계안 5.4).

## Sync 재설계 (Sync 2)

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
- 0.6.6(`mac-app/`·`mac-sync/`)은 지웠다(10-04 사용자 지시). Sync 2가 쓰던 파일은 먼저 `mac-sync2/`로 옮겼다. 0.6.6 설치본은 git 이력에만 남는다.
- Sync 0.6.6의 알려진 결함(F01–F08, A1–A16)은 프로젝트 문서 「yebaeon-sync-audit-2026-10-03」「예배온-Sync-추가결함」에 있다. 0.6.6은 고치지 않고 Sync 2로 대체한다.

## 관리 기준 결론(10-04) 구현 — main 518f602, 운영 배포됨

- 규칙은 [sync.md 13장](design/sync.md). 핵심: Mac 파일은 [적용]·정리 창 버튼으로만 바뀐다, 보관과 휴지통은 다르고 휴지통만 Mac과 연결, 진짜 삭제는 관리자 휴지통 비우기뿐.
- 서버 3차(b605302 외): 문서 state(active·archived·trashed)와 보관/휴지통/꺼내기/이름 바꾸기, 예배 휴지통·이름 바꾸기·없을 때만 추가, DELETE는 휴지통, `ADMIN_PASSWORD` 관리자 잠금(15분 쿠키)·휴지통 비우기(사용 중·보관함 예배의 문서는 남김), 카테고리 D1 표, 편집 중 표시, 이미지 경로표, R2 장부, `structure`에 trashed 포함. 스키마 표시 `schema-ready-sync3-v1`.
- Studio 3차: 보관·휴지통 창(문서 보관함·문서 휴지통·재생목록 휴지통, 비우기는 관리자), 문서·재생목록 이름 바꾸기, 서버 카테고리와 새 카테고리, 새 문서 이름 겹침 `이름 2` 제안, 편집 중 안내, 409 때 초안 유지 안내, Mac 적용 상태, `/?doc=` 링크.
- Mac 3차: 상주 자동 적용 제거, 서버 휴지통 예배 빼기·문서 이름 바꾸기·문서 휴지통을 [적용]으로, Mac 새 문서·새 이미지·Mac에서 만든 예배 올리기(PP6 종료 뒤), 장부 사본, Mac에서 지운 예배는 기본 체크 꺼짐, 예배 이름 양방향, 받을 예배의 이름 겹침 자동 번호, 정리 창(7개 목록·차이 창·되돌리기), 전체 확인(7일).
- 배포: Deploy YebaeOn run 37180787650 성공(사용자 승인). 첫 요청에서 `schema-ready-sync3-v1` 이전이 한 번 돈다(운영 확인은 아직). main Mac 검사 run 37180787646 성공(엔진 131, 10.13 빌드, ZIP SHA-256 `1c05e4b0…0329`, 11-03 만료) — 교회 Mac에 설치할 설치본.
- 검사: 로컬 Worker 74개, 브라우저 7종(새 `library-bins.cjs` 포함) 통과. Verify Mac Sync 2 수동 실행(작업 브랜치 b619edd, `mac-sync2/` 단독 빌드) run 37179918980 성공 — 엔진 통합 131개, Apple clang 10.13 대상 빌드(차이 창 포함), 설치본 artifact `YebaeOn-Sync-2.0.0`(ZIP SHA-256 `8d4a34c2…7f51`, 11-03 만료). 최신 macOS CI 결과이며 High Sierra 실기는 아님. 그전 실패 3회는 검사가 찾은 결함(Mac에서 지운 예배를 빈 순서 수정으로 판정, 같은 초 여러 적용 때 되돌릴 대상 오인)이었고 고쳤다.

## 다음 세 가지

1. Worker 비밀값 `ADMIN_PASSWORD` 설정(대시보드 Settings → Variables and Secrets, 종류 Secret, 길이 제한 없음). 그 전까지 휴지통 비우기·카테고리 설정 변경은 503. Studio에서 보관·휴지통·이름 바꾸기 동작 확인.
2. 교회 Mac에 Sync 2 3차 설치본(run 37180787646) 설치, [적용] 전용·정리 창·전체 확인 실기.

## 주의

- 공개 저장소다. 교회 원본·진단 자료·인증 정보를 새로 커밋하지 않는다. `church-resources/`는 빌드 입력이라 그대로 두고, Sync 2 검사가 끝나면 private으로 전환한다(BACKLOG).
- 운영 D1은 자동 검사가 쳐서 하루 500만 행을 넘긴 적이 있다. 검사는 로컬 모사만 쓴다.
