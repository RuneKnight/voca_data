# ⚡ Language Hub Pro (`voca_data`)

> **GitHub Repo JSON + Gemini 2-Track AI 자동화 기반 반응형 다국어(영어·독일어) 플래시카드, 병렬 문장 & 퀴즈 학습 웹 애플리케이션**

별도의 백엔드 서버나 프론트엔드 빌드 없이, **GitHub 저장소의 구조화된 JSON(`data/*.json`)**과 **Gemini AI 자동 생성 파이프라인**으로 영어(`A2-B1`)와 독일어(`B1-B2`)를 함께 학습할 수 있는 경량 Zero-Build 어학 학습 플랫폼입니다. (기존 Google Sheets GViz 폴백도 100% 하위 호환으로 유지됩니다.)

---

## 📌 주요 특징 (Key Features)

### 1. 학습 뷰 & 인지과학 기반 기능
- 🗂️ **단어 카드 (`vocab`)**: 3D 인터랙티브 **카드형 / 리스트형** 레이아웃 전환, 독일어 관사(`der` 파랑 / `die` 로즈 / `das` 에메랄드) 컬러 코딩 및 **복수형(`Pl.`)** 표기
- 🔄 **학습 문장 (`sentence`) & 영↔독 병렬 비교 뷰**:
  - `<details>` 기반 3초 능동 인출(Active Recall) 해석/Key Point 토글
  - `[📄 목록 | 🔄 병렬]` 전환으로 동일 주제의 영어(`A2-B1`)와 독일어(`B1-B2`) 문장을 나란히 비교 학습
  - 문장 하단 **🔗 핵심 단어 칩** 클릭 시 뜻·품사·복수형·발음·북마크 팝오버 즉시 확인
- 🎯 **4종 퀴즈 모드 & 오답 노트 (`quiz`)**:
  - **📖 단어 퀴즈** / **💬 문장 퀴즈** (외국어→한국어 & 한국어→외국어 역방향 지원)
  - **🧩 빈칸 채우기(Cloze) 퀴즈** / **🇩🇪 독일어 관사(`der`/`die`/`das`) 퀴즈**
  - 출제 범위 필터(언어, 미암기, ⭐ 즐겨찾기, ✨ New, 📅 오늘 복습) + 진행률 바 + **📝 오답 노트 & 틀린 문제만 다시 풀기**
- 📅 **옵트인 간격 반복(Leitner 5-Box SRS) & 📊 학습 통계 대시보드**:
  - 카드 뒷면의 `다시 / 보통 / 쉬움` 피드백 및 퀴즈 결과에 따라 복습 주기(1→3→7→14→30일) 자동 계산
  - 언어별 암기율 프로그레스 바 및 연속 학습일(Streak) 대시보드

### 2. 탐색·음성·디바이스 최적화
- 🔍 **다차원 필터 & Fisher-Yates 셔플**: 언어, 품사, 동적 CEFR 범위 레벨(`A2`, `A2-B1`, `B1-B2`), 주제 태그(`#dev`, `#daily`, `#cycling` 등), New, 즐겨찾기, 오늘 복습, 학습 완료 숨기기, 정렬(최신순/오래된순/알파벳순), 디바운스 검색, 페이지 이동 간 순서가 유지되는 Fisher-Yates 셔플(+ 다시 섞기)
- 🔊 **강화된 Web Speech API TTS**: 발음 속도 선택(`0.75x` / `0.9x` / `1.0x` / `1.2x`), 언어별 고품질 음성 자동 매칭, 현재 페이지 **연속 듣기(쉐도잉 모드)**
- 🖋️ **전자잉크(E-Ink) 최적화 & 키보드/리모컨 단축키**:
  - 고대비 흑백(배경 `#fff`, 텍스트 `#000`), 무애니메이션, 즉시 스크롤(`behavior: 'instant'`)로 잔상(Ghosting) 방지
  - `←`/`→` 페이지 이동(블루투스 페이지 터너 호환), `Space` 전체 뒤집기, `1~4` 퀴즈 선택, `Enter` 다음 문제, `S` 발음 듣기, `/` 검색 포커스
- 🌙 **다크 모드 & 📱 PWA 오프라인 지원**: `manifest.json` + Service Worker(`sw.js`)로 모바일 홈 화면 설치 및 오프라인 학습 지원
- 💾 **학습 기록 백업/복원**: 북마크·암기·SRS·학습 로그 JSON 내보내기 및 병합/덮어쓰기 복원 (기존 `localStorage` 키 `vh_*` 100% 하위 호환)

---

## 🤖 GitHub Repo JSON + 2-Track Gemini AI 자동화

