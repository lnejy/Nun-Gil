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
  saveAssetToDb,
  loadAssetFromDb,
  getConcepts,
  getImportantChunks,
  setAiCache,
  setAiMode,
  showAiLoading,
  setCanvasMode,
  sourceText,
} from "./common.js";

import {
  createSummaryExplainPrompt,
  createSummaryPrompt,
} from "./prompt.js";

export async function loadSummary({ shouldRender = () => true } = {}) {
  // 1차: sessionStorage 캐시
  const cache = getAiCache();

  // sessionStorage 캐시 있으면 즉시 사용
  if (cache.summary) {
    if (shouldRender()) renderSummary(cache.summary);
    return;
  }

  // DB에서 불러오기
  const saved = await loadAssetFromDb('SUMMARY');
  if (saved) {
    setAiCache({ summary: saved });
    if (shouldRender()) renderSummary(saved);
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

  // 세부 설명까지 모두 생성한 후 한번에 렌더링
  if (shouldRender()) showAiLoading("세부 설명 생성 중");
  await preGenerateExplanations(summary);

  setAiCache({ summary });
  saveAssetToDb('SUMMARY', summary);  // 세부 설명 포함 버전으로 저장

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

  const container = setCanvasMode("summary");
  
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

      ${(summary.key_points || []).map((item, index) => {
        const explainHtml = item.explanation
        ? renderSummaryExplain(item.explanation)
        : null;
        return `
        <div class="ai-result-card ai-summary-card" data-index="${index}">
          <button class="ai-summary-toggle" type="button">
            <div class="ai-card-main">
              <div class="ai-card-kicker">핵심 ${index + 1}.</div>
              <h3>${escapeHtml(item.title)}</h3>
              <p class="ai-card-brief">${escapeHtml(item.description)}</p>
              <div class="ai-card-meta"></div>
            </div>
            <span class="ai-small-toggle">＋</span>
          </button>
          <div class="ai-inline-explain" hidden ${explainHtml ? 'data-loaded="true"' : ''}>
            ${explainHtml ?? '<div class="ai-inline-loading">AI가 문서 근거를 바탕으로 설명 중...</div>'}
          </div>
        </div>`;
      }).join("")}
    </div>
  `;

  requestAnimationFrame(() => {
    container.querySelectorAll(".ai-inline-explain pre code").forEach((block) => {
      if (window.hljs) {
        window.hljs.highlightElement(block);
      }
    });
  });

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

      // 아직 설명이 준비 안 됐으면 대기 메시지 표시 (백그라운드가 곧 채워줌)
      if (explainBox.dataset.loaded !== "true") {
        if (!explainBox.textContent.trim() || explainBox.querySelector('.ai-inline-loading')) {
          explainBox.innerHTML = '<div class="ai-inline-loading">AI가 문서 근거를 바탕으로 설명 중...</div>';
        }
      }
    });
  });
}

async function explainSummaryPoint(point) {
  const chunks = await getImportantChunks({
    topK: 6,
    candidateK: 16,
  });

  const matchedChunks = chunks.filter((c) =>
    (point.source_chunks || []).includes(c.chunk_id)
  );

  // source_chunks 매칭이 안 되면 중요한 chunk 전체를 fallback으로 사용
  const usableChunks = matchedChunks.length > 0 ? matchedChunks : chunks;

  const sourceTexts = usableChunks
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

function renderSummaryExplain(markdown) {
  const raw = String(markdown || "").trim();

  if (!raw) {
    return `<p>추가 설명을 불러오지 못했습니다.</p>`;
  }

  const html = window.marked
    ? window.marked.parse(raw)
    : `<p>${escapeHtml(raw)}</p>`;

  const temp = document.createElement("div");
  temp.innerHTML = html;

  // prompt.js에서 ## 제목으로 내려오는 영역을 카드 섹션으로 변환
  const result = document.createDocumentFragment();
  let currentSection = null;

  Array.from(temp.childNodes).forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "H2") {
      currentSection = document.createElement("section");
      currentSection.className = "ai-explain-section";

      const title = document.createElement("div");
      title.className = "ai-explain-section-title";
      title.textContent = node.textContent.trim();

      currentSection.appendChild(title);
      result.appendChild(currentSection);
      return;
    }

    // prompt.js에서 이미 ---를 넣기 때문에 hr은 별도 출력하지 않음
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "HR") {
      return;
    }

    if (!currentSection) {
      currentSection = document.createElement("section");
      currentSection.className = "ai-explain-section";
      result.appendChild(currentSection);
    }

    currentSection.appendChild(node.cloneNode(true));
  });

  const wrapper = document.createElement("div");
  wrapper.appendChild(result);

  return wrapper.innerHTML;
}

// 모든 key_point 설명을 백그라운드에서 순차 생성 후 DOM에 즉시 반영
async function preGenerateExplanations(summary) {
  const points = summary.key_points ?? [];
  let dirty = false;

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (point.explanation) continue;  // 이미 있으면 스킵

    try {
      const response = await explainSummaryPoint(point);
      point.explanation = response;
      dirty = true;

      // DOM에서 해당 카드를 찾아 explainBox 즉시 업데이트
      const card = document.querySelector(`.ai-summary-card[data-index="${i}"]`);
      if (card) {
        const explainBox = card.querySelector(".ai-inline-explain");
        if (explainBox) {
          explainBox.innerHTML = renderSummaryExplain(response);

            explainBox.querySelectorAll("pre code").forEach((block) => {
              if (window.hljs) {
                window.hljs.highlightElement(block);
              }
            });

          explainBox.dataset.loaded = "true";
        }
      }
    } catch (_) {
      // 개별 실패는 무시하고 계속
    }
  }

  // 새로 생성된 설명이 있으면 DB + sessionStorage 동시 업데이트
  if (dirty) {
    saveAssetToDb('SUMMARY', summary);
    setAiCache({ summary });  // sessionStorage도 explanation 포함 버전으로 갱신
  }
}

function injectSummaryCompactStyle() {
  if (document.getElementById("ngSummaryCompactStyle")) return;

  const style = document.createElement("style");
  style.id = "ngSummaryCompactStyle";
  style.textContent = `
    body:has(#pdfContainer.summary-mode) {
      --ai-top: 90px;
      --ai-right: 12px;
      --ai-bottom: 14px;
      --ai-left: 12px;
      --ai-height: calc(100vh - var(--ai-top) - var(--ai-bottom));
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
      min-height: var(--ai-height) !important;
      padding: 0 !important;
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
      border-radius: 0 !important;
    }

    #pdfContainer.summary-mode .ai-page {
      width: 100%;
      min-height: var(--ai-height);
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
  margin: 0;
  padding: 18px 18px 20px;
  margin: 18px;
  font-size: 13.5px;
  line-height: 1.75;
  color: #3f4b5f;
  border-top: 1px solid #d9e2ee;
  background: #f3f5f8;
}

#pdfContainer.summary-mode .ai-explain-section {
  padding: 16px 0 18px;
  border-bottom: 1px solid #dce3ec;
}

