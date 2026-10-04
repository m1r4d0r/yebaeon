# 예배온 · YebaeOn

집에서 예배 자료를 준비하고 교회 Mac의 ProPresenter 6와 연결하는 프로젝트다. 웹은 **예배온 Studio**, 교회 Mac 앱은 **예배온 Sync 2**다.

[예배온 Studio](https://yebaeon.grace-jean-p.workers.dev/) · [지금 상태](docs/STATUS.md) · [남은 일](docs/BACKLOG.md) · [문서 색인](docs/README.md)

## 흐름

어디서든 브라우저로 예배 순서와 문서를 편집하면 서버(Cloudflare Worker + D1 + R2)가 정본을 갖는다. 교회 Mac의 Sync 2는 예배 전에 서버 변경분을 받아 PP6가 열 파일을 쓰고, Mac에서 고친 것은 올린다. 상세는 [구성·코드 위치](docs/design/architecture.md)와 [Sync 규약](docs/design/sync.md).

## 폴더

| 폴더 | 내용 |
|---|---|
| [web-editor/](web-editor/README.md) | Studio (정적 HTML·JS·CSS) |
| [cloudflare/](cloudflare/README.md) | Worker, API, 스키마 |
| [mac-sync2/](mac-sync2/README.md) | 예배온 Sync 2 (High Sierra 10.13, 기본 AppKit) |
| [mac-sync/](mac-sync/README.md) | Sync 2가 빌드에 쓰는 엔진 소스 |
| [mac-app/](mac-app/README.md) | Sync 0.6.6. 쓰지 않으며 삭제 예정 |
| [church-resources/](church-resources/README.md) | 배포용 폰트·템플릿·개역개정·이미지 |
| `scripts/`, `tests/` | 배포 빌드와 Worker·브라우저 검사 |
| [docs/](docs/README.md) | 상태·규칙·설계·안내·보관 |

## 개발

Node.js 24. 저장소 루트에서 `npm ci`, `npm test`(Miniflare 모사 Worker 검사), `npm run deploy:check`. main에 앱·서버·검사 코드가 올라가면 Actions가 검사 후 배포한다. Mac 빌드는 [mac-sync2/README.md](mac-sync2/README.md).

## 자료

공개 저장소다. 교회 원본(.pro6·.pro6pl·ZIP), 진단 자료, 인증 정보는 넣지 않는다. 서버 자료는 공용 비밀번호로 입장해야 읽고 쓸 수 있다.