### Track 1: 완전 무인 매일 자동 생성 (GitHub Actions + Gemini API)
- 워크플로우: [`.github/workflows/daily-generate.yml`](.github/workflows/daily-generate.yml) + [`scripts/generate-daily.mjs`](scripts/generate-daily.mjs)
- 매일 오전 8시(KST) 또는 GitHub Actions **Run workflow** 버튼으로 실행:
  1. `data/word-index.json`에서 기존 단어 목록을 자동 읽어 중복 방지 프롬프트 구성
  2. Gemini API(`responseMimeType: "application/json"`, `responseSchema` 강제)로 영↔독 병렬 문장 & 핵심 단어 생성
  3. [`scripts/schema.mjs`](scripts/schema.mjs) 검증 및 중복 필터링 통과 시 `data/*.json` 자동 커밋·푸시 → GitHub Pages 자동 반영
- **설정 방법**: 저장소 **Settings → Secrets and variables → Actions → New repository secret**에 `GEMINI_API_KEY` (Google AI Studio 발급) 등록

### Track 2: 대화형 맞춤 생성 + 앱 내 1클릭 커밋 (`📥 Quick Import`)
1. 상단 `📥` 버튼 클릭 → **📋 Gemini 프롬프트 복사** (현재 단어장 중복 방지 목록 자동 포함)
2. Gemini 채팅에서 원하는 주제(예: 오늘 업무 이슈, 자전거 정비 등)로 생성된 JSON을 복사해 입력창에 붙여넣기
3. **🔍 검증 및 미리보기**로 신규/중복 항목 확인 후 **🚀 GitHub 레포에 바로 커밋** 클릭
   - `⚙️ 설정` 모달에서 Fine-grained PAT(`Contents: Read and write`, 본 레포 한정)를 등록하면 브라우저 `localStorage`에만 안전하게 보관되며 1클릭 커밋이 동작합니다.

---

## 📁 저장소 구조

```text
voca_data/
├── index.html                          # Zero-Build 정적 학습 앱
├── manifest.json / sw.js / icon.svg    # PWA 지원 파일
├── data/
│   ├── manifest.json                   # 스키마 버전, 통계, 레벨/태그 메타데이터
│   ├── vocab.json                      # 단어 마스터 데이터 (고유 id + legacyKey)
│   ├── sentences.json                  # 문장 마스터 데이터 (pairId 병렬 연결 + vocabIds)
│   └── word-index.json                 # Gemini 중복 방지용 경량 인덱스
├── scripts/
│   ├── schema.mjs                      # 공통 스키마 검증·정규화·중복 제거 모듈
│   ├── migrate-from-sheets.mjs         # 기존 Google Sheets → data/*.json 무손실 이관
│   ├── generate-daily.mjs              # Track 1 Gemini API 자동 생성 스크립트
│   └── validate-data.mjs               # CI/로컬 데이터 무결성 검증 CLI
├── tests/
│   ├── unit.test.mjs                   # Node 내장 단위 테스트 (무의존성)
│   └── e2e.test.mjs                    # Headless Chromium E2E 회귀 테스트 (무의존성)
├── docs/
│   └── ENHANCEMENT_PLAN.md             # 프로젝트 분석 및 비파괴 고도화 계획서
└── .github/workflows/
    ├── daily-generate.yml              # 매일 Gemini 자동 생성 워크플로우
    └── ci.yml                          # PR/Push 스키마 검증 + 단위/E2E 회귀 CI
```

---

## 🚀 로컬 실행 및 테스트

별도의 `npm install`이나 빌드 과정이 필요 없습니다 (Node.js 20+ 표준 내장 모듈만 사용).

```bash
# 로컬 정적 서버 실행
python3 -m http.server 8080
# → 브라우저에서 http://localhost:8080 접속
# (기존 Google Sheets 폴백 확인 시: http://localhost:8080/?source=sheets)

# 데이터 스키마 및 무결성 검증
node scripts/validate-data.mjs

# 단위 테스트 실행
node --test tests/unit.test.mjs

# Headless Chromium E2E 회귀 테스트 실행
node tests/e2e.test.mjs

# (선택) Google Sheets 데이터 재이관
node scripts/migrate-from-sheets.mjs
```

---

## 🌐 무료 배포 (GitHub Pages)

1. GitHub 저장소 **Settings → Pages** 이동
2. **Source**: `Deploy from a branch`, **Branch**: `main`, 폴더 `/ (root)` 저장
3. `https://<username>.github.io/voca_data/` 접속 (Track 1 자동화 커밋 시 자동 재배포)
