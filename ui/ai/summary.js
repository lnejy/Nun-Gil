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

  // 혹시 h1이 들어오면 완전히 제거
  temp.querySelectorAll("h1").forEach((h1) => h1.remove());

  const result = document.createDocumentFragment();
  let currentSection = null;
  let skipSection = false;

  Array.from(temp.childNodes).forEach((node) => {
    // ## 제목 기준으로 섹션 시작
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "H2") {
      const sectionTitle = node.textContent.trim();

      // 토글 열기 전 핵심 설명과 겹치기 쉬워서 제거
      if (sectionTitle === "개념 설명") {
        currentSection = null;
        skipSection = true;
        return;
      }

      skipSection = false;

      currentSection = document.createElement("section");
      currentSection.className = "ai-explain-section";

      const title = document.createElement("div");
      title.className = "ai-explain-section-title";
      title.textContent = sectionTitle;

      currentSection.appendChild(title);
      result.appendChild(currentSection);
      return;
    }

    // --- 구분선은 화면에 따로 출력하지 않음
    if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "HR") {
      return;
    }

    // 개념 설명 섹션 안의 본문은 전부 건너뜀
    if (skipSection) {
      return;
    }

    // H2 섹션이 만들어지기 전의 잡텍스트는 출력하지 않음
    if (!currentSection) {
      return;
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