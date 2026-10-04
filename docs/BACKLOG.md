# 남은 일

남은 일은 여기 한 곳에서만 관리한다. 끝나면 [CHANGELOG](CHANGELOG.md)로 옮기고 여기서 지운다. 상태: 미완 / 부분 / 확인(실기·실사용만 남음) / 보류(결정 대기).

## Sync 2 (재설계안 단계 순)

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 원본 일괄 업로드 — 2,884개 완료(10-04). Mac `upload-log.tsv`의 different/rejected/failed만 확인 | 확인 |
| 1' | Sync 2 1차(받기 전용) — Mac CI 빌드·통합 검사·High Sierra 실기 | 확인 |
| 2 | 서버: 변경 일지·장치 열쇠·보관본·노드 GET/교체·usage·manifest·적용 보고, 스키마 확인 1행 — main 병합(배포 확인 전). 남음: 이미지 경로표, 미디어 가져오기 일지, 기존 자료 일지 채우기(필요 시), 일지 정리·`resync_required` | 부분 |
| 3 | Sync 2 2차: 올리기·사용일·보관본·되돌림·상주·장치 열쇠 — 구현(a732290), Mac CI·실기 남음. 남음: 새 문서 올리기, 이미지, 처음 연결 manifest 대조, 장부 이름 변동분 | 부분 |
| 4 | Studio: Mac 적용 상태·보류 표시, 교회 Mac 수정본 비교·채택, 원본 요청, 이미지 폴더 설정, 검색 색인 파일(D1 읽기 0) | 미완 |
| 5 | 교회 전환(재설계안 9.2)과 실기 확인 4가지(PP6 `~/` 경로, 종료 시 재저장 여부, 지문 불변, .pro6pl 재기록) | 확인 |
| 6 | 0.6.6 코드·inventory·sync-observations·버전별 미디어 참조 정리(승인 후) | 보류 |

흡수된 옛 과제: 업로드 이어하기, 사용일만 바뀐 문서 판정, inventory 증분, 여러 Mac 보고, 장치별 제외, ID 기반 재생목록 관리, 이관 세대·구버전 차단.

## 서버·Worker

- 이미지 보호 표시 켜기/끄기 UI (미완)
- 미참조 이미지 후보 조회·수동 정리 (미완)
- 정리본 템플릿 6종을 서버 리소스에 반영 (미완)
- 레거시 표 정리: `yebaeon_catalog_imports`, `document_usage`, `reference_cache`, R2 잔여 객체 (보류, 승인 후)
- 성경 원본 모듈·다른 번역본 (보류)

## Studio

- 사용자가 10-03 작업하며 찾은 개선점 정리 (목록 받기)
- 렌더 정밀도(제목 슬라이드·자동 글자 크기·그림자) (미완)
- 재생목록·문서 이름 변경, 복제, arrangement (미완)
- 일반 이미지 추가 마무리 (부분)
- PPT 가져오기 실파일 피드백, 모바일·Edge 실기 (확인)
- 동시 접속자 표시 (보류)

## 교회 자료

- 정리본 2,902와 Mac 2,884의 차이 기록 (확인)
- 이미지: 교회 Mac `Images`·`ImportedImages` 복사 → PC에서 `bulk-media.mjs scan/upload` → 서버 3차 뒤 `--register`. 교신 폴더는 `Images`·`ImportedImages`·`YebaeOn` 세 개 (미완)
- 삭제 5 처리, 보관 7은 마지막. 성탄절 등 보관 원본 누락 기록 (미완)
- 템플릿 6종 Mac·서버 반영, 미결 25개 카테고리 확정 (미완)
- 대표 예배를 PP6에서 확인 (미완)

## 운영·결정

- **공개 저장소 노출**: `church-resources/`의 개역개정 본문·교회 이미지·폰트 원본, 공개 릴리스의 정리 ZIP. private 전환 시점 (보류, 결정 필요)
- 운영 D1 실측 (미완). 자동 검사가 운영 DB를 치지 않도록 운영 바인딩을 검사 환경에서 제외 (미완)
- Cloudflare Git 연결과 Actions 배포 중복 확인 (미완)
- Sync 설치본 영구 보관(Actions artifact 만료) (미완)
- Dropbox 실제 계정 연결 (확인)
- 원격 브랜치 35개 정리, workflow 트리거의 옛 브랜치명(`studio.yml`, `sync.yml`), `.gitignore`에 `/artifacts/` (미완)

## 문서

- 「예배온-저장소-문서정리안」대로 docs 재구성: rules/·design/·guides/·archive/, AGENTS.md 슬림화, README 4개 현행화, `build-dev-bundle.py`의 문서 경로 의존 처리 (미완)
- 재설계안 확정 시 `docs/design/sync.md`로 옮기고 Sync 인계 문서를 archive로 (미완)
