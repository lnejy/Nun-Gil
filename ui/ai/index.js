// ui/ai/index.js
// viewer.html과 AI 기능을 연결하는 진입점.
// viewer.html은 버튼과 PDF URL만 제공하고, 실제 기능은 각 파일로 분리한다.

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

window.addEventListener("viewer-init", () => {
  console.log("AI viewer-init received");
  if (initialized) return;
  initialized = true;

  initAiState();
  bindAiButtons();

  // ai 파라미터 있으면 해당 툴 자동 실행
  const aiParam = new URLSearchParams(location.search).get("ai")
  if (aiParam) {
    const tool = aiParam.toLowerCase()
    const btn  = document.querySelector(`.sb-tool-item[data-ai-tool="${tool}"]`)
    if (btn) setActiveButton(btn)

    setTimeout(() => {
      if (tool === "summary") loadSummary().catch(console.error)
      if (tool === "mindmap") loadMindmap().catch(console.error)
      if (tool === "quiz")    loadQuiz().catch(console.error)
    }, 300)
  }
});

function bindAiButtons() {
  document.querySelectorAll(".sb-tool-item[data-ai-tool]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tool = btn.dataset.aiTool;

      setActiveButton(btn);

      if (tool === "original") {
        clearAiMode();
        if (window._pdfUrl && typeof window.renderPdf === "function") {
          window.renderPdf(window._pdfUrl);
        }
        return;
      }

      try {
        if (tool === "summary") await loadSummary();
        if (tool === "mindmap") await loadMindmap();
        if (tool === "quiz") await loadQuiz();
      } catch (err) {
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
