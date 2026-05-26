# 👀 눈길 (Nun-Gil)
**2026 HSU Capstone Design**

> 웹캠 기반 시선 추적으로 학습 집중도를 실시간 측정하고,  
> Claude AI로 학습 문서를 요약·마인드맵·퀴즈로 자산화하는 웹 학습 보조 서비스

---

## ✨ 주요 기능

### 🎯 아이트래킹 & 집중도 측정
- 실시간 시선 좌표 추적 — EyeDID SDK (WASM)
- 6포인트 캘리브레이션, 결과 8시간 캐시
- 화면 이탈 **5초** 감지 → 경고 위젯 표시 (`components/warningWidget.js`)
- 학습 세션별 집중도 점수 산출
  - 정상 응시 비율 50점 + 경고 횟수 30점 + 평균 반응 시간 20점
- 집중도 레포트 (`report.html`) — 전체 평균 + 세션별 상세 지표

### 📄 문서 뷰어 (NotebookLM 방식)
- 워크스페이스 진입 → `viewer.html` 단일 페이지에서 문서 in-place 전환
- PDF 렌더링 (pdf.js) / PPT → PDF 자동 변환 (Supabase Edge Function)
- **메모장** — 문서별 독립 저장 (localStorage, 저장 버튼)
- **북마크** — Supabase DB 영구 저장 + 5색 하이라이트
- **북마크함** — 같은 워크스페이스 내 전 문서 북마크 통합 조회, 클릭 시 해당 위치로 스크롤
- 시선이 머문 단어 실시간 감지 (Pointer-Tracker 모드)

### 🧠 AI 지식 자산화 (2-Track)

**Track 1 — 뷰어 실시간 생성** (`ui/ai/`)
| 기능 | 설명 |
|---|---|
| 요약 | 핵심 개념 카드 + 카드 클릭 시 AI 심화 설명 |
| 마인드맵 | D3.js 계층 트리, 노드 클릭으로 펼치기/접기 |
| 퀴즈 | 4지선다 + 즉시 채점 + 해설 |

- PDF 텍스트 청킹 → 개념 추출 → Claude API 호출 순서로 처리
- `sessionStorage` 캐시로 중복 호출 방지
- 생성 완료 즉시 `learning_assets` 테이블에 저장 → 사이드바에 아이콘+문서명으로 표시

**Track 2 — 업로드 시 사전 분석** (`supabase/functions/analyze-document`)
- 문서 업로드 → `processing.html` 대기 화면 → Edge Function 자동 호출
- PDF base64 변환 후 Claude API에 전달
- SUMMARY / MINDMAP / QUIZ 결과를 `learning_assets` 테이블에 저장

### 👤 계정 & 워크스페이스
- 이메일 회원가입 / 로그인 (Supabase Auth)
- 워크스페이스 생성 및 문서 관리
- 문서 삭제 (확인 모달 포함)
- 계정 설정 (`profile.html`) — 닉네임, 이메일, 비밀번호 변경

---

## 📂 디렉토리 구조

```text
Nun-Gil/
├── components/
│   └── warningWidget.js              # 시선 이탈 경고 위젯
│
├── ui/                               # 프론트엔드 (Vanilla JS + HTML + CSS)
│   ├── start.html                    # 랜딩/시작 페이지
│   ├── signup.html                   # 회원가입 / 로그인
│   ├── mainpage.html                 # 메인 — 워크스페이스 목록
│   ├── workspace.html                # 워크스페이스 내 문서 목록
│   ├── calibration.html              # 시선 캘리브레이션
│   ├── viewer.html                   # ★ 핵심 — 문서 뷰어 + 아이트래킹 + AI
│   ├── processing.html               # AI 사전 분석 대기 화면
│   ├── document.html                 # 문서 카드 관리 (삭제, 지식 자산 뱃지)
│   ├── report.html                   # 집중도 레포트
│   ├── profile.html                  # 계정 설정
│   ├── quiz.html                     # 독립 퀴즈 페이지
│   ├── script.js                     # 북마크 / 메모 UI 로직
│   ├── style.css                     # 글로벌 스타일
│   └── ai/                           # AI 기능 모듈 (ES Modules)
│       ├── index.js                  # 뷰어 ↔ AI 연결 진입점
│       ├── common.js                 # 청킹, Claude 호출, 캐시 공통 유틸
│       ├── summary.js                # 요약 생성 & 렌더링
│       ├── mindmap.js                # D3.js 마인드맵 생성 & 렌더링
│       ├── quiz.js                   # 퀴즈 생성 & 렌더링
│       ├── prompt.js                 # 프롬프트 템플릿
│       └── ai.css                    # AI 기능 전용 스타일
│
├── src/lib/
│   ├── supabase.js                   # Supabase 클라이언트 초기화
│   ├── auth.js                       # 인증 (requireAuth)
│   ├── storage.js                    # 파일 업로드 / 서명 URL
│   └── db/
│       ├── workspaces.js
│       ├── documents.js
│       ├── studySessions.js          # 집중도 세션 CRUD
│       └── learningAssets.js         # 지식 자산 CRUD
│
├── supabase/functions/
│   ├── convert-ppt/                  # PPT → PDF 변환 (CloudConvert)
│   │   └── index.ts
│   ├── analyze-document/             # Claude AI 문서 전체 분석
│   │   └── index.ts
│   └── ask-claude/                   # 뷰어 실시간 AI 호출 프록시
│       └── index.ts
│
├── easy-seeso.js                     # EyeDID SDK 래퍼
├── devServer.js                      # 개발 서버 (Node.js, port 3000)
└── package.json
```

