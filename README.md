# 예배온 · YebaeOn

집에서 예배 자료를 준비하고 교회 Mac과 연결하는 프로젝트입니다. 웹 편집기는 **예배온 Studio**, Mac 도구는 **예배온 Sync**입니다.

[예배온 Studio 열기](https://yebaeon.grace-jean-p.workers.dev/) · [작업 현황·새 세션 인수인계](docs/SESSION-HANDOFF.md) · [교회 확인 순서](docs/CHURCH-TEST.md) · [남은 단계](docs/NEXT-STAGE.md) · [문서 모음](docs/README.md)

## 현재 상태

- 웹: 문서 열기, 근사 썸네일, 텍스트 수정, 슬라이드 추가·복사·정렬, 미디어 교체, PNG·ZIP 저장을 지원합니다.
- 배포: GitHub `main`의 앱·배포 파일 변경을 검사한 뒤 Cloudflare에 자동 반영합니다.
- 서버: 공용 비밀번호·작업자 이름 입장, `.pro6` 파일/폴더 업로드, 경로 검색, 편집·버전 저장, 작업자 이력과 이전 원본 다운로드를 구현했습니다. 운영 시 `SITE_PASSWORD` 등록이 필요합니다.
- 기본 작업 흐름: **서버 플레이리스트 선택 → 안의 문서 편집 → Mac에서 해당 플레이리스트 동기화**입니다. 서버·웹·Mac을 연결했고 합성 자료 자동 검사를 통과했습니다. [구현과 완료 기준](docs/PLAYLIST-WORKFLOW.md).
- Mac: 기존 Native v0.2 앱에 서버 재생목록·문서·미디어·로컬 비교를 통합한 **예배온 Sync 0.4.0**을 추가했습니다. 문서 서버 송수신·백업·복원과 미디어 연결 점검을 같은 창에서 사용합니다. [통합 앱 안내](mac-app/README.md). 시작 시 자동 비교와 로컬·서버 기록을 추가했습니다. 미디어 전체 송수신은 다음 범위입니다.
- 교회 검증: Sync 연결 후 시험 문서로 서버 왕복과 PP6 화면 대조를 확인합니다. 기존 빌드·비교 검사를 매번 반복하는 과제로 두지 않습니다. 최신 Mac CI와 별도로 High Sierra·운영 서버 연결·PP6 열기/저장은 교회에서 확인해야 합니다.

## 폴더 안내

| 폴더 | 내용 |
|---|---|
| [web-editor/](web-editor/README.md) | 웹 편집기와 글꼴·렌더링 |
| [cloudflare/](cloudflare/README.md) | 서버 진입점과 배포 안내 |
| [mac-app/](mac-app/README.md) | 기존 앱을 기반으로 통합한 예배온 Sync와 앱 빌드 |
| [mac-sync/](mac-sync/README.md) | 문서 동기화·백업·복원, Core 도구, 썸네일 실험 |
| [tools/](tools/README.md) | Python 기준 비교기와 비교 결과 뷰어 |
| [tests/](tests/) | 서버·배포·Python 회귀 검사 |
| [scripts/](scripts/) | 공개할 웹 파일을 선별하는 빌드 도구 |
| [docs/](docs/README.md) | 기획·명세·작업 안내. 과거 기록은 `docs/archive/` |

루트에는 이 안내와 개발·배포 설정만 둡니다. GitHub 자동화는 `.github/`에 있습니다.

## 집 Windows에서 개발

Node.js 24를 사용합니다. 저장소 루트에서:

```text
npm ci
npm test
npm run deploy:check
```

`deploy:check`는 실제 업로드 없이 배포 구성을 검사합니다. 편집기는 위 사이트 또는 `web-editor/index.html`에서 열 수 있습니다. [사용법과 제한](web-editor/README.md).

Python 비교 검사는 `python tests/test-reference.py`로 실행합니다. Mac 빌드·실행은 [예배온 Sync 안내](mac-sync/README.md)를 따릅니다.

## 소스와 실제 자료

[비공개 GitHub 저장소](https://github.com/m1r4d0r/yebaeon)의 기본 브랜치는 `main`입니다. 소스·문서, 안내용 예제 3장과 서버 배포를 위해 선별한 교회 자료를 포함합니다.

원본 `.pro6` 문서 ZIP·성경 등록 정보·원본 폰트 ZIP·전체 미디어·파일 목록, `test-pair/`, `web-editor/sample-data.js`, 테스트 출력물과 인증 정보는 Git에서 제외합니다. 기존 자료는 집 PC에 보존합니다. 실제 자료가 필요한 검사는 자료가 없는 클론에서 건너뜁니다.

내 파일 열기·미디어 연결·ZIP 생성은 브라우저 안에서 처리합니다. 문서 올리기·서버에 저장을 선택한 `.pro6`와 작업자 이름은 Cloudflare의 공유 라이브러리에 저장합니다. 자료 읽기/수정은 공용 비밀번호로 입장해야 합니다. 선별 폰트 30종, 템플릿 37개 파일의 196개 슬라이드, 개역개정 31,103절, 금요예배 이미지 20개는 `church-resources/`에서 배포합니다. `/resources/*`는 Worker가 로그인 상태를 확인한 뒤 제공하며 공용 비밀번호가 필요합니다. 등록 정보는 포함하지 않습니다. `/status.html`에서 실제 문서 수와 Sync 연결·비교 요청 시각을 10초 간격으로 확인합니다. [저장 범위와 서버 기획](docs/SERVER-PLAN.md).
