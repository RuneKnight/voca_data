# ⚡ Language Hub (voca_data)

> **Google Sheets를 헤드리스 CMS로 활용하는 반응형 다국어(영어·독일어) 플래시카드 & 문장 학습 웹 애플리케이션**

별도의 백엔드 서버나 데이터베이스 구축 없이, **Google 스프레드시트**에 단어와 문장을 입력하면 실시간 웹으로 동기화되어 학습할 수 있는 가볍고 직관적인 어학 학습 플랫폼입니다.

---

## 📌 주요 특징 (Key Features)

- 🔄 **서버리스 실시간 동기화**: Google Sheets 웹 게시(CSV) 링크를 통해 시트 수정 내용이 웹에 즉시 반영
- 🗂️ **듀얼 뷰 모드 지원**:
  - **단어 카드(Flashcard)**: 3D 인터랙티브 카드 플립(Flip) 애니메이션으로 단어/품사 앞면 ↔ 뜻/예문 뒷면 토글
  - **학습 문장(Sentences)**: 예문 원문, 번역, CEFR 레벨, 핵심 포인트(Key Point)를 일목요연하게 확인
- 🌐 **다국어 지원 & 필터링**: 전체, 🇬🇧 영어(English), 🇩🇪 독일어(Deutsch) 언어별 원클릭 필터
- 🔍 **실시간 통합 검색**: 단어, 뜻, 문장, 번역 등 다중 필드를 아우르는 즉각적인 검색
- 📱 **반응형 디자인**: Tailwind CSS 기반 모바일, 태블릿, 데스크톱 완벽 대응
- ⚡ **경량성 & zero-build**: 번들러나 빌드 과정 없이 `index.html` 단일 파일로 즉시 실행 가능

---

## 🛠 기술 스택 (Tech Stack)

| 구분 | 기술 | 설명 |
| :--- | :--- | :--- |
| **Frontend** | HTML5, Vanilla JavaScript (ES6+) | 가볍고 빠른 네이티브 돔 조작 |
| **Styling** | [Tailwind CSS (CDN)](https://tailwindcss.com/) | 유틸리티 퍼스트 반응형 스타일링 |
| **Data Parser** | [PapaParse](https://www.papaparse.com/) | 브라우저 내 강력한 CSV 스트리밍 및 파싱 |
| **Data Source** | Google Sheets (Published CSV) | 무료 헤드리스 CMS 데이터 저장소 |

---

## 📊 데이터 구조 및 스키마 (Google Sheets Schema)

본 프로젝트는 2개의 구글 시트 탭(단어 탭 / 문장 탭)의 CSV 발행 링크를 연동하여 동작합니다.

### 1. 단어 시트 (`VOCAB_CSV_URL` / Gid: 0)

| 컬럼명 | 타입 | 설명 | 예시 |
| :--- | :--- | :--- | :--- |
| `Language` | String | 학습 언어 (`English` 또는 `German`) | `German` |
| `Level` | String | CEFR 난이도 레벨 | `B1` |
| `Part of Speech / Gender` | String | 품사 또는 성별(독일어 der/die/das 등) | `n. (das)` |
| `Word/Phrase` | String | 단어 또는 숙어 표현 (카드 앞면) | `die Entscheidung` |
| `Meaning` | String | 한글 의미 (카드 뒷면) | `결정, 결단` |
| `Collocation / Example` | String | 연어 또는 짧은 예문 (카드 뒷면) | `eine Entscheidung treffen` |

### 2. 문장 시트 (`SENTENCE_CSV_URL` / Gid: 765046051)

| 컬럼명 | 타입 | 설명 | 예시 |
| :--- | :--- | :--- | :--- |
| `Language` | String | 학습 언어 (`English` 또는 `German`) | `English` |
| `Level` | String | CEFR 난이도 레벨 | `B2` |
| `Date` | String | 학습 일자 | `2026-03-10` |
| `Sentence` | String | 원문 문장 | `I have butterflies in my stomach.` |
| `Translation` | String | 한국어 번역 | `가슴이 두근거리고 긴장돼.` |
| `Key Points` | String | 문법 포인트, 숙어 해설 등 핵심 메모 | `butterflies in one's stomach: 긴장되다` |

---

## 🚀 빠른 시작 (Getting Started)

### 1. 로컬에서 실행
별도의 `npm install`이나 빌드가 필요 없습니다. 브라우저에서 바로 열거나 로컬 웹 서버로 엽니다.

```bash
# 저장소 클론
git clone https://github.com/<your-username>/voca_data.git
cd voca_data

# Python 간이 서버 실행 (옵션)
python3 -m http.server 8080
```
브라우저에서 `http://localhost:8080` 접속

### 2. 본인의 구글 시트로 변경하는 법
1. Google Sheets에서 단어/문장 시트 생성 (위 컬럼 구조 준수)
2. **[파일] → [공유] → [웹에 게시]** 선택
3. 게시 형식으로 **쉼표로 구분된 값(.csv)** 선택 후 게시 링크 복사
4. `index.html` 파일 65~66행의 상수를 본인 시트 URL로 교체:
   ```javascript
   const VOCAB_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/.../pub?gid=0&single=true&output=csv';
   const SENTENCE_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/.../pub?gid=...&single=true&output=csv';
   ```

---

## 🌐 무료 배포 가이드 (GitHub Pages)

1. GitHub 저장소의 **Settings**로 이동
2. 좌측 메뉴 **Pages** 클릭
3. **Build and deployment** > **Source**를 `Deploy from a branch`로 설정
4. **Branch**를 `main` (또는 `master`), 폴더를 `/ (root)`로 선택하고 **Save**
5. 1~2분 후 생성되는 `https://<username>.github.io/voca_data/` 링크로 접속

---

## 🗺️ 향후 개선 로드맵 (Roadmap)

- [x] **Web Speech API (TTS)**: 단어, 예문, 문장 발음 음성 재생 (영어 `en-US` / 독일어 `de-DE` 음성 자동 분기 & 무과금)
- [ ] **오프라인 캐싱 (IndexedDB / LocalStorage)**: 네트워크 단절 시에도 기존 데이터로 학습 유지
- [ ] **학습 모드 강화**:
  - 오답 노트 및 즐겨찾기(북마크)
  - 암기 완료 단어 숨기기 체크박스
  - 단어 셔플(랜덤 섞기) 및 퀴즈 모드
- [ ] **UI/UX 고도화**:
  - 다크 모드 지원
  - 카드 일괄 뒤집기 토글 버튼
  - 로딩 스켈레톤 및 데이터 갱신 타임스탬프 표시
- [ ] **XSS 보안 강화**: 사용자 정의 시트 입력값 HTML 이스케이프 처리