---

## 🛠 기술 스택

| 영역 | 기술 |
|---|---|
| **프론트엔드** | Vanilla JS (ES Modules, 번들러 없음), HTML5, CSS3 |
| **아이트래킹** | EyeDID SDK (WASM 기반 시선 추적) |
| **AI** | Claude API — `claude-haiku-4-5-20251001` |
| **마인드맵** | D3.js (계층형 트리, 줌/패닝/애니메이션) |
| **PDF 렌더링** | pdf.js |
| **백엔드 / DB** | Supabase (Auth · PostgreSQL · Storage · RLS) |
| **Edge Functions** | Deno (convert-ppt · analyze-document · ask-claude) |
| **PPT 변환** | CloudConvert API |
| **개발 서버** | Node.js 내장 HTTP 모듈 |

---

## 🗄 주요 DB 테이블

| 테이블 | 역할 |
|---|---|
| `workspaces` | 워크스페이스 |
| `documents` | 업로드 문서 (file_url, workspace_id) |
| `study_sessions` | 학습 세션 (집중도 점수, 경고 횟수 등) |
| `learning_assets` | AI 생성 자산 (SUMMARY / MINDMAP / QUIZ) |
| `bookmarks` | 북마크 (position_y, color, memo, document_id, workspace_id) |

---

## 🚀 실행 방법

### 1. 의존성 설치

```bash
npm install
```

### 2. 개발 서버 실행

```bash
node devServer.js   # http://localhost:3000
```

### 3. Edge Function 배포 (최초 1회 또는 코드 변경 시)

```bash
npx supabase functions deploy convert-ppt
npx supabase functions deploy analyze-document
npx supabase functions deploy ask-claude
```

---

## 🔑 Supabase Secrets 설정

Supabase 대시보드 → **Edge Functions → Secrets** 에 등록 필요

| Key | 설명 |
|---|---|
| `Claude_API_KEY` | Anthropic API 키 |
| `CLOUDCONVERT_API_KEY` | CloudConvert API 키 (PPT 변환) |

---

## 📊 페이지 흐름

```
start.html
  └→ signup.html          (회원가입 / 로그인)
       └→ mainpage.html   (워크스페이스 목록)
            └→ viewer.html?workspace_id=XXX   ← 워크스페이스 클릭 시 바로 진입
                 ├─ 사이드바에서 문서 선택 → in-place 전환 (URL만 변경)
                 ├─ 새 문서 추가 → processing.html → viewer.html 복귀
                 ├─ 세션 시작 / 종료 → report.html
                 └─ 프로필 → profile.html
```

---

## 🧩 AI 아키텍처

```
[뷰어 실시간 — Track 1]
viewer.html
  → ai/index.js (버튼 클릭)
  → ai/common.js
      → ask-claude Edge Function  (Supabase → Claude API)
  → summary.js / mindmap.js / quiz.js  렌더링
  → learning_assets 테이블 저장
  → 사이드바 지식 자산 목록 갱신

[업로드 사전 분석 — Track 2]
processing.html
  → analyze-document Edge Function
      → Storage PDF 다운로드 → base64 인코딩
      → Claude API (SUMMARY + MINDMAP + QUIZ 한 번에)
      → learning_assets 테이블 저장 (PENDING → DONE)
```

---

## ⚠️ 알려진 제약 / 개발 메모

- EyeDID SDK는 **HTTPS 또는 localhost** 환경에서만 카메라 접근 허용
- 캘리브레이션 데이터는 `localStorage`에 8시간 캐시 (`calibKey = workspace_id`)
- AI 결과는 `sessionStorage`에 문서별로 캐시 (탭 닫으면 초기화, DB에는 영구 저장)
- `ask-claude` Edge Function은 Supabase JWT 인증 필요 (비로그인 차단)
