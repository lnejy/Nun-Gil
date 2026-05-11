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
  loadAssetFromDb,
  saveAssetToDb,
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
  // 1차: sessionStorage 캐시
  const cache = getAiCache();
  if (cache.summary) {
    if (shouldRender()) renderSummary(cache.summary);
    return;
  }

  // 2차: Supabase DB
  if (shouldRender()) showAiLoading("저장된 요약 확인 중");
  const dbAsset = await loadAssetFromDb('SUMMARY');
  if (dbAsset) {
    setAiCache({ summary: dbAsset });
    if (shouldRender()) renderSummary(dbAsset);
    return;
  }

  // 3차: Claude API 생성
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
  setAiCache({ summary });
  saveAssetToDb('SUMMARY', summary);   // DB 저장

  if (shouldRender()) renderSummary(summary);
}

function getSummaryTitle(summary) {
  const rawTitle = summary?.title || AI_STATE.docTitle || window._docTitle || "문서";

  return String(rawTitle)
    .replace(/^눈길\s*[-–—:]*\s*/i, "")
    .replace(/\.(pdf|ppt|pptx)$/i, "")
    .replace(/\s*요약\s*$/i, "")
    .trim() || "문서";
}

function renderSummary(summary) {
  injectSummaryCompactStyle();

  const container = getCanvas();

  container.classList.remove("mindmap-mode", "quiz-mode", "ai-loading-mode");
  container.classList.add("ai-mode", "summary-mode");

  container.innerHTML = `
    <div class="ai-page">
      <section class="ai-summary-hero">
  <div class="ng-quiz-badge ai-summary-badge">요약</div>

  <h1>${escapeHtml(getSummaryTitle(summary))}</h1>

  <p class="ai-summary-lead">
    ${escapeHtml(summary.summary)}
  </p>
</section>

      <div class="ai-section-head">
        <div>
          <span>핵심 개념 - 문서에서 꼭 잡아야 할 내용</span>
        </div>
      </div>

      ${(summary.key_points || []).map((item, index) => `
        <div class="ai-result-card ai-summary-card" data-index="${index}">
          <button class="ai-summary-toggle" type="button">
            <div class="ai-card-main">
              <div class="ai-card-kicker">핵심 ${index + 1}.</div>
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

      // 이미 저장된 설명이 있으면 바로 렌더
      if (point._explain) {
        explainBox.innerHTML = window.marked
          ? window.marked.parse(point._explain)
          : `<p>${escapeHtml(point._explain)}</p>`;
        explainBox.dataset.loaded = "true";
        return;
      }

      try {
        const response = await explainSummaryPoint(point);

        explainBox.innerHTML = window.marked
          ? window.marked.parse(response)
          : `<p>${escapeHtml(response)}</p>`;

        explainBox.dataset.loaded = "true";

        // 설명을 summary 객체에 저장 → 캐시 + DB 갱신
        point._explain = response;
        setAiCache({ summary });
        saveAssetToDb('SUMMARY', summary);
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

function injectSummaryCompactStyle() {
  if (document.getElementById("ngSummaryCompactStyle")) return;

  const style = document.createElement("style");
  style.id = "ngSummaryCompactStyle";
  style.textContent = `
    body:has(#pdfContainer.summary-mode) {
      --quiz-top: 90px;
      --quiz-right: 32px;
      --quiz-bottom: 14px;
      --quiz-left-gap: 6px;
      --quiz-height: calc(100vh - var(--quiz-top) - var(--quiz-bottom));
    }

    body:has(#pdfContainer.summary-mode) .content-container {
      margin-top: var(--quiz-top) !important;
      padding: 0 var(--quiz-right) var(--quiz-bottom) var(--quiz-left-gap) !important;
      align-items: stretch !important;
    }

    body:has(#pdfContainer.summary-mode) .center-area {
      width: 100% !important;
      max-width: none !important;
      flex: 1 1 auto !important;
      justify-content: stretch !important;
      align-items: stretch !important;
      display: flex !important;
    }

    body:has(#pdfContainer.summary-mode) #pdfContainer {
      width: 100% !important;
      flex: 1 1 auto !important;
      max-width: none !important;
      min-height: var(--quiz-height) !important;
      padding: 0 !important;
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
      border-radius: 0 !important;
    }

    #pdfContainer.summary-mode .ai-page {
      width: 100%;
      min-height: var(--quiz-height);
      padding: 28px 22px;
      overflow-y: auto;
      border: 1px solid #e6edf5;
      border-radius: 14px;
      background: #ffffff;
      box-shadow: 0 8px 26px rgba(15, 23, 42, 0.035);
    }

    #pdfContainer.summary-mode .ai-summary-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 9px;
  margin-bottom: 10px;
  border-radius: 999px;
  background: #eef4ff;
  color: #5b84d6;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
}

    #pdfContainer.summary-mode .ai-summary-hero {
      padding: 0;
      margin: 0 0 22px;
      background: transparent;
      border: none;
      box-shadow: none;
    }

    #pdfContainer.summary-mode .ai-summary-hero h1 {
      margin: 0 0 12px;
      font-size: 22px;
      font-weight: 600;
      line-height: 1.35;
      color: #1f2a44;
      letter-spacing: -0.2px;
    }

    #pdfContainer.summary-mode .ai-summary-lead {
      margin: 0;
      font-size: 14.5px;
      font-weight: 400;
      line-height: 1.7;
      color: #64748b;
    }

    #pdfContainer.summary-mode .ai-section-head {
  margin: 18px 0 12px;
  padding: 16px 0 0;
  border-top: 1px solid #eef2f7;
}

    #pdfContainer.summary-mode .ai-section-head span {
      display: inline-flex;
      align-items: center;
      padding: 5px 10px;
      margin-bottom: 8px;
      border-radius: 999px;
      background: #eef4ff;
      color: #5b84d6;
      font-size: 12.5px;
      font-weight: 500;
      line-height: 1.2;
    }

    #pdfContainer.summary-mode .ai-section-head h2 {
      margin: 0;
      font-size: 15px;
      font-weight: 550;
      color: #24324a;
      line-height: 1.45;
    }

    #pdfContainer.summary-mode .ai-result-card {
      margin-bottom: 10px;
      border-radius: 13px;
      border: 1px solid #e6edf6;
      background: #ffffff;
      box-shadow: 0 8px 20px rgba(47, 75, 116, 0.035);
      overflow: hidden;
    }

    #pdfContainer.summary-mode .ai-summary-toggle {
      padding: 15px 17px;
    }

    #pdfContainer.summary-mode .ai-card-kicker {
      margin-bottom: 5px;
      font-size: 11.5px;
      font-weight: 600;
      color: #5b84d6;
    }

    #pdfContainer.summary-mode .ai-card-main h3 {
      margin: 0 0 6px;
      font-size: 14.5px;
      font-weight: 550;
      line-height: 1.45;
      color: #24324a;
    }

    #pdfContainer.summary-mode .ai-card-brief {
      margin: 0;
      font-size: 13px;
      line-height: 1.65;
      color: #526174;
    }

    #pdfContainer.summary-mode .ai-card-meta {
      margin-top: 8px;
      font-size: 11px;
      color: #94a3b8;
    }

    #pdfContainer.summary-mode .ai-small-toggle {
      font-size: 16px;
    }

    #pdfContainer.summary-mode .ai-inline-explain {
      padding: 13px 16px 15px;
      font-size: 13px;
      line-height: 1.7;
      color: #526174;
      border-top: 1px solid #eef2f7;
      background: linear-gradient(180deg, #243041 0%, #1e293b 100%);
    }

    #pdfContainer.summary-mode .ai-inline-explain p,
    #pdfContainer.summary-mode .ai-inline-explain li {
      font-size: 13px;
      line-height: 1.7;
    }
  `;

  document.head.appendChild(style);
}