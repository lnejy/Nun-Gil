<div align="center">

# 👀 눈길 (Nun-Gil)

**웹캠으로 집중도를 측정하고, AI가 공부를 도와주는 학습 보조 서비스**

[![HSU Capstone](https://img.shields.io/badge/HSU-2026_Capstone_Design-4A90D9?style=flat-square)](https://www.hansung.ac.kr)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com)
[![Claude AI](https://img.shields.io/badge/Claude_AI-D97757?style=flat-square)](https://anthropic.com)
[![Vanilla JS](https://img.shields.io/badge/Vanilla_JS-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![pdf.js](https://img.shields.io/badge/pdf.js-FF4785?style=flat-square)](https://mozilla.github.io/pdf.js/)
[![D3.js](https://img.shields.io/badge/D3.js-F9A03C?style=flat-square&logo=d3dotjs&logoColor=white)](https://d3js.org)

<br/>

_웹캠만 있으면 — 시선이 닿는 곳에서 집중이 시작됩니다._

</div>

---

## 📑 목차

- [🎯 프로젝트 소개](#-프로젝트-소개)
- [✨ 주요 기능](#-주요-기능)
- [🏗 아키텍처](#-아키텍처)
- [🗄 데이터베이스](#-데이터베이스)
- [🛠 기술 스택](#-기술-스택)
- [📂 디렉토리 구조](#-디렉토리-구조)
- [📱 화면 흐름](#-화면-흐름)
- [👨‍💻 팀](#-팀)

---

## 🎯 프로젝트 소개

> 눈길은 **웹캠 시선 추적**과 **Claude AI**를 결합한 스마트 학습 보조 서비스입니다.  
> PDF / PPT 문서를 업로드하면, AI가 요약·마인드맵·퀴즈를 자동 생성하고  
> 공부하는 동안 시선이 얼마나 집중됐는지를 **집중도 점수**로 분석해 보여줍니다.

### 💡 핵심 — 흩어진 학습 도구를 하나의 흐름으로

기존에는 **문서 뷰어 · 요약/정리 · 문제 풀이 · 집중도 관리**를 각각 다른 앱에서 따로 해야 했습니다.
눈길은 이 모든 단계를 **하나의 서비스 안에서 끊김 없이 연결**합니다 — 문서를 읽으며 곧바로 AI 학습 자료를 만들고,
같은 화면에서 시선으로 집중도를 측정하며, 학습이 끝나면 레포트로 돌아봅니다.

```
문서 업로드  →  읽기(시선 추적)  →  AI 요약·마인드맵·퀴즈  →  집중도 레포트
   └─────────────── 한 화면, 끊김 없는 단일 학습 흐름 ───────────────┘
```

```
사용자가 PDF를 열고 공부한다
      ↓
웹캠이 시선을 추적한다 (EyeDID SDK)
      ↓
화면을 벗어나면 경고 → 집중도를 실시간 기록
      ↓
Claude AI가 문서를 분석 → 요약 / 마인드맵 / 퀴즈 생성
      ↓
세션 종료 → 집중도 레포트로 학습 패턴 확인
```

---

## ✨ 주요 기능

### 📄 스마트 문서 뷰어

| 기능 | 설명 |
|---|---|
| PDF / PPT 업로드 | PPT는 Cloud Edge Function으로 자동 PDF 변환 |
| 워크스페이스 | 문서를 주제별로 묶어 관리 |
| 인라인 전환 | 뷰어 안에서 문서 전환 (페이지 이동 없음) |
| 북마크 | 5가지 색상, 메모 첨부, 북마크함에서 통합 조회 |
| 메모장 | 문서별 독립 메모 · 계정과 DB 동기화 |

### 👁 아이트래킹 & 집중도 측정

- **EyeDID SDK (WASM)** — 웹캠으로 실시간 시선 좌표 추적
- **6포인트 캘리브레이션 + 자동 오프셋 보정** — 캘리브레이션 직후 중앙 응시로 시선 오차를 측정해 자동 교정
- **시선 안정화 파이프라인** — 깜빡임 판정 · 워밍업 · 속도 제한 · 지수이동평균 스무딩
- 화면 이탈 5초 감지 → 경고 위젯 팝업, 반응 시간 기록
- **집중도 점수 (100점 만점)** 자동 산출

```
집중도 점수 = 정상 응시 비율 (40점)
            + 경고 감점       (25점)
            + 반응 속도       (15점)
            + 재독 패턴       (20점, 지수 감쇠 — 재독이 많을수록 완만히 감점)
```

### 🧠 AI 지식 자산화

문서 업로드 또는 뷰어 실시간 생성 — 두 가지 경로로 자동화

```
문서 업로드
  └─ analyze-document Edge Function
       └─ Claude API → SUMMARY + MINDMAP + QUIZ 동시 생성

뷰어 실시간
  └─ 사이드바 버튼 클릭
       └─ 문서 청킹 → 개념 추출 → Claude API 호출
```

| 자산 유형 | 내용 |
|---|---|
| 📝 요약 | 핵심 개념 카드 + 클릭 시 AI 심화 설명 |
| 🗺 마인드맵 | D3.js 계층 트리, 노드 펼치기/접기, 줌/패닝 |
| ❓ 퀴즈 | 객관식·O/X·단답형 + 난이도 3단계 + 즉시 채점·해설·북마크 + 퀴즈 삭제 |

### 📊 집중도 레포트

- 문서별로 묶인 학습 기록 목록
- **날짜별 집중도 추이 차트** — 데이터가 늘어나면 가로 스크롤 (고정 간격 유지)
- 차트 포인트 클릭 → 해당 세션 상세 지표 확인
  - 경고 횟수, 평균 반응 시간, 정상 응시 비율, 재독 횟수
  - 구간별 집중 점수 그래프

---

## 🏗 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│                        Browser                          │
│                                                         │
│  start → signup → mainpage → workspace → viewer        │
│                                           │             │
│  ┌────────────────── viewer.html ─────────┘             │
│  │  사이드바          PDF 뷰어              툴바         │
│  │  ├ 새 문서 추가    ├ pdf.js 렌더링       ├ 학습 시작 │
│  │  ├ 문서 목록       ├ 레이아웃 오버레이   ├ 확대/축소 │
│  │  ├ 요약/마인드맵   └ 시선 추적 레이어    └ 메모/북마크│
│  │  └ 퀴즈                                              │
│  └──────────────────────────────────────────────────────│
│                           │                             │
│         EyeDID SDK (WASM) — 웹캠 시선 추적              │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTPS
          ┌────────────────┴────────────────┐
          │          Supabase               │
          │  ┌──────────────────────────┐   │
          │  │  Edge Functions (Deno)   │   │
          │  │  ├ ask-claude            │   │
          │  │  ├ analyze-document      │   │
          │  │  ├ convert-ppt           │   │
          │  │  └ parse-document        │   │
          │  └──────────────────────────┘   │
          │  ┌──────────┐ ┌──────────────┐  │
          │  │   Auth   │ │  PostgreSQL  │  │
          │  └──────────┘ └──────────────┘  │
          │  ┌──────────┐                   │
          │  │ Storage  │  (PDF, layout JSON)│
          │  └──────────┘                   │
          └─────────────────────────────────┘
                           │
                    Claude API (Anthropic)
                    CloudConvert API
```

---

## 🗄 데이터베이스

| 테이블 | 역할 |
|---|---|
| `users` | 사용자 프로필 (이름) |
| `workspaces` | 워크스페이스 |
| `documents` | 업로드 문서 (PDF/PPT, 파싱 상태, layout JSON 경로) |
| `study_sessions` | 학습 세션 (집중도 점수, 경고 횟수, 응시 시간) |
| `session_snapshots` | 10초 단위 집중도 스냅샷 (구간별 차트용) |
| `learning_assets` | AI 생성 자산 (SUMMARY / MINDMAP / QUIZ) |
| `bookmarks` | 북마크 (위치, 색상, 메모) |
| `document_notes` | 문서별 메모장 |

---

## 🛠 기술 스택

| 영역 | 기술 |
|---|---|
| **프론트엔드** | Vanilla JS (ES Modules, 번들러 없음), HTML5, CSS3 |
| **아이트래킹** | EyeDID SDK (WASM) |
| **PDF 렌더링** | pdf.js + 커스텀 레이아웃 뷰어 |
| **마인드맵** | D3.js (계층형 트리) |
| **AI** | Claude API — `claude-haiku-4-5-20251001` |
| **백엔드 / DB** | Supabase (Auth · PostgreSQL · RLS · Storage) |
| **Edge Functions** | Deno (TypeScript) |
| **PPT 변환** | CloudConvert API |
| **문서 파싱** | Upstage Document Parse API |
| **개발 서버** | Node.js |

---

## 📂 디렉토리 구조

```
Nun-Gil/
├── ui/                          # 프론트엔드
│   ├── start.html               # 랜딩 페이지
│   ├── signup.html              # 회원가입 / 로그인
│   ├── mainpage.html            # 워크스페이스 목록
│   ├── workspace.html           # 워크스페이스 문서 목록
│   ├── viewer.html              # ★ 핵심 — 뷰어 + 아이트래킹 + AI
│   ├── calibration.html         # 시선 캘리브레이션
│   ├── processing.html          # AI 사전 분석 대기 화면
│   ├── report.html              # 집중도 레포트
│   ├── profile.html             # 계정 설정
│   ├── script.js                # 북마크 / 메모 UI
│   ├── style.css                # 글로벌 스타일
│   ├── ai/                      # AI 기능 모듈 (ES Modules)
│   │   ├── index.js             # 뷰어 ↔ AI 연결 진입점
│   │   ├── common.js            # 청킹 · Claude 호출 · 캐시
│   │   ├── summary.js           # 요약
│   │   ├── mindmap.js           # 마인드맵
│   │   ├── quiz.js              # 퀴즈
│   │   └── prompt.js            # 프롬프트 템플릿
│   └── viewer/
│       ├── layoutViewer.js      # 레이아웃 기반 PDF 뷰어
│       └── pdfRenderer.js       # pdf.js 렌더러
│
├── src/lib/                     # 공통 클라이언트 라이브러리
│   ├── supabase.js
│   ├── auth.js
│   ├── storage.js
│   └── db/                      # DB 접근 함수
│
├── supabase/functions/          # Edge Functions (Deno)
│   ├── ask-claude/              # 뷰어 AI 호출 프록시
│   ├── analyze-document/        # 업로드 시 AI 사전 분석
│   ├── convert-ppt/             # PPT → PDF 변환
│   └── parse-document/          # Upstage 문서 파싱
│
├── seeso/                       # EyeDID SDK
├── easy-seeso.js                # EyeDID 래퍼
├── devServer.js                 # 개발 서버 (port 3000)
└── package.json
```

---

## 📱 화면 흐름

```
start.html
  └─▶ signup.html              로그인 / 회원가입
        └─▶ mainpage.html      워크스페이스 목록
              └─▶ viewer.html  ─────────────────────────────────┐
                    │                                            │
                    ├─ 사이드바                                  │
                    │   ├─ 새 문서 추가 ─▶ processing.html     │
                    │   ├─ 문서 선택 (in-place 전환)            │
                    │   ├─ 원본 / 요약 / 마인드맵 / 퀴즈        │
                    │   └─ 지식 자산 목록                        │
                    │                                            │
                    ├─ 학습 시작 (아이트래킹 세션)               │
                    ├─ 집중도 레포트 ─▶ report.html             │
                    └─ 계정 설정 ─▶ profile.html                │
                                                                 │
                    calibration.html ◀─ 캘리브레이션 필요 시 ───┘
```

---

## 👨‍💻 팀

**한성대학교 2026 캡스톤디자인**

| 이름 | 학번 | 전공 | 이메일 |
|---|---|---|---|
| 신준호 | 2171080 | 모바일소프트웨어 · 웹공학 | junho020122@hansung.ac.kr |
| 서유진 | 2371195 | 웹공학 · 모바일소프트웨어 | sseo08267@gmail.com |
| 원재연 | 2371263 | 빅데이터 · 웹공학 | 016420@naver.com |
| 신영서 | 2371225 | 모바일소프트웨어 · 웹공학 | ss0125@hansung.ac.kr |

---

<div align="center">

**👀 눈길 — 시선이 닿는 곳에서 집중이 시작됩니다**

</div>
