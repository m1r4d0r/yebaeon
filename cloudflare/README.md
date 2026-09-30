# 예배온 Studio 서버·배포

사이트: https://yebaeon.grace-jean-p.workers.dev/

공용 비밀번호 + 작업자 이름으로 입장해 `.pro6`를 올리고, 열고, 수정·저장한다. 문서 목록과 저장 이력에 작업자 이름이 남는다. 이름은 본인 입력값이며 별도 본인 인증이나 관리자/편집자 구분은 없다. 입장한 사람은 모든 문서를 읽고 편집할 수 있다.

## 최초 운영 설정

Cloudflare 대시보드에서 **Workers & Pages → yebaeon → Settings → Runtime variables and secrets → Add variable**를 연다.

- Environment: **Production**
- Key: **SITE_PASSWORD**
- **Secret** 체크
- Value: 교회에서 공유할 비밀번호(8자 이상). 계정 로그인 비밀번호와 별도로 정한다.
- **Add 1 variable and deploy**를 눌러 저장·배포한다. CLI를 쓰는 관리자는 인증한 로컬 저장소에서 `npx wrangler secret put SITE_PASSWORD`를 실행하고 대화형 입력을 사용한다.

비밀번호 원문을 GitHub 코드·문서·명령행 인수에 넣지 않는다. `SITE_PASSWORD`가 없거나 8자 미만이면 자료 API는 닫혀 있고 로컬 편집만 가능하다. GitHub Actions의 배포용 토큰과 사이트 공용 비밀번호는 서로 다른 값이다.

기존 `DB` → `pp6-library-db`, `FILES` → `pp6-library-files` 바인딩을 사용한다. 최초 설정 후 첫 API 요청에서 `schema.mjs`가 `yebaeon_` 접두사의 테이블/색인만 추가한다. 기존 테이블·자료를 삭제하지 않는다. 현재는 버전 1의 추가 초기화만 제공하며, 이후 구조 변경은 별도 마이그레이션이 필요하다. DB/R2 관리 권한을 배포 토큰에 추가할 필요가 없다. R2 원본을 공개 버킷/공개 URL로 열지 않는다.

## 입장·기록 방식

- 브라우저에는 이름과 로그인 세션을 기억한다. 비밀번호를 localStorage에 저장하지 않는다.
- 세션은 Secure/HttpOnly/SameSite=Strict 쿠키이며 DB에는 임의 세션 값의 hash만 저장한다.
- 로그인 유지를 선택하면 30일, 해제하면 최대 12시간의 세션 쿠키를 쓴다. 브라우저의 세션 복원 정책에 따라 창을 닫아도 세션 쿠키가 복원될 수 있다.
- 로그아웃은 해당 세션을 폐기한다. `SITE_PASSWORD`를 새 값으로 변경하면 기존 쿠키의 서명이 맞지 않아 모두 다시 입장해야 한다.
- 이름을 변경하면 이후 버전에만 새 이름이 기록된다. 이전 기록은 보존된다.
- 같은 IP의 비밀번호 확인은 10분 구간당 8회로 제한한다. 성공하면 그 IP의 실패 기록을 비운다.
- 교회 Mac Sync도 동일한 세션 API를 사용하도록 준비했다. 실제 High Sierra 클라이언트는 다음 개발 단계다.

## 문서와 버전

문서 한 개당 최대 25MiB, UTF-8 XML인 `.pro6`를 지원한다. 상대경로를 NFC로 정규화하고 상위 경로 이동·절대경로를 거절한다. 폴더 업로드는 선택한 최상위 폴더 안의 하위 구조를 보존한다. 같은 경로·같은 내용은 중복 저장하지 않으며, 다른 내용이면 기존 문서를 열어 편집하도록 안내한다.

R2에는 받은 원본 bytes를 버전별로 보존하고, D1에는 상대경로·현재 버전·SHA-256·크기·저장자·시간을 둔다. 웹에서는 문서 이름/경로를 검색하며 본문 검색은 아직 없다. 이전 버전도 입장한 사람만 내려받을 수 있다.

저장은 기준 버전이 일치해야 확정된다. R2 업로드 후 D1의 현재 포인터 변경과 버전 행 추가를 한 트랜잭션으로 처리한다. 동시 편집이 겹치면 409로 거절하고 브라우저의 편집 내용은 유지한다. 이때 ZIP으로 보관한 뒤 최신 문서를 다시 열 수 있다. DB 확정 여부를 알 수 없는 실패에서는 원본을 지우지 않으므로, 참조되지 않는 R2 객체 정리는 추후 유지관리 항목이다.

미디어는 아직 서버에 업로드하지 않는다. 기존 Mac 미디어 경로를 유지하며, 새 미디어를 가리키는 `file:///PP6-Package/`가 들어 있으면 서버 저장을 거절한다. 성경·미디어·Playlist 업로드와 Mac 적용/백업/복원은 별도 단계다.

## API 계약

공개 편집기 파일과 `/api/health`, 입장 API를 제외한 자료 API는 유효한 쿠키가 필요하다. 변경 요청은 `Origin` 헤더가 사이트의 origin과 정확히 같아야 한다. 네이티브 Sync도 이 헤더를 설정해야 하며, CORS 우회나 R2 키 배포는 하지 않는다. JSON 오류에는 `error`와 `message`가 있다. 응답은 `Cache-Control: no-store`다.

