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
import "./help.js";

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
window.addEventListener("doc-changed", async () => {
  initAiState();

  currentTool = "original";

  document.querySelectorAll(".sb-tool-item").forEach(btn =>
    btn.classList.remove("active")
  );

  const origBtn = document.querySelector('.sb-tool-item[data-ai-tool="original"]');
  if (origBtn) origBtn.classList.add("active");

  await renderOriginalDocument();
});

function bindAiButtons() {
  document.querySelectorAll(".sb-tool-item[data-ai-tool]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tool = btn.dataset.aiTool;

      // 사용자 의도를 즉시 기록
      currentTool = tool;
      setActiveButton(btn);

      if (tool === "original") {
        await renderOriginalDocument();
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

async function renderOriginalDocument() {
  clearAiMode();

  document.body.classList.remove(
    "quiz-inline-mode",
    "quiz-fullscreen-mode",
    "summary-mode",
    "mindmap-mode",
    "quiz-mode",
    "ai-view-mode"
  );

  const container = document.getElementById("pdfContainer");

  if (container) {
    container.classList.remove(
      "summary-mode",
      "quiz-mode",
      "mindmap-mode",
      "ai-loading-mode"
    );

    container.innerHTML = `<div class="pdf-loading">문서 로딩 중...</div>`;
    container.scrollTop = 0;
  }

  if (window._layoutJsonUrl && typeof window.renderLayoutViewer === "function") {
    await window.renderLayoutViewer(window._layoutJsonUrl, {
      containerId: "pdfContainer",
      pdfUrl: window._pdfUrl,
    });
  } else if (window._pdfUrl && typeof window.renderPdf === "function") {
    await window.renderPdf(window._pdfUrl);
  } else if (container) {
    container.innerHTML = `<div class="pdf-no-content">문서를 불러올 수 없습니다.</div>`;
  }
}

function setActiveButton(activeBtn) {
  document.querySelectorAll(".sb-tool-item").forEach((btn) => {
    btn.classList.remove("active");
  });
  activeBtn.classList.add("active");
}