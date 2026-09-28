# 프로젝트 검토 / 집·교회 작업 분담

검토일: 2026-09-28. 현재 위치: 집 Windows PC.

서버 범위 정정: 사용자는 전체 `.pro6`·성경 자료·사용 미디어 업로드를 계획하고 있습니다. 기존의 “서버는 마지막에 package만 전달”이라는 범위는 수정했습니다. [서버 기획과 서비스 비교](SERVER-PLAN.md)를 최신 기준으로 사용하며, 집에서 클라우드 라이브러리 개발을 병행합니다.

추가 진행: 웹 편집기에 아리따부리·나눔고딕·나눔명조 CDN 연결을 넣고 실제 로딩, 원래 RTF 이름 보존, 오프라인 대체를 확인했습니다. 나눔명조 옛한글은 일반 나눔명조 웹폰트로 대체 표시합니다. [출처/매핑](web-editor/FONT-SOURCES.md).

추가 수신: 상위 폴더의 `PP6-Original-Source-Assets`에서 이미지 `1000035313.jpg`, `찬양-PPT_4.jpg`, 영상 `glasscandles3_720p.mov`와 원본 documents/playlists/inventory를 확인했습니다. 미디어 3개의 참조 이름과 문서 2개의 SHA-256 일치를 확인했습니다. 아래 수집 목록 중 이 3개는 확보 완료입니다. 앱의 로컬 file:// 탭 제어 제한으로 열린 사용자 화면에서 미디어 연결은 아직 수행하지 않았습니다.

검토 대상은 이 폴더의 Core v0.2 소스와 실제 문서 pair입니다. Git 이력과 기존 `PP6 Playlist Sync.app` 소스는 이 패키지에 없습니다. 따라서 기존 앱 전체를 검증한 것은 아닙니다.

## 결론

집에서 썸네일을 렌더하는 것은 유용합니다. `.pro6` 해석, 화면 배치, 한글 표시, 미디어 연결, 편집 사용성을 지금 검증할 수 있습니다. Mac의 AppKit/AVFoundation 렌더와 PP6 화면의 정확한 일치는 교회 실기에서 검증합니다. 웹 편집기는 그 검증을 기다리지 않고 병행할 수 있습니다.

## 현재 확인한 상태

| 영역 | 상태 | 확인 수준 |
|---|---|---|
| 문서/media index, 파일 비교 | Objective-C 구현 있음 | Windows에서 소스 검토, High Sierra 빌드 미실행 |
| PC reference comparator | 실행 확인 | 기존 실제 pair `14 / 32 / 2 / 0 / 11` 재현 |
| HTML diff viewer | 구현 있음 | 기존 비교 JSON 표시용 |
| Mac thumbnail | 실험 코드 있음 | Cocoa/AVFoundation 의존; Windows 직접 실행 불가 |
| 로컬 웹 편집기 | 이번에 첫 버전 구현 | Windows Edge 기능/화면 검증 |
| Documents/media 적용·복원 | 미구현 | 백업, 경로 rewrite, 재검증, rollback 필요 |
| Playlist 통합 / 서버 | 미구현 | 기존 앱 소스 별도 필요 / 클라우드 라이브러리는 집에서 병행 |

이번 웹 편집기: 파일 열기, 근사 썸네일, 텍스트 수정, 기존 장을 바탕으로 새 장 추가/복사, 그룹 간 이동/정렬, 삭제/되돌리기, 미디어 연결/교체, PNG와 업데이트 ZIP 저장.

이번 검증: 37장 샘플에서 39장 테스트 문서를 생성해 ZIP CRC, XML 파싱, UUID 중복 없음, 한글·이모지, 포함 미디어 참조, 편집 결과 `추가 2 / 수정 1`을 확인했습니다. 테스트 문서를 PP6에서 여는 검증은 남아 있습니다.

## 실제 적용 전에 해결할 발견 사항

