# 예배온 · YebaeOn

2026-09-28 사용자 승인으로 확정한 프로젝트 이름이다.

| 구분 | 이름 | 역할 |
|---|---|---|
| 전체 프로젝트 | 예배온 / YebaeOn | 집에서 예배 자료를 준비하고 교회와 연결 |
| 웹 | 예배온 Studio / YebaeOn Studio | 문서·성경·미디어 관리와 슬라이드 편집 |
| Mac | 예배온 Sync / YebaeOn Sync | 교회 파일 비교·백업·적용·동기화 |
| GitHub 저장소 | [m1r4d0r/yebaeon](https://github.com/m1r4d0r/yebaeon) | 비공개 소스 저장소, 기본 브랜치 `main` |
| Cloudflare Worker | `yebaeon` | 기존 `pp6-workshop`에서 이름 변경 완료 |

대표 문구: **예배 자료를 준비하는 공간**

표시 이름은 `예배온 Studio`와 `예배온 Sync`, 영문 표기는 `YebaeOn`, 주소·저장소 식별자는 소문자 `yebaeon`으로 통일한다. 웹 상단의 간단한 문자 표시는 `ON`을 사용한다.

## 주소와 기존 저장소

- 기존 Worker 주소: https://pp6-workshop.grace-jean-p.workers.dev/
- 변경된 주소: https://yebaeon.grace-jean-p.workers.dev/
- 계정 주소의 `grace-jean-p`는 유지한다. 기존 Worker 자체의 이름만 변경한다.
- R2 `pp6-library-files`와 D1 `pp6-library-db`, 연결 이름 `FILES`와 `DB`는 그대로 사용한다.
- [배포 설정](wrangler.jsonc)의 `name`은 원격 Worker 이름과 일치한다. [최초 연결 기록](cloudflare/wrangler.bindings.jsonc)은 참고 자료로 유지한다.
- 2026-09-28 Cloudflare의 `Settings → General → Name`에서 `yebaeon`으로 이름을 변경했다. 2026-09-29 같은 주소에 예배온 Studio를 배포하고 GitHub Actions 자동 배포를 연결했다. `DB`·`FILES` 연결은 유지한다. [배포 구성](cloudflare/README.md).

Worker의 이름은 `workers.dev` 주소에 사용된다. [Cloudflare 공식 설명](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

## 로컬 반영 범위

웹 제목·상단 이름·업데이트 패키지 안내문과 프로젝트 문서에 새 이름을 적용했다. Mac Core 빌드 안내에는 `YebaeOn Sync`를 표시한다.

기존 개발 폴더, PP6 파일 형식·실행 파일 이름·백업 경로는 유지한다. 이 패키지에는 기존 `PP6 Playlist Sync.app`의 앱 소스가 없으므로 실제 Mac 앱의 표시 이름·아이콘 변경은 해당 소스 통합 시 진행한다. 위 역할 설명에는 앞으로 구현할 기능도 포함되어 있으며, 실제 구현 상태는 [남은 단계](NEXT-STAGE.md)를 따른다.
