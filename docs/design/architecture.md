# 예배온 구성과 코드 위치

예배온(YebaeOn)의 구성 요소, 폴더별 코드 위치, 이름·표기 규칙을 정한다. 집에서 예배 자료를 준비하고 교회 Mac의 ProPresenter 6(PP6)와 연결하는 프로젝트다. 대표 문구는 "예배 자료를 준비하는 공간"이다.

## 구성도

```text
[집 PC, Windows Chrome/Edge]
  예배온 Studio (web-editor/) ──┐
  집 PC 업로더 (Node 스크립트) ─┤ HTTPS
                                ▼
                  [Cloudflare] Worker `yebaeon` (cloudflare/)
                                ├─ 정적 자산: Studio, church-resources
                                ├─ API: 입장, 문서, 재생목록, 이미지, Sync
                                ├─ D1 `pp6-library-db`   (바인딩 DB)
                                └─ R2 `pp6-library-files` (바인딩 FILES)
                                ▲
                                │ HTTPS
[교회 Mac, High Sierra 10.13]   │
  예배온 Sync 2 (mac-sync2/) ───┘
        │ 로컬 파일 쓰기·읽기
        ▼
  PP6 문서 폴더 (.pro6, .pro6pl) ◀── ProPresenter 6
```

- Studio: 서버 문서를 검색·편집하고 재생목록 순서를 저장한다. 대상 브라우저는 Windows의 최신 Chrome/Edge다. 로컬 파일 열기와 ZIP 내보내기는 제공하지 않는다.
- Worker: Studio 정적 자산과 API를 한 Worker가 제공한다. 사람은 공용 비밀번호와 작업자 이름으로 입장해 세션 쿠키(Secure·HttpOnly·SameSite=Strict)를 받고, 상주 Sync는 장치 열쇠(`Authorization: Bearer ybd_…`)를 쓴다. 변경 요청은 `Origin`이 사이트와 같아야 한다. 저장 규칙은 [server-storage.md](server-storage.md)다.
- Sync 2: 서버 내용을 받아 PP6가 열 파일을 쓰고 Mac에서 고친 것을 올린다. 교회 Mac에 Node.js·Python·Wrangler를 요구하지 않으며 Apple Command Line Tools의 `clang`으로 빌드한다. 규칙은 [sync.md](sync.md)다.
- 집 PC 업로더: 초기 구축 때 한 번 쓰는 단독 Node 스크립트다(`bulk-upload.mjs` 문서, `bulk-media.mjs` 이미지). 서버 API만 쓰며 Sync 앱과 분리돼 있다.
- GitHub `main`에서 앱·서버·검사 코드가 바뀌면 Actions가 검사 후 기존 Worker `yebaeon`에 배포한다. 문서만 바꾸면 배포하지 않는다.

## 코드 위치

