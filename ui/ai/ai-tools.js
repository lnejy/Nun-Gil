// ui/ai-tools.js
// viewer.html용 AI 기능 통합 코드
// - 기존 Supabase/PDF 렌더링 구조 유지
// - AI 결과는 sessionStorage에 캐싱
// - 요약 / 마인드맵 / 퀴즈는 버튼을 누를 때마다 필요할 때만 생성
// - 나중에 DB 저장으로 바꾸려면 getAiCache/setAiCache만 교체하면 됨

(function () {
  const CONTEXT_LIMIT = 22000;

  let currentDocId = null;
  let initialized = false;

  window.addEventListener("viewer-init", () => {
    if (initialized) return;
    initialized = true;

    const params = new URLSearchParams(location.search);
    currentDocId = params.get("doc_id") || "demo";

    bindAiToolButtons();
  });

  function bindAiToolButtons() {
    const buttons = [...document.querySelectorAll(".sb-tool-item")];

    buttons.forEach((btn) => {
      const label = btn.textContent.trim();

      btn.addEventListener("click", async () => {
        try {
          setActiveTool(btn);

          if (label.includes("원본")) {

            clearAiCanvasMode();

            // layout viewer 우선
            if (
              window._layoutJsonUrl &&
              typeof window.renderLayoutViewer === "function"
            ) {

              await window.renderLayoutViewer(
                window._layoutJsonUrl,
                {
                  containerId: "pdfContainer",
                  pdfUrl: window._pdfUrl,
                }
              );

            }
            // fallback
            else if (
              window._pdfUrl &&
              typeof window.renderPdf === "function"
            ) {

              window.renderPdf(window._pdfUrl);

            }

            return;
          }

          if (label.includes("요약")) {
            await loadSummary();
            return;
          }

          if (label.includes("마인드맵")) {
            await loadMindmap();
            return;
          }

          if (label.includes("퀴즈")) {
            await loadQuiz();
          }
        } catch (err) {
          console.error(err);
          showAiError(err.message);
        }
      });
    });
  }

  function clearAiCanvasMode() {
    const canvas = document.getElementById("pdfContainer");
    if (!canvas) return;
    canvas.classList.remove("ai-mode", "mindmap-mode");
  }

  function setActiveTool(activeBtn) {
    document.querySelectorAll(".sb-tool-item").forEach((btn) => {
      btn.classList.remove("active");
    });
    activeBtn.classList.add("active");
  }

  function getCacheKey() {
    return `nungil_ai_${currentDocId || "unknown"}`;
  }

  function getAiCache() {
    try {
      return JSON.parse(sessionStorage.getItem(getCacheKey()) || "{}");
    } catch {
      return {};
    }
  }

  function setAiCache(next) {
    const prev = getAiCache();
    sessionStorage.setItem(getCacheKey(), JSON.stringify({
      ...prev,
      ...next,
      updated_at: new Date().toISOString()
    }));
  }

  async function getChunks() {
    const cache = getAiCache();

    if (Array.isArray(cache.chunks) && cache.chunks.length > 0) {
      return cache.chunks;
    }

    if (!window._pdfUrl) {
      throw new Error("PDF URL이 없습니다.");
    }

    showAiLoading("문서 텍스트 추출 중");
    const chunks = await extractPdfChunksFromUrl(window._pdfUrl);
    setAiCache({ chunks });

    return chunks;
  }

  async function extractPdfChunksFromUrl(url) {
    if (!window.pdfjsLib) {
      throw new Error("pdf.js가 로드되지 않았습니다.");
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

    const pdf = await pdfjsLib.getDocument(url).promise;
    const pages = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();

      const text = content.items
        .map((item) => item.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      pages.push({
        page: pageNum,
        text
      });
    }

    return createSemanticChunks({
      documentId: currentDocId || "doc",
      title: window._docTitle || document.title || "문서",
      pages
    });
  }

  function createSemanticChunks({
    documentId = "doc",
    title = "문서",
    pages,
    maxChars = 1200,
    minChars = 250,
    overlapChars = 120
  }) {
    const blocks = [];

    for (const page of pages) {
      const pageBlocks = splitPageIntoBlocks(page.text);
      for (const block of pageBlocks) {
        blocks.push({
          page: page.page,
          text: block.text,
          type: block.type
        });
      }
    }

    const chunks = [];
    let current = null;
    let section = title;
    let index = 1;

    for (const block of blocks) {
      if (block.type === "heading") {
        section = block.text;
        continue;
      }

      if (!current) {
        current = makeEmptyChunk(documentId, title, section, block.page);
      }

      const nextText = current.text
        ? `${current.text}\n\n${block.text}`
        : block.text;

      if (nextText.length > maxChars && current.text.length >= minChars) {
        chunks.push(finalizeChunk(current, index++));
        current = makeEmptyChunk(documentId, title, section, block.page);

        const overlap = getOverlapText(chunks[chunks.length - 1].text, overlapChars);
        current.text = overlap ? `${overlap}\n\n${block.text}` : block.text;
        current.page_start = block.page;
        current.page_end = block.page;
      } else {
        current.text = nextText;
        current.page_end = block.page;
      }

      while (current.text.length > maxChars * 1.4) {
        const [head, tail] = splitLongText(current.text, maxChars, overlapChars);
        current.text = head;
        chunks.push(finalizeChunk(current, index++));

        current = makeEmptyChunk(documentId, title, section, block.page);
        current.text = tail;
        current.page_start = block.page;
        current.page_end = block.page;
      }
    }

    if (current && current.text.trim()) {
      chunks.push(finalizeChunk(current, index++));
    }

    return chunks;
  }

  function makeEmptyChunk(documentId, title, section, page) {
    return {
      chunk_id: "",
      document_id: documentId,
      title,
      section,
      page_start: page,
      page_end: page,
      page,
      text: ""
    };
  }

  function finalizeChunk(chunk, index) {
    return {
      ...chunk,
      chunk_id: `c${String(index).padStart(4, "0")}`,
      text: chunk.text
        .replace(/\s+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    };
  }

  function splitPageIntoBlocks(rawText) {
    const text = String(rawText || "")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (!text) return [];

    const roughBlocks = text
      .split(/\n{2,}|(?<=다\.|요\.|음\.|함\.|됨\.|임\.|[.!?])\s+(?=[가-힣A-Z0-9])/g)
      .map((t) => t.trim())
      .filter(Boolean);

    return roughBlocks.map((block) => ({
      text: block,
      type: isHeading(block) ? "heading" : "paragraph"
    }));
  }

  function isHeading(text) {
    const t = text.trim();

    if (t.length > 80) return false;

    return (
      /^(\d+(\.\d+)*|[IVX]+|[가-힣]\.)\s+/.test(t) ||
      /^(Chapter|Section|Part|Unit|제\s*\d+\s*장|제\s*\d+\s*절)/i.test(t) ||
      /^[■□●○▶\-]\s?/.test(t) ||
      (t.length <= 30 && !/[.?!。]$/.test(t))
    );
  }

  function splitLongText(text, maxChars, overlapChars) {
    const safePoint = findSafeSplitPoint(text, maxChars);
    const head = text.slice(0, safePoint).trim();
    const overlap = getOverlapText(head, overlapChars);
    const tail = `${overlap}\n\n${text.slice(safePoint).trim()}`.trim();

    return [head, tail];
  }

  function findSafeSplitPoint(text, maxChars) {
    const slice = text.slice(0, maxChars);

    const paragraphPoint = slice.lastIndexOf("\n\n");
    if (paragraphPoint > maxChars * 0.55) return paragraphPoint;

    const sentencePoints = [".", "다.", "요.", "!", "?"]
      .map((mark) => slice.lastIndexOf(mark))
      .filter((pos) => pos > maxChars * 0.55);

    if (sentencePoints.length > 0) {
      return Math.max(...sentencePoints) + 1;
    }

    const spacePoint = slice.lastIndexOf(" ");
    if (spacePoint > maxChars * 0.55) return spacePoint;

    return maxChars;
  }

  function getOverlapText(text, overlapChars) {
    if (!text || text.length <= overlapChars) return text || "";
    return text.slice(-overlapChars).trim();
  }

  function buildContext(chunks, maxChars = CONTEXT_LIMIT) {
    let context = "";

    for (const chunk of chunks) {
      const pageInfo = chunk.page_start === chunk.page_end
        ? `page ${chunk.page_start}`
        : `pages ${chunk.page_start}-${chunk.page_end}`;

      const block =
        `[${chunk.chunk_id} | ${pageInfo} | section: ${chunk.section || "unknown"}]
${chunk.text}

`;

      if ((context + block).length > maxChars) break;
      context += block;
    }

    return context.trim();
  }

  async function askClaudeJson(prompt) {
    const res = await fetch("/api/claude", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prompt })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error?.message || "Claude 요청 실패");
    }

    const text = data.content?.[0]?.text || "";

    if (!text) {
      throw new Error("Claude 응답이 비어 있습니다.");
    }

    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    return JSON.parse(cleaned);
  }

  async function askClaudeText(prompt) {
    const res = await fetch("/api/claude", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prompt })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error?.message || "Claude 요청 실패");
    }

    return data.content?.[0]?.text || "응답을 불러오지 못했습니다.";
  }

  async function loadSummary() {
    const cache = getAiCache();

    if (cache.summary) {
      renderSummary(cache.summary);
      return;
    }

    showAiLoading("요약 생성 중");
    const chunks = await getChunks();

    const prompt = `
너는 업로드된 PDF 문서만 근거로 학습 요약을 생성하는 시스템이다.

규칙:
- 반드시 [문서 chunk] 안의 내용만 사용한다.
- 문서에 없는 내용은 추측하지 않는다.
- 근거가 부족하면 "문서에서 확인 불가"라고 작성한다.
- 출력은 JSON 객체만 반환한다.
- JSON 앞뒤에 설명, markdown, 코드블록을 붙이지 않는다.
- 모든 key_points에는 실제 chunk_id를 source_chunks에 넣는다.
- 같은 내용을 반복하지 않는다.

목표:
- 시험 대비에 도움이 되도록 핵심 개념, 정의, 절차, 차이점, 주의사항 중심으로 요약한다.

[문서 제목]
${window._docTitle || "문서"}

[문서 chunk]
${buildContext(chunks)}

출력 형식:
{
  "title": "문서 제목",
  "summary": "문서 전체 요약 5문장",
  "key_points": [
    {
      "id": "s1",
      "title": "핵심 내용",
      "description": "설명 2~3문장",
      "source_chunks": ["c0001"]
    }
  ]
}

조건:
- key_points는 정확히 5개 만든다.
`;

    const summary = await askClaudeJson(prompt);
    setAiCache({ summary });
    renderSummary(summary);
  }

  async function loadMindmap() {
    const cache = getAiCache();

    if (cache.mindmap) {
      renderMindmap(cache.mindmap);
      return;
    }

    showAiLoading("마인드맵 생성 중");
    const chunks = await getChunks();

    const prompt = `
너는 업로드된 PDF 문서만 근거로 학습용 마인드맵 JSON을 생성하는 시스템이다.

규칙:
- 반드시 [문서 chunk] 안의 내용만 사용한다.
- 문서에 없는 내용은 추측하지 않는다.
- 근거가 부족한 개념은 만들지 않는다.
- 출력은 JSON 객체만 반환한다.
- JSON 앞뒤에 설명, markdown, 코드블록을 붙이지 않는다.
- 모든 노드에는 실제 chunk_id를 source_chunks에 넣는다.
- 같은 개념을 중복 생성하지 않는다.

목표:
- 문서의 핵심 개념을 상위 개념 → 하위 개념 → 세부 개념 구조로 정리한다.
- 학습자가 문서 구조를 빠르게 이해할 수 있도록 만든다.

[문서 제목]
${window._docTitle || "문서"}

[문서 chunk]
${buildContext(chunks)}

출력 형식:
{
  "name": "문서 제목",
  "detail": "문서 전체 설명",
  "source_chunks": [],
  "children": [
    {
      "name": "핵심 개념",
      "detail": "개념 설명",
      "source_chunks": ["c0001"],
      "children": []
    }
  ]
}

조건:
- 최대 3단계까지만 만든다.
- 최상위 핵심 개념은 4~6개 만든다.
- 각 노드의 name은 15자 이내로 짧게 작성한다.
`;

    const mindmap = await askClaudeJson(prompt);
    setAiCache({ mindmap });
    renderMindmap(mindmap);
  }

  async function loadQuiz() {
    const cache = getAiCache();

    if (cache.quiz) {
      renderQuiz(cache.quiz);
      return;
    }

    showAiLoading("퀴즈 생성 중");
    const chunks = await getChunks();

    const prompt = `
너는 업로드된 PDF 문서만 근거로 시험 대비 객관식 퀴즈를 생성하는 시스템이다.

규칙:
- 반드시 [문서 chunk] 안의 내용만 사용한다.
- 문서에 없는 상식 문제는 만들지 않는다.
- 근거가 부족하면 문제로 만들지 않는다.
- 출력은 JSON 배열만 반환한다.
- JSON 앞뒤에 설명, markdown, 코드블록을 붙이지 않는다.
- 모든 문제에는 실제 chunk_id를 source_chunks에 넣는다.
- 정답은 choices 안에 있는 문자열과 완전히 일치해야 한다.

목표:
- 핵심 개념, 정의, 차이점, 절차, 주의사항 중심으로 문제를 만든다.
- 단순 암기 문제와 이해 확인 문제를 섞어서 만든다.

[문서 제목]
${window._docTitle || "문서"}

[문서 chunk]
${buildContext(chunks)}

출력 형식:
[
  {
    "question": "문제",
    "choices": ["선택지1", "선택지2", "선택지3", "선택지4"],
    "answer": "정답",
    "explanation": "문서 근거 기반 해설",
    "source_chunks": ["c0001"]
  }
]

조건:
- 문제는 정확히 5개 만든다.
- 선택지는 반드시 4개다.
- answer는 choices 중 하나여야 한다.
`;

    const quiz = await askClaudeJson(prompt);
    setAiCache({ quiz });
    renderQuiz(quiz);
  }

  function showAiLoading(label) {
    const container = getCanvas();

    resetViewerModes(container);
    container.classList.add("ai-mode", "ai-loading-mode");

    container.replaceChildren();
    container.scrollTop = 0;
    window.scrollTo(0, 0);

    container.innerHTML = `
    <div class="ai-loading-screen">
      <div class="ai-spinner"></div>
      <strong>${escapeHtml(label)}</strong>
      <span>문서 근거를 바탕으로 생성 중입니다...</span>
    </div>
  `;
  }

  function showAiError(message) {
    const container = getCanvas();
    container.classList.remove("mindmap-mode");
    container.classList.add("ai-mode");
    container.innerHTML = `
      <div class="pdf-no-content">AI 생성 실패: ${escapeHtml(message)}</div>
    `;
  }

  function getCanvas() {
    const canvas = document.getElementById("pdfContainer");
    if (!canvas) throw new Error("pdfContainer를 찾을 수 없습니다.");
    return canvas;
  }


  function renderQuiz(quiz) {
    const container = getCanvas();
    container.classList.remove("mindmap-mode");
    container.classList.add("ai-mode");
    container.innerHTML = `
      <div class="ai-page">
        <h1 class="ai-title">퀴즈</h1>
        ${(quiz || []).map((q, idx) => `
          <div class="ai-result-card">
            <h3>Q${idx + 1}. ${escapeHtml(q.question)}</h3>
            <div class="ai-choice-list">
              ${(q.choices || []).map((choice) => `
                <button class="ai-choice" data-answer="${escapeHtml(q.answer)}">${escapeHtml(choice)}</button>
              `).join("")}
            </div>
            <div class="ai-quiz-answer">
              <strong>정답:</strong> ${escapeHtml(q.answer)}
            </div>
            <p>${escapeHtml(q.explanation)}</p>
            <div class="ai-source">${escapeHtml(sourceText(q.source_chunks))}</div>
          </div>
        `).join("")}
      </div>
    `;

    container.querySelectorAll(".ai-choice").forEach((btn) => {
      btn.addEventListener("click", () => {
        const answer = btn.dataset.answer;
        const isCorrect = btn.textContent.trim() === answer;
        btn.classList.add(isCorrect ? "correct" : "wrong");
      });
    });
  }

  function renderMindmap(mindmapData) {
    const container = getCanvas();
    container.classList.add("ai-mode", "mindmap-mode");
    container.innerHTML = `
      <div class="mindmap-app">
        <main class="mindmap-map-area">
          <div class="mindmap-logo">눈길 · D3 마인드맵</div>
          <div class="mindmap-toolbar">
            <button type="button" id="mindmapZoomIn" title="확대">＋</button>
            <button type="button" id="mindmapZoomOut" title="축소">－</button>
            <button type="button" id="mindmapToggleAll" title="전체 펼치기">⤢</button>
          </div>
        </main>

        <aside class="mindmap-detail-panel">
          <div class="mindmap-detail-card" id="mindmapDetailCard">
            <div class="mindmap-pill">👀 세부 설명</div>
            <h2>마인드맵 탐색</h2>
            <p>네모 카드를 클릭하면 상세 설명이 보이고, 하위 개념이 있으면 부드럽게 펼치거나 접힙니다.</p>
            <p class="mindmap-hint">휠로 확대/축소, 드래그로 화면 이동이 가능합니다.</p>
          </div>
        </aside>
      </div>
    `;

    const nodeWidth = 164;
    const nodeHeight = 50;
    const duration = 720;
    const ease = d3.easeCubicInOut;

    let allExpanded = false;

    const svgRoot = d3.select(container.querySelector(".mindmap-map-area")).append("svg");
    const graphContainer = svgRoot.append("g");

    const zoom = d3.zoom()
      .scaleExtent([0.35, 2.6])
      .on("zoom", (event) => graphContainer.attr("transform", event.transform));

    svgRoot.call(zoom);

    const root = d3.hierarchy(mindmapData);
    root.x0 = 360;
    root.y0 = 120;
    root.children?.forEach(collapse);

    function collapse(d) {
      if (d.children) {
        d._children = d.children;
        d._children.forEach(collapse);
        d.children = null;
      }
    }

    function expand(d) {
      if (d._children) {
        d.children = d._children;
        d._children = null;
      }
      if (d.children) d.children.forEach(expand);
    }

    function toggle(d) {
      if (d.children) {
        d._children = d.children;
        d.children = null;
      } else if (d._children) {
        d.children = d._children;
        d._children = null;
      }
    }
    function renderMindmap(data) {
      const container = document.getElementById("pdfContainer");

      container.innerHTML = `<div id="mindmap"></div>`;

      const width = container.clientWidth;
      const height = 600;

      const svg = d3.select("#mindmap")
        .append("svg")
        .attr("width", width)
        .attr("height", height);

      const root = d3.hierarchy(data);

      const treeLayout = d3.tree().size([height - 40, width - 160]);
      treeLayout(root);

      // 링크
      svg.selectAll("line")
        .data(root.links())
        .enter()
        .append("line")
        .attr("x1", d => d.source.y)
        .attr("y1", d => d.source.x)
        .attr("x2", d => d.target.y)
        .attr("y2", d => d.target.x)
        .attr("stroke", "#ccc");

      // 노드
      const node = svg.selectAll("g")
        .data(root.descendants())
        .enter()
        .append("g")
        .attr("transform", d => `translate(${d.y},${d.x})`);

      node.append("circle")
        .attr("r", 6)
        .attr("fill", "#78a3ea");

      node.append("text")
        .attr("dx", 10)
        .attr("dy", 4)
        .text(d => d.data.name);
    }
    function update(source) {
      const treeLayout = d3.tree().nodeSize([92, 245]);
      treeLayout(root);

      const nodes = root.descendants();
      const links = root.links();

      nodes.forEach((d) => d.y = d.depth * 245);

      const transition = d3.transition()
        .duration(duration)
        .ease(ease);

      const link = graphContainer.selectAll("path.mindmap-link")
        .data(links, (d) => d.target.data.name);

      link.enter()
        .append("path")
        .attr("class", "mindmap-link")
        .attr("opacity", 0)
        .attr("d", () => {
          const o = { x: source.x0, y: source.y0 };
          return diagonal({ source: o, target: o });
        })
        .transition(transition)
        .attr("opacity", 1)
        .attr("d", diagonal);

      link.transition(transition)
        .attr("d", diagonal)
        .attr("opacity", 1);

      link.exit()
        .transition(transition)
        .attr("opacity", 0)
        .attr("d", () => {
          const o = { x: source.x, y: source.y };
          return diagonal({ source: o, target: o });
        })
        .remove();

      const node = graphContainer.selectAll("g.mindmap-node")
        .data(nodes, (d) => d.data.name);

      const nodeEnter = node.enter()
        .append("g")
        .attr("class", "mindmap-node")
        .attr("transform", () => `translate(${source.y0 + 120},${source.x0 + 330}) scale(0.72)`)
        .style("opacity", 0)
        .on("click", function (event, d) {
          event.stopPropagation();

          d3.selectAll(".mindmap-node").classed("selected", false);
          d3.select(this).classed("selected", true);

          showMindmapDetail(d);
          pulse(d3.select(this));

          if (d.children || d._children) {
            toggle(d);
            update(d);
          }
        })
        .on("mouseover", function () {
          d3.select(this).raise();
          d3.select(this).select("rect")
            .transition()
            .duration(220)
            .ease(d3.easeCubicOut)
            .attr("x", -nodeWidth / 2 - 7)
            .attr("y", -nodeHeight / 2 - 4)
            .attr("width", nodeWidth + 14)
            .attr("height", nodeHeight + 8);
        })
        .on("mouseout", function () {
          d3.select(this).select("rect")
            .transition()
            .duration(220)
            .ease(d3.easeCubicOut)
            .attr("x", -nodeWidth / 2)
            .attr("y", -nodeHeight / 2)
            .attr("width", nodeWidth)
            .attr("height", nodeHeight);
        });

      nodeEnter.append("rect")
        .attr("class", "mindmap-node-card")
        .attr("x", -nodeWidth / 2)
        .attr("y", -nodeHeight / 2)
        .attr("width", nodeWidth)
        .attr("height", nodeHeight);

      nodeEnter.append("text")
        .attr("class", "mindmap-node-label")
        .attr("text-anchor", "middle")
        .attr("dy", 5)
        .text((d) => shorten(d.data.name));

      nodeEnter.append("text")
        .attr("class", "mindmap-arrow-text")
        .attr("text-anchor", "middle")
        .attr("x", nodeWidth / 2 - 18)
        .attr("dy", 5)
        .style("display", (d) => d._children ? "block" : "none")
        .text("›");

      const nodeUpdate = nodeEnter.merge(node);

      nodeUpdate.transition(transition)
        .attr("transform", (d) => `translate(${d.y + 120},${d.x + 330}) scale(1)`)
        .style("opacity", 1);

      nodeUpdate.select(".mindmap-arrow-text")
        .style("display", (d) => d._children ? "block" : "none")
        .text("›");

      node.exit()
        .transition(transition)
        .attr("transform", () => `translate(${source.y + 120},${source.x + 330}) scale(0.72)`)
        .style("opacity", 0)
        .remove();

      graphContainer.selectAll("path.mindmap-link").lower();
      graphContainer.selectAll("g.mindmap-node").raise();

      fitToVisibleNodes();

      nodes.forEach((d) => {
        d.x0 = d.x;
        d.y0 = d.y;
      });
    }

    function diagonal(d) {
      const sx = d.source.x + 330;
      const sy = d.source.y + 120;
      const tx = d.target.x + 330;
      const ty = d.target.y + 120;

      return `M ${sy} ${sx}
              C ${(sy + ty) / 2} ${sx},
                ${(sy + ty) / 2} ${tx},
                ${ty} ${tx}`;
    }

    function pulse(selection) {
      selection.select("rect")
        .transition()
        .duration(140)
        .ease(d3.easeCubicOut)
        .attr("x", -nodeWidth / 2 - 10)
        .attr("y", -nodeHeight / 2 - 6)
        .attr("width", nodeWidth + 20)
        .attr("height", nodeHeight + 12)
        .transition()
        .duration(260)
        .ease(d3.easeCubicOut)
        .attr("x", -nodeWidth / 2)
        .attr("y", -nodeHeight / 2)
        .attr("width", nodeWidth)
        .attr("height", nodeHeight);
    }

    function showMindmapDetail(d) {
      const childNames = [...(d.children || []), ...(d._children || [])]
        .map((child) => `<li>${escapeHtml(child.data.name)}</li>`)
        .join("");

      const source = sourceText(d.data.source_chunks);

      document.getElementById("mindmapDetailCard").innerHTML = `
        <div class="mindmap-pill">👀 세부 설명</div>
        <h2>${escapeHtml(d.data.name)}</h2>
        <p>${escapeHtml(d.data.detail || "세부 설명이 없습니다.")}</p>
        <div class="ai-source">${escapeHtml(source)}</div>
        <hr style="border:0;border-top:1px solid #dde7f5;margin:18px 0;" />
        <p><strong>하위 개념</strong></p>
        <ul>${childNames || "<li>하위 개념 없음</li>"}</ul>
        <p class="mindmap-hint">네모 카드를 누르면 상세 보기와 하위 개념 펼치기/접기가 함께 작동합니다.</p>
      `;
    }

    function zoomInMindmap() {
      svgRoot.transition()
        .duration(520)
        .ease(ease)
        .call(zoom.scaleBy, 1.2);
    }

    function zoomOutMindmap() {
      svgRoot.transition()
        .duration(520)
        .ease(ease)
        .call(zoom.scaleBy, 0.8);
    }

    function toggleAllMindmap() {
      const btn = document.getElementById("mindmapToggleAll");

      if (allExpanded) {
        root.children?.forEach(collapse);
        allExpanded = false;
        btn.title = "전체 펼치기";
        btn.innerHTML = "⤢";
      } else {
        expand(root);
        allExpanded = true;
        btn.title = "전체 접기";
        btn.innerHTML = "⤡";
      }

      update(root);
    }

    function fitToVisibleNodes() {
      const nodes = root.descendants();
      const area = container.querySelector(".mindmap-map-area");

      const minX = d3.min(nodes, (d) => d.x + 330 - nodeHeight);
      const maxX = d3.max(nodes, (d) => d.x + 330 + nodeHeight);
      const minY = d3.min(nodes, (d) => d.y + 120 - nodeWidth);
      const maxY = d3.max(nodes, (d) => d.y + 120 + nodeWidth);

      const width = maxY - minY;
      const height = maxX - minX;

      const areaWidth = area.clientWidth;
      const areaHeight = area.clientHeight;

      const scale = Math.min(
        areaWidth / (width + 260),
        areaHeight / (height + 260),
        1.35
      );

      const translateX = areaWidth / 2 - ((minY + maxY) / 2) * scale;
      const translateY = areaHeight / 2 - ((minX + maxX) / 2) * scale;

      svgRoot.transition()
        .duration(620)
        .ease(ease)
        .call(
          zoom.transform,
          d3.zoomIdentity.translate(translateX, translateY).scale(scale)
        );
    }

    container.querySelector("#mindmapZoomIn").addEventListener("click", zoomInMindmap);
    container.querySelector("#mindmapZoomOut").addEventListener("click", zoomOutMindmap);
    container.querySelector("#mindmapToggleAll").addEventListener("click", toggleAllMindmap);

    update(root);
  }

  function sourceText(sourceChunks) {
    return sourceChunks?.length ? `근거: ${sourceChunks.join(", ")}` : "";
  }

  function shorten(text) {
    const value = String(text || "");
    return value.length > 12 ? value.slice(0, 12) + "…" : value;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
