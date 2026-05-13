// ui/ai/index.js
// viewer.html과 AI 기능을 연결하는 진입점.
// viewer.html은 버튼과 PDF URL만 제공하고, 실제 기능은 각 파일로 분리한다.

// ui/ai/index.js
console.log("AI index.js loaded");
import {
  clearAiMode,
  initAiState,
  showAiError,
} from "./common.js";

import { loadSummary } from "./summary.js";
import { loadMindmap } from "./mindmap.js";
import { loadQuiz } from "./quiz.js";

let initialized = false;
let currentTool = null;  // 현재 사용자가 보고 있는 도구

window.addEventListener("viewer-init", () => {
  console.log("AI viewer-init received");
  if (initialized) return;
  initialized = true;

  initAiState();
  bindAiButtons();
});

// 문서 in-place 전환 시 AI state 재초기화 + 원본 버튼으로 초기화
window.addEventListener("doc-changed", () => {
  initAiState();

  // AI 모드 CSS 클래스 정리 (PDF가 올바르게 표시되도록)
  clearAiMode();
  document.body.classList.remove("quiz-inline-mode", "quiz-fullscreen-mode");
  const container = document.getElementById("pdfContainer");
  if (container) container.classList.remove("summary-mode", "quiz-mode", "ai-loading-mode");

  // 원본 버튼으로 활성화 초기화
  currentTool = "original";
  document.querySelectorAll(".sb-tool-item").forEach(btn => btn.classList.remove("active"));
  const origBtn = document.querySelector('.sb-tool-item[data-ai-tool="original"]');
  if (origBtn) origBtn.classList.add("active");
});

function bindAiButtons() {
  document.querySelectorAll(".sb-tool-item[data-ai-tool]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tool = btn.dataset.aiTool;

      // 사용자 의도를 즉시 기록
      currentTool = tool;
      setActiveButton(btn);

      if (tool === "original") {
        clearAiMode();
        if (window._pdfUrl && typeof window.renderPdf === "function") {
          // PDF 렌더 완료 후 북마크 복원
          window.addEventListener("pdf-rendered", () => {
            if (typeof window.loadBookmarks === "function") window.loadBookmarks();
          }, { once: true });
          window.renderPdf(window._pdfUrl);
        }
        return;
      }

      try {
        // 클릭 시점의 도구를 캡처 (클로저로)
        const requestedTool = tool;

        if (tool === "summary") await loadSummary({
          shouldRender: () => currentTool === requestedTool,
        });
        if (tool === "mindmap") await loadMindmap({
          shouldRender: () => currentTool === requestedTool,
        });
        if (tool === "quiz") await loadQuiz({
          shouldRender: () => currentTool === requestedTool,
        });
      } catch (err) {
        // 사용자가 이미 다른 데로 갔으면 에러도 안 띄움
        if (currentTool !== tool) return;
        console.error(err);
        showAiError(err.message);
      }
    });
  });
}

function setActiveButton(activeBtn) {
  document.querySelectorAll(".sb-tool-item").forEach((btn) => {
    btn.classList.remove("active");
  });
  activeBtn.classList.add("active");
}