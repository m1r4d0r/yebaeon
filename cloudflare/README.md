# 예배온 Studio 배포

사이트: https://yebaeon.grace-jean-p.workers.dev/

현재 공개 범위는 편집기와 안내용 예제 3장이다. 문서·미디어는 사용자의 브라우저에서 처리하고, 클라우드 로그인·자료 저장 API는 다음 단계로 개발한다.

## 구성

- 배포 설정의 기준은 저장소 루트 `wrangler.jsonc`다.
- `npm run build`는 명시한 앱 파일 9개와 응답 헤더만 `dist/`로 복사한다. 실제 자료·테스트 출력·문서는 복사하지 않는다. `dist/`에 예상하지 못한 파일이 있으면 빌드를 중단한다.
- `cloudflare/worker.mjs`는 `/api/health` 확인만 제공한다. 다른 `/api` 요청은 404로 응답한다. 이 단계에서는 DB·R2 내용을 읽거나 변경하지 않는다.
- 기존 `DB` → `pp6-library-db`, `FILES` → `pp6-library-files`를 유지한다.
- `wrangler.bindings.jsonc`는 최초 연결을 기록한 참고 자료다. 실제 배포는 루트 설정을 사용한다.

## GitHub 자동 배포

`.github/workflows/deploy.yml`이 `main`의 앱·배포 파일 변경을 감지한다. 의존성 설치 → 검사 → 허용한 정적 파일 구성 → 기존 `yebaeon` Worker에 배포한다. 문서만 수정하면 자동 배포하지 않는다. GitHub의 Actions에서 수동 실행도 가능하다.

GitHub 저장소 Actions secrets에 다음 두 값을 등록한다. 토큰 원문은 소스·문서·로그에 기록하지 않는다.

- `CLOUDFLARE_ACCOUNT_ID`: 예배온 Worker가 있는 계정.
- `CLOUDFLARE_API_TOKEN`: 해당 계정의 `Workers Scripts:Edit` 권한으로 만든 `YebaeOn GitHub Actions Deploy` 토큰.

Cloudflare의 기존 GitHub 앱 설치를 해제하거나 다른 사이트의 연결을 바꾸지 않기 위해 저장소의 GitHub Actions에서 배포한다.

## 집 Windows 개발

Node.js 24에서:

```text
npm ci
npm test
npm run deploy:check
```

`deploy:check`는 실제 업로드 없이 구성과 번들만 검사한다. 직접 배포가 필요하면 해당 Cloudflare 계정에 인증한 뒤 `npm run deploy`를 사용한다. 토큰을 명령행 인수나 파일에 넣지 않는다.

교회 High Sierra에서는 이 Node 개발 환경을 요구하지 않는다. Mac Core 빌드·PP6 실기 검증은 기존 절차를 따른다.

참고: [Workers 정적 파일](https://developers.cloudflare.com/workers/static-assets/binding/), [GitHub Actions 배포](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
