// ui/ai/요약.js
import {
  AI_STATE,
  askClaudeJson,
  askClaudeText,
  decideOutputRange,
  escapeHtml,
  getAiCache,
  getCanvas,
  getChunks,
  getConcepts,
  getImportantChunks,
  setAiCache,
  setAiMode,
  showAiLoading,
  sourceText,
} from "./common.js";

import {
  createSummaryExplainPrompt,
  createSummaryPrompt,
} from "./prompt.js";

export async function loadSummary({ shouldRender = () => true } = {}) {
  const cache = getAiCache();

  if (cache.summary) {
    if (shouldRender()) renderSummary(cache.summary);
    return;
  }

  if (shouldRender()) showAiLoading("요약 생성 중");

  await getChunks();
  const concepts = await getConcepts({ topK: 8, candidateK: 12 });

  if (shouldRender()) showAiLoading("요약 생성 중");

  const range = decideOutputRange(AI_STATE.pageCount, "summary");
  const prompt = createSummaryPrompt({
    title: AI_STATE.docTitle,
    context: JSON.stringify(concepts, null, 2),
    range,
  });

  const summary = await askClaudeJson(prompt);
  setAiCache({ summary });  // 캐시는 항상 저장 (다음에 빨리 보여주려고)

  if (shouldRender()) renderSummary(summary);
}

function renderSummary(summary) {
  const container = getCanvas();

  container.classList.remove("mindmap-mode", "quiz-mode", "ai-loading-mode");
  container.classList.add("ai-mode", "summary-mode");

  container.innerHTML = `
    <div class="ai-page">
      <section class="ai-summary-hero">
  <h1>${escapeHtml(summary.title)}</h1>

  <p class="ai-summary-lead">
    ${escapeHtml(summary.summary)}
  </p>
</section>

      <div class="ai-section-head">
        <div>
          <span>핵심 개념</span>
          <h2>문서에서 꼭 잡아야 할 내용</h2>
        </div>
      </div>

      ${(summary.key_points || []).map((item, index) => `
        <div class="ai-result-card ai-summary-card" data-index="${index}">
          <button class="ai-summary-toggle" type="button">
            <div class="ai-card-main">
              <div class="ai-card-kicker">핵심 ${index + 1}</div>
              <h3>${escapeHtml(item.title)}</h3>
              <p class="ai-card-brief">${escapeHtml(item.description)}</p>
              <div class="ai-card-meta">
                <span>${escapeHtml(sourceText(item.source_chunks))}</span>
              </div>
            </div>

            <span class="ai-small-toggle">＋</span>
          </button>

          <div class="ai-inline-explain" hidden>
            <div class="ai-inline-loading">문서 근거를 바탕으로 설명 중...</div>
          </div>
        </div>
      `).join("")}
    </div>
  `;

  container.querySelectorAll(".ai-summary-card").forEach((card) => {
    const toggle = card.querySelector(".ai-summary-toggle");
    const toggleIcon = card.querySelector(".ai-small-toggle");
const explainBox = card.querySelector(".ai-inline-explain");

    toggle.addEventListener("click", async () => {
      const index = Number(card.dataset.index);
      const point = summary.key_points[index];

      if (!explainBox.hidden) {
        explainBox.hidden = true;
        toggleIcon.textContent = "⌄";
        card.classList.remove("open");
        return;
      }

      explainBox.hidden = false;
      toggleIcon.textContent = "⌃";
      card.classList.add("open");

      if (explainBox.dataset.loaded === "true") return;

      try {
        const response = await explainSummaryPoint(point);

        explainBox.innerHTML = window.marked
          ? window.marked.parse(response)
          : `<p>${escapeHtml(response)}</p>`;

        explainBox.dataset.loaded = "true";
      } catch (err) {
        explainBox.innerHTML = `
          <p class="ai-error-text">오류: ${escapeHtml(err.message)}</p>
        `;
      }
    });
  });
}

async function explainSummaryPoint(point) {
  const chunks = await getImportantChunks({
    topK: 6,
    candidateK: 16,
  });

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
function toBrief(text, max = 95) {
  const value = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  return value.length > max
    ? value.slice(0, max) + "..."
    : value;
}