# 👀 눈길 (Nun-Gil)
**2026 HSU Capstone Design**

## 📖 프로젝트 개요
웹캠 기반 아이트래킹으로 학습 집중도를 실시간 측정하고, Claude AI를 활용해 학습 문서를 요약·마인드맵·퀴즈로 자산화하는 웹 기반 학습 보조 서비스입니다.

---

## ✨ 주요 기능

### 🎯 아이트래킹 & 집중도 측정
- 실시간 시선 좌표 추적 (EyeDID SDK)
- 6포인트 캘리브레이션 (8시간 캐시)
- 화면 이탈 5초 감지 → 경고창 표시 (`components/warningWidget.js`)
- 학습 세션별 집중도 점수 산출 (정상 응시 50점 + 경고 횟수 30점 + 반응 시간 20점)
- 집중도 레포트 (`report.html`): 전체 평균 + 세션별 상세 지표

### 📄 문서 뷰어
- PDF 렌더링 (pdf.js), PPT → PDF 자동 변환 (Supabase Edge Function)
- 텍스트 하이라이트 (5색), 북마크, 플로팅 메모장
- 시선이 머문 단어 실시간 감지

### 🧠 AI 지식 자산화 (2-Track)

**Track 1 — 뷰어 실시간 생성** (`ui/ai/`)
- PDF 텍스트 추출 → 의미 단위 청킹 → Claude API 호출
- 요약 / D3.js 마인드맵 / 퀴즈를 뷰어 내에서 즉시 렌더링
- `sessionStorage` 기반 캐시로 중복 호출 방지
- `devServer.js`의 `/api/claude` 프록시 경유

**Track 2 — 업로드 시 사전 분석** (`supabase/functions/analyze-document`)
- 문서 업로드 시 Supabase Edge Function 호출
- PDF base64 변환 후 Claude API에 전달
- SUMMARY / MINDMAP / QUIZ 결과를 `learning_assets` 테이블에 저장

---

## 📂 디렉토리 구조
```text
Nun-Gil/
├── components/
│   └── warningWidget.js          # 시선 이탈 경고 위젯
├── ui/                            # 프론트엔드 (Vanilla JS + HTML + CSS)
│   ├── start.html                 # 랜딩/시작 페이지
│   ├── mainpage.html              # 메인 앱 화면 (파일 업로드)
│   ├── signup.html                # 회원가입/로그인
│   ├── calibration.html           # 시선 캘리브레이션
│   ├── viewer.html                # 문서 뷰어 (아이트래킹 + 세션 + AI)
│   ├── processing.html            # AI 자산 생성 대기 화면
│   ├── document.html              # 문서 목록 관리
│   ├── workspace.html             # 워크스페이스 관리
│   ├── report.html                # 집중도 레포트
│   ├── profile.html               # 계정 설정
│   ├── script.js                  # 북마크/메모 UI 로직
│   ├── style.css                  # 글로벌 스타일
│   └── ai/                        # AI 기능 모듈
│       ├── index.js               # 뷰어와 AI 연결 진입점
│       ├── common.js              # PDF 청킹, Claude 호출, 캐시 공통 유틸
│       ├── summary.js             # 요약 생성 및 렌더링
│       ├── mindmap.js             # D3.js 마인드맵 생성 및 렌더링
│       ├── quiz.js                # 퀴즈 생성 및 렌더링
│       ├── prompt.js              # 프롬프트 템플릿 관리
│       └── ai.css                 # AI 기능 전용 스타일
├── src/lib/
│   ├── supabase.js                # Supabase 클라이언트
│   ├── auth.js                    # 인증 (requireAuth)
│   ├── storage.js                 # 파일 업로드/다운로드
│   └── db/
│       ├── workspaces.js
│       ├── documents.js
│       ├── studySessions.js       # 집중도 세션 CRUD
│       └── learningAssets.js      # 지식 자산 CRUD
├── supabase/functions/
│   ├── convert-ppt/               # PPT → PDF 변환 Edge Function
│   │   └── index.ts
│   └── analyze-document/          # Claude AI 문서 분석 Edge Function
│       └── index.ts
├── easy-seeso.js                  # EyeDID SDK 래퍼
└── devServer.js                   # 개발 서버 (Node.js, port 3000)
                                   # /api/claude 프록시 엔드포인트 포함
```

---

## 🛠 기술 스택
| 영역 | 기술 |
|---|---|
| **프론트엔드** | Vanilla JS (ES Modules), HTML5, CSS3 |
| **아이트래킹** | EyeDID SDK (WASM 기반) |
| **AI** | Claude API (`claude-haiku-4-5-20251001`) — 요약/마인드맵/퀴즈 |
| **마인드맵 시각화** | D3.js |
| **백엔드/DB** | Supabase (Auth + PostgreSQL + Storage) |
| **Edge Functions** | Deno (convert-ppt, analyze-document) |
| **외부 API** | CloudConvert (PPT → PDF 변환) |
| **개발 서버** | Node.js 내장 HTTP 모듈 |

---

## 🚀 실행 방법

### 1. Claude API 키 설정
`devServer.js` 파일의 `ANTHROPIC_API_KEY` 값에 키를 입력합니다.

### 2. 개발 서버 실행
```bash
node devServer.js   # http://localhost:3000
```

### 3. Edge Function 배포 (최초 1회 또는 코드 수정 시)
```bash
npx supabase functions deploy convert-ppt
npx supabase functions deploy analyze-document
```

---

## 🔑 Supabase Secrets 설정
Supabase 대시보드 → Edge Functions → Secrets에 등록 필요

| Key | 설명 |
|---|---|
| `Claude_API_KEY` | Anthropic API 키 |
| `CLOUDCONVERT_API_KEY` | CloudConvert API 키 (PPT 변환) |

---

## 📊 페이지 흐름
```
start.html ──→ signup.html (회원가입/로그인)
            └→ mainpage.html (파일 업로드)
                └→ processing.html (AI 사전 분석 대기)
                    └→ viewer.html (문서 뷰어 + 아이트래킹 + AI 실시간)
                        ├→ report.html (집중도 레포트)
                        └→ profile.html (계정 설정)
```

---

## 🧩 AI 아키텍처

```
[뷰어 실시간]
viewer.html → ai/index.js → ai/common.js (/api/claude 프록시)
                          → Claude API (claude-haiku-4-5)
                          → summary.js / mindmap.js / quiz.js 렌더링

[업로드 사전분석]
processing.html → analyze-document (Edge Function)
               → Storage PDF 다운로드 → base64 → Claude API
               → learning_assets 테이블 (PENDING → DONE)
```