| 요청 | 동작 |
|---|---|
| `GET /api/health` | 서비스 상태. 저장소를 읽거나 초기화하지 않음 |
| `GET /api/session` | `ready`, `authenticated`, 입장한 `name`, `expiresAt`(Unix seconds) |
| `POST /api/session` | JSON `{name,password,remember}` → 세션 쿠키 |
| `PATCH /api/session` | JSON `{name}` → 현재 세션의 이름 변경 |
| `DELETE /api/session` | 현재 세션 로그아웃 |
| `GET /api/documents?q=...&after=...` | 경로순 최대 100개, `next` 커서 |
| `POST /api/documents?path=...` | raw XML bytes 업로드. 새 문서 201, 같은 내용 200 |
| `GET /api/documents/:id` | `document` 메타데이터 |
| `PUT /api/documents/:id` | raw XML + `If-Match: "기준버전번호"` → 새 버전 |
| `GET/HEAD /api/documents/:id/content?version=N` | 원본 bytes, `X-Yebaeon-Version`, `X-Yebaeon-SHA256`; 버전 생략 시 현재본 |
| `GET /api/documents/:id/versions?before=N` | 버전 내림차순 최대 50개, `next` 커서 |

메타데이터: `id,path,name,version,updatedAt,updatedBy,sha256,size`. 시간은 UTC ISO 문자열이며 크기는 bytes다. 원본 내용 응답의 ETag는 `"N-hash"`이고, 수정 시 `If-Match`에는 메타데이터의 숫자 버전만 따옴표로 감싼 `"N"`을 보낸다. SHA-256은 원본 bytes 기준이다. 서버 버전을 semantic fingerprint로 대체하지 않는다.

주요 오류: 입장 필요 401, 출처 확인 실패 403, 같은 경로/수정 충돌 409, 크기 초과 413, 새 미디어 포함 422, 기준 버전 누락 428, 입장 시도 제한 429, 설정/저장소 문제 503. 삭제 API·자동 병합·서버의 Mac 적용 상태 기록은 아직 없다.

## GitHub 자동 배포

설정 기준은 루트 `wrangler.jsonc`다. `npm run build`는 앱 파일 10개와 응답 헤더만 `dist/`로 복사한다. 실제 자료·테스트 출력은 제외하며 예상하지 못한 파일이 있으면 빌드를 중단한다.

`.github/workflows/deploy.yml`은 `main`의 앱·서버·검사 코드 변경 시 설치 → 검사 → 기존 `yebaeon` Worker 배포를 실행한다. 문서만 수정하면 배포하지 않는다. GitHub Actions secrets의 `CLOUDFLARE_ACCOUNT_ID`, 해당 계정 `Workers Scripts:Edit` 권한의 `CLOUDFLARE_API_TOKEN`을 사용한다. 기존 Cloudflare GitHub 앱 설치와 다른 사이트 연결은 바꾸지 않는다.

## 개발·검증

Node.js 24에서 `npm ci`, `npm test`, `npm run deploy:check`를 실행한다. 마지막 명령은 실제 배포 없이 구성과 번들만 검사한다. 로컬 개발은 Git에서 제외되는 `.dev.vars`에 테스트 전용 `SITE_PASSWORD`를 두고 `npm run dev`를 사용한다. 운영 비밀번호를 테스트에 재사용하지 않는다. 교회 High Sierra에는 Node 개발 환경을 요구하지 않는다.

2026-09-30: Miniflare의 실제 Worker/D1/R2 모사 환경에서 비인증 접근, 출처 검사, 세션 만료/로그아웃/비밀번호 교체, 입장 시도 제한, XML/경로 검증, 원본 보존, 중복 업로드, 이름 변경, 동시 저장, DB 실패 시 포인터 복구, 목록/이력 페이지 이동을 검사했다. 브라우저에서도 입장 → 문서 저장/업로드 → 수정/이름 변경 → 다시 열기 → 이전 버전 다운로드를 확인했다. 운영 환경 검증과 교회 PP6 실기 왕복 검증은 별개다.

참고: [D1 트랜잭션](https://developers.cloudflare.com/d1/worker-api/d1-database/), [R2 Worker API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

2026-09-30 배포: 앱 커밋 `9a2a678`의 [GitHub Actions 검사·배포](https://github.com/m1r4d0r/yebaeon/actions/runs/36724752415)가 성공했다. 운영 사이트에 입장 화면이 표시되며, 비밀번호 설정 전 자료 API가 잠겨 있는 상태를 확인했다.

## 운영 문서 왕복 확인 — 2026-09-30

공용 비밀번호 등록 후 운영 서버에서 시험용 폴더로 37장짜리 실제 문서 복사본을 올렸다. 서버 라이브러리에서 열어 텍스트 한 곳을 수정하고 슬라이드 한 장을 이동해 버전 2로 저장했다. 새로고침 후 라이브러리에서 다시 열었을 때 수정 내용·순서·저장자·버전이 유지됐다. 기존 운영 문서와 로컬 원본은 수정하지 않았다.

두 버전을 내려받아 확인한 결과:

- 버전 1은 업로드 전 파일과 bytes/SHA-256이 같다.
- 버전 2는 37장과 모든 슬라이드 UUID를 유지한다.
- 비교 결과: 추가 0, 삭제 0, 본문 수정 1, 순서 이동 1, 기술적 변경 0.
- 수정한 텍스트 상자 한 곳 외의 RTF, 나머지 36장, 기존 미디어 경로와 문서의 다른 XML 내용이 보존됐다.

원본/편집본·파일 해시·문서 식별자가 포함된 상세 검증 기록은 집 PC에 보관하고 소스 저장소에는 넣지 않는다. 서버의 시험용 문서는 이후 Sync 연결 확인에 사용할 수 있도록 남겼다. 실제 High Sierra 수신·백업·적용·PP6 열기는 아직 검증하지 않았다.