| 폴더 | 내용 |
|---|---|
| `web-editor/` | Studio. 정적 HTML·JS·CSS다. 화면과 흐름(`app.js`·`studio-*.js`), PP6 XML·RTF 해석(`pp6.js`), 렌더·폰트(`render.js`·`fonts.*`), 서버 연동·재생목록·초안(`cloud.js`·`playlists.js`·`drafts.js`), 일반 편집기, PPT 가져오기(`ppt-*`), 주보(`bulletin*`), 현황판(`status.*`). 사용법은 [web-editor/README.md](../../web-editor/README.md) |
| `cloudflare/` | Worker. 진입점·라우팅 `worker.mjs`, 입장 `auth.mjs`, 스키마·이전 `schema.mjs`, 문서 `documents.mjs`와 `document-*.mjs`, 장부 `library-catalog.mjs`, 재생목록 `playlists.mjs`·`playlist-*.mjs`, 이미지 `media-assets.mjs`, Sync 2 `sync2.mjs`, 주보 자료 `dropbox.mjs`. `inventory.mjs`·`sync-observations.mjs`는 Sync 2가 자리 잡은 뒤 승인을 받아 제거한다. 배포·API는 [cloudflare/README.md](../../cloudflare/README.md) |
| 루트 | `wrangler.jsonc`(진입점 `cloudflare/worker.mjs`, 정적 자산 `dist/`, `DB`·`FILES` 바인딩), `package.json`, `.node-version`(Node 24). `.github/workflows/`에 배포(`deploy.yml`), Studio 브라우저 검사(`studio.yml`), Mac Sync 2 검사(`sync2.yml`)가 있다 |
| `mac-sync2/` | 예배온 Sync 2. 영수증(SQLite) `YB2Receipt`, 서버·장치 열쇠 `YB2Server`, 비교·적용·올리기 `YB2Engine`, 창과 메뉴 막대 상주 `YB2App`, 통합 검사 `YB2Test`·`test-server2.mjs`. `build.command`로 빌드하고 `test.command`로 검사한다. [mac-sync2/README.md](../../mac-sync2/README.md) |
| `mac-sync/` | Sync 2 빌드가 가져다 쓰는 `YBSync.m`(문서 폴더 엔진·경로 규칙)과 `YBServer.m`(서버 요청)이 있다. `PP6Core.*`(PP6 문서 해석)도 남아 있으며 현재는 0.6.6만 링크한다 |
| `mac-app/` | 예배온 Sync 0.6.6. Native v0.2 앱([ORIGIN.md](../../mac-app/ORIGIN.md))을 바탕으로 한 이전 앱이며 삭제 예정이다. 재생목록 비교에 쓰지 않는다. Sync 2가 자리 잡으면 지우되, Sync 2 빌드가 `YBPlaylistIO.m`·`YBPlaylistFormat.m`과 `assets/SyncIcon-1024.png`를 쓰므로 먼저 옮겨야 한다 |
| `scripts/` | `build.mjs`가 배포용 `dist/`를 만든다. 선별한 앱 파일과 교회 리소스만 복사하고 예상하지 못한 파일이 있으면 중단한다. `build-ppt.mjs`·`hwp-vendor.mjs`는 PPT·HWP 가져오기 번들, `connect-dropbox.mjs`는 계정 소유자가 직접 실행하는 Dropbox 연결이다 |
| `tests/` | `*.test.mjs`는 Node 테스트로 실제 Worker·D1·R2 모사(Miniflare) 위에서 돈다(`npm test`). `tests/browser/*.cjs`는 합성 자료로 Chromium UI 흐름을 검사한다 |
| `church-resources/` | 선별한 교회 자료. 폰트 원본·WOFF2, 템플릿(`templates.json.gz`), 개역개정(`bible.json.gz`), 이미지, 빌드 대상을 지정하는 `catalog.json`. Worker가 `/resources/*`를 세션 확인 후 `private, no-store`로 제공한다. 공개 저장소 노출은 [BACKLOG](../BACKLOG.md)의 결정 대상이다 |

실제 교회 원본(`.pro6`·`.pro6pl`·ZIP·진단 자료)과 인증 정보는 저장소에 넣지 않는다. 개발은 Node.js 24에서 `npm ci`, `npm test`, `npm run deploy:check`로 한다.

## 이름과 표기

| 구분 | 이름 | 역할 |
|---|---|---|
| 전체 프로젝트 | 예배온 / YebaeOn | 집에서 예배 자료를 준비하고 교회와 연결 |
| 웹 | 예배온 Studio / YebaeOn Studio (약칭 Studio) | 문서 검색·편집, 재생목록, 말씀·이미지 |
| Mac | 예배온 Sync / YebaeOn Sync (약칭 Sync) | 교회 Mac의 받기·올리기·적용. 현행은 `예배온 Sync 2`다 |
| GitHub 저장소 | [m1r4d0r/yebaeon](https://github.com/m1r4d0r/yebaeon) | 공개 저장소, 기본 브랜치 `main` |
| Cloudflare Worker | `yebaeon` | https://yebaeon.grace-jean-p.workers.dev/ |

- 표시 이름은 `예배온 Studio`와 `예배온 Sync`, 영문 표기는 `YebaeOn`, 주소·저장소·D1 표 접두사 등 식별자는 소문자 `yebaeon`으로 통일한다. 웹 상단의 간단한 문자 표시는 `ON`이다.
- 계정 주소의 `grace-jean-p`는 그대로다. R2 `pp6-library-files`, D1 `pp6-library-db`와 연결 이름 `FILES`·`DB`도 그대로 쓴다.
- PP6 파일 형식, PP6 실행 파일 이름, PP6 백업 경로는 PP6의 것이므로 예배온 이름으로 바꾸지 않는다.
- Mac 앱 프로필은 `~/Library/Application Support/YebaeOn Sync 2/<id>/`에 둔다. 입장 정보는 이전 앱과 같은 키체인 항목을 쓴다.