1. **RTF 글꼴·크기·색상만 바꾼 수정이 누락됩니다.** `PP6Core.m`의 `PP6ParseTextElement`와 Python `parse_text_element`는 텍스트와 XML 외부 스타일을 해시하지만 RTF의 run 서식을 포함하지 않습니다. 실제 샘플의 `\\fs180`을 바꿔도 Python semantic 값이 같음을 재현했습니다. Mac은 같은 구조임을 소스로 확인했습니다. 적용 대상에서 빠질 수 있으므로 Core의 의미 있는 서식 표현을 보강해야 합니다.
2. **그룹 전체 추가·삭제의 상세 목록이 빠집니다.** 두 comparator 모두 매칭하지 못한 그룹은 합계만 더합니다. 그룹 15장 추가 실험에서 `added=15`이나 상세 added 행은 0개였습니다. Viewer는 요약 숫자만 보여 줄 수 있습니다. 그룹 단위 상세 보고와 그룹 이동 정의를 추가해야 합니다.
3. **Mac comparator가 parseError를 실패 상태로 처리하지 않습니다.** `pp6-doc-compare.m`에서 `PP6ParseDocument`의 오류를 검사하지 않고 added/modified 판정으로 진행합니다. 잘못된 문서는 적용 후보에서 제외하는 명시적 오류 상태가 필요합니다. 루트 타입 검사와 incoming 쪽 NFC 경로 충돌 검사도 필요합니다.
4. **미디어 resolver와 명세 우선순위가 다릅니다.** 명세는 관리 폴더의 유일 후보를 먼저 찾지만 구현은 관리 폴더와 package 후보를 합쳐 하나일 때만 해결합니다. 동일 파일명이 양쪽에 있을 때 의도한 정책과 내용 hash 검증을 확정해야 합니다.
5. **Mac 썸네일은 PP6 전체 렌더러가 아닙니다.** 지금은 고정 aspect-fill, 미디어 후 텍스트 그리기이며 다양한 정렬·효과·배경 지속·자동 크기 조정 등을 재현하지 않습니다. High Sierra 빌드 성공만으로 화면 일치로 판단하지 않습니다.

Python과 Mac의 fingerprint 문자열 자체도 현재 직렬화 형식이 다릅니다. 두 플랫폼 검증은 우선 판정·상세 결과를 대조하고, 공유 manifest hash로 쓰려면 canonical 표현을 별도로 통일해야 합니다.

웹 export에 필요한 Unicode RTF 판독은 이번에 Python reference에 보강했습니다. 기존 샘플의 전체 group diff와 요약이 보존됨을 확인했습니다. 위 나머지 Core 보완 사항은 아직 해결 완료로 표시하지 않습니다.

## 장소별 다음 순서

| 순서 | 집 Windows에서 | 교회 High Sierra에서 |
|---|---|---|
| 1 · 지금 | 웹 편집기 보완, 클라우드 문서 업로드/목록/저장, 사용 미디어·성경 자료 연결 | 다음 방문 전까지 개발 가능 |
| 2 · 기준 만들기 | 비교기 누락 사례 회귀 테스트, RTF 서식 보존 개선 | Core 빌드 → pair 비교 → 실제 index 저장 |
| 3 · 화면 대조 | 웹 PNG와 차이를 바탕으로 렌더 보정 | 수정본 1/2/23/24장 PP6 화면 + 네이티브 PNG 수집 |
| 4 · 내보내기 검증 | ZIP·문서·미디어 상대경로 검증 | 임시 문서/미디어 위치에서 export 파일 열기·다시 저장·재비교 |
| 5 · 실제 적용 | 적용 계획/충돌 정책/테스트 설계 | PP6 종료 확인, 백업, media 설치/rewrite, atomic replace, verify, 실패 복원 |
| 6 · 통합 | 기존 앱 소스 확보 후 Documents UI/Playlist 통합 | 운영 동선 시험, 복원 실험 |
| 7 · 동기화 통합 | 편집 버전·변경분 전달·충돌 처리 | 수신/적용 확인, 교회 변경본 업로드 |

## 다음 교회 방문에서 가져올 것

- Core 빌드 결과/오류 기록, `test-pair/document-diff.json`, 실제 `pp6-index-v0.2.json`.
- 수정본 슬라이드 1/2/23/24의 PP6 캡처 또는 PP6 자체 이미지 export, Mac thumbnail 결과.
- 이미지 `1000035313.jpg`, `KakaoTalk_Image_2026-03-29-10-23-52_006.png`, `KakaoTalk_Image_2026-03-29-10-23-53_007.png`, `찬양-PPT_4.jpg`, `찬양-PPT_2 2.jpg`.
- 영상 `glasscandles3_720p.mov`, PSD `KakaoTalk_Image_2026-01-03-19-13-10_009.psd`. PSD 웹 미리보기는 별도 변환/지원이 필요합니다.
- 사용 글꼴 정보: `Arita-buri-Medium_OTF`, `NanumGothicOTF`, `NanumMyeongjoOTF-YetHangul`. 집에는 Windows에서 사용할 수 있는 대응 글꼴을 준비합니다.

대용량 전체 media 폴더보다 위 대표 사례부터 가져오면 화면 대조를 시작할 수 있습니다.
