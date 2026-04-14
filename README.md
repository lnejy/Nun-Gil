# Nun-Gil
2026 HSU Capstone Design

눈길 (Nun-Gil) 프로젝트 분석
프로젝트 개요
웹 기반 아이트래킹 문서 뷰어/어노테이션 앱입니다. 웹캠을 통해 시선을 추적하고, 사용자가 어디를 읽고 있는지 감지하여 문서 상호작용에 활용하는 앱입니다.

디렉토리 구조

Nun-Gil/
├── seeso/                  # 아이트래킹 SDK (VisualCamp SeeSo v0.2.4)
│   ├── dist/seeso.js       # 컴파일된 SDK (~449KB, WASM 기반)
│   └── easy-seeso.js       # SDK 래퍼 클래스
├── ui/                     # 프론트엔드 (Vanilla JS + HTML + CSS)
│   ├── start.html          # 랜딩/시작 페이지
│   ├── mainpage.html       # 메인 앱 화면
│   ├── signup.html         # 회원가입
│   ├── calibration.html    # 시선 캘리브레이션
│   ├── workspace.html      # 문서 편집 공간
│   ├── viewer.html         # 문서 뷰어
│   ├── document.html       # 문서 관리
│   ├── sidebar.html        # 사이드바
│   ├── script.js           # 메인 UI 로직
│   └── style.css           # 글로벌 스타일
├── devServer.js            # 개발 서버 (Node.js, port 3000)
└── package.json
기술 스택
영역	기술
프론트엔드	Vanilla JS (ES6), HTML5, CSS3
아이트래킹	SeeSo SDK v0.2.4 (WASM 기반)
개발 서버	Node.js (내장 HTTP 모듈)
HTTP 클라이언트	Axios v1.6.8
빌드	Webpack 5 + Babel 7
주요 기능
아이트래킹 — 실시간 시선 좌표 추적, 5포인트 캘리브레이션, 주의력/졸음/깜빡임 감지
문서 어노테이션 — 텍스트 하이라이트 (5색 팔레트), 북마크, 플로팅 메모장
사이드바 네비게이션 — 접이식 사이드바 UI
COOP/COEP 헤더 설정 — SharedArrayBuffer 사용을 위한 크로스오리진 격리
실행 방법

node devServer.js   # http://localhost:3000 으로 시작
