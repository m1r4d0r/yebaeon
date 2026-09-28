# 미리보기 웹폰트

2026-09-28에 아래 공개 배포 주소를 확인했습니다. 글꼴 파일을 저장소에 복제하지 않고 브라우저에서 고정된 CDN URL로 읽습니다. 사용하는 굵기만 요청하며, 글꼴이 준비된 뒤 Canvas 썸네일/PNG를 렌더합니다. 6초 이상 지연되거나 연결이 실패하면 설치된 글꼴 또는 대체 글꼴을 사용합니다. 늦게 로딩이 완료되면 다시 그립니다.

| 문서 내부 이름 예시 | 미리보기 글꼴 | 제공처 |
|---|---|---|
| `Arita-buri-Medium_OTF` | 아리따부리 (Medium 500 / Bold 700 등) | jsDelivr `@bepyan/arita@1.0.1` |
| `NanumGothicOTF` | 나눔고딕 (400 / 700 / 800) | Google Fonts v26 |
| `NanumMyeongjoOTF-YetHangul` | 일반 나눔명조 (400 / 700 / 800) | Google Fonts v31 |

`옛한글`판과 일반 나눔명조는 같은 파일이 아닙니다. 해당 대체는 편집기 글꼴 상태에 표시합니다. 옛한글 글리프와 Mac 설치 버전의 완전한 일치는 별도 확인이 필요합니다. 기존 이름의 굵기 접미사와 RTF bold 값을 함께 반영합니다. Coding/Eco 등 다른 나눔 계열은 이 세 글꼴로 자동 치환하지 않습니다.

이 매핑은 브라우저 미리보기용입니다. 내보내는 `.pro6`의 폰트 이름은 그대로 유지되며, 웹폰트 파일을 ZIP에 넣거나 시스템에 설치하지 않습니다. 교회 Mac에서는 해당 Mac 글꼴이 필요합니다.

문서나 미디어, 텍스트 내용을 CDN에 보내지 않습니다. `fonts.css`의 고정 글꼴 주소만 요청하며 텍스트를 쿼리에 넣는 subsetting API는 사용하지 않습니다. 요청 자체에 필요한 일반 네트워크 정보는 CDN에 전달됩니다. 이전 버전의 “외부 요청 없음” 검사는 “허용된 고정 글꼴 GET 요청만 있음”으로 변경했습니다.

## 출처와 저작권

- 아리따부리 저작권: AMOREPACIFIC. [공식 글꼴 안내](https://design.amorepacific.com/arita/). [배포자 문서](https://arita.bepyan.me/), [사용한 CSS](https://cdn.jsdelivr.net/npm/@bepyan/arita@1.0.1/dist/static/arita-buri.css), [배포자 이용 안내](https://cdn.jsdelivr.net/npm/@bepyan/arita@1.0.1/LICENSE). jsDelivr의 이 패키지는 비공식 웹폰트 배포본입니다.
- 나눔 글꼴 저작권: NHN Corporation. SIL Open Font License 1.1. [Google Fonts 라이선스](https://github.com/google/fonts/blob/main/ofl/nanumgothic/OFL.txt). 파일 주소는 [나눔고딕 제공 CSS](https://fonts.googleapis.com/earlyaccess/nanumgothic.css)와 [나눔명조 제공 CSS](https://fonts.googleapis.com/earlyaccess/nanummyeongjo.css)에서 확인했습니다.

실제 주소와 굵기는 `fonts.css`, 이름 매핑/로딩 상태는 `fonts.js`에서 관리합니다.