#pdfContainer.summary-mode .ai-explain-section:first-child {
  padding-top: 0;
}

#pdfContainer.summary-mode .ai-explain-section:last-child {
  padding-bottom: 0;
  border-bottom: none;
}

#pdfContainer.summary-mode .ai-explain-section-title {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.4;
  color: #24324a;
}

#pdfContainer.summary-mode .ai-explain-section-title::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #6f98e8;
  flex: 0 0 auto;
}

#pdfContainer.summary-mode .ai-inline-explain p {
  margin: 0 0 9px;
  font-size: 13.5px;
  line-height: 1.75;
  color: #4b5870;
}

#pdfContainer.summary-mode .ai-inline-explain p:last-child {
  margin-bottom: 0;
}

#pdfContainer.summary-mode .ai-inline-explain ul,
#pdfContainer.summary-mode .ai-inline-explain ol {
  margin: 8px 0 0;
  padding-left: 20px;
}

#pdfContainer.summary-mode .ai-inline-explain li {
  margin: 5px 0;
  font-size: 13.5px;
  line-height: 1.7;
  color: #4b5870;
}

#pdfContainer.summary-mode .ai-inline-explain strong {
  color: #263449;
  font-weight: 700;
}

#pdfContainer.summary-mode .ai-inline-explain code {
  padding: 2px 5px;
  border-radius: 5px;
  background: #e7ebf1;
  color: #2f3a4d;
  font-size: 12.5px;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}

#pdfContainer.summary-mode .ai-inline-explain pre {
  margin: 11px 0 0;
  padding: 13px 14px;
  border-radius: 10px;
  background: #1f2937;
  border: 1px solid #111827;
  overflow-x: auto;
}

#pdfContainer.summary-mode .ai-inline-explain pre code {
  display: block;
  padding: 0;
  background: transparent;
  color: #e5e7eb;
  font-size: 12.5px;
  line-height: 1.65;
  white-space: pre;
}

#pdfContainer.summary-mode .ai-inline-explain blockquote {
  margin: 10px 0;
  padding: 8px 12px;
  border-left: 3px solid #9bb8ef;
  background: #edf1f7;
  color: #526174;
  border-radius: 0 8px 8px 0;
}

#pdfContainer.summary-mode .ai-inline-loading {
  color: #7b8798;
  font-size: 13.5px;
}
  `;

  document.head.appendChild(style);
}