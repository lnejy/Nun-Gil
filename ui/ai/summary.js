// ui/ai/요약.js
import {
  AI_STATE,
  askClaudeJson,
  askClaudeText,
  buildContext,
  escapeHtml,
  getAiCache,
  getCanvas,
  getChunks,
  setAiCache,
  setAiMode,
  showAiLoading,
  sourceText,
} from "./common.js";

import {
  createSummaryExplainPrompt,
  createSummaryPrompt,
} from "./prompt.js";

export async function loadSummary() {
  const cache = getAiCache();

  if (cache.summary) {
    renderSummary(cache.summary);
    return;
  }

  showAiLoading("요약 생성 중");

  const chunks = await getChunks();
  const prompt = createSummaryPrompt({
    title: AI_STATE.docTitle,
    context: buildContext(chunks),
  });

  const summary = await askClaudeJson(prompt);
  setAiCache({ summary });
  renderSummary(summary);
}

function renderSummary(summary) {
  const container = getCanvas();
  setAiMode();

  container.innerHTML = `
    <div class="ai-page">
      <h1 class="ai-title">${escapeHtml(summary.title)}</h1>
      <p class="ai-summary-text">${escapeHtml(summary.summary)}</p>

      ${(summary.key_points || []).map((item, index) => `
        <button class="ai-result-card ai-summary-card" data-index="${index}">
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.description)}</p>
          <div class="ai-source">${escapeHtml(sourceText(item.source_chunks))}</div>
        </button>
      `).join("")}

      <div class="ai-result-card ai-explain-box" id="aiExplainBox" style="display:none;">
        <h3>AI 추가 설명</h3>
        <p id="aiExplainText"></p>
      </div>
    </div>
  `;

  container.querySelectorAll(".ai-summary-card").forEach((card) => {
    card.addEventListener("click", async () => {
      const index = Number(card.dataset.index);
      const point = summary.key_points[index];

      const box = document.getElementById("aiExplainBox");
      const text = document.getElementById("aiExplainText");

      box.style.display = "block";
      text.textContent = "AI가 문서 근거를 바탕으로 설명 중...";

      try {
        text.textContent = await explainSummaryPoint(point);
      } catch (err) {
        text.textContent = "오류: " + err.message;
      }
    });
  });
}

async function explainSummaryPoint(point) {
  const chunks = await getChunks();

  const sourceTexts = chunks
    .filter((c) => (point.source_chunks || []).includes(c.chunk_id))
    .map((c) => `[${c.chunk_id} | page ${c.page_start}]\n${c.text}`)
    .join("\n\n");

  const prompt = createSummaryExplainPrompt({
    point,
    sourceTexts,
  });

  return askClaudeText(prompt);
}
