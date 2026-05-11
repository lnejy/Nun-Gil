// ui/ai/마인드맵.js
// 사용자가 보낸 mindmap.html의 D3 구조를 viewer용 함수로 변환한 버전

import {
  AI_STATE,
  askClaudeJson,
  decideOutputRange,
  escapeHtml,
  getAiCache,
  getCanvas,
  getChunks,
  getConcepts,
  loadAssetFromDb,
  saveAssetToDb,
  setAiCache,
  setAiMode,
  showAiLoading,
  sourceText,
} from "./common.js";

import {
  createMindmapPrompt,
  createConceptExtractPrompt,
} from "./prompt.js";

export async function loadMindmap({ shouldRender = () => true } = {}) {
  // 1차: sessionStorage 캐시
  const cache = getAiCache();
  if (cache.mindmap) {
    if (shouldRender()) renderMindmap(cache.mindmap);
    return;
  }

  // 2차: Supabase DB
  if (shouldRender()) showAiLoading("저장된 마인드맵 확인 중");
  const dbAsset = await loadAssetFromDb('MINDMAP');
  if (dbAsset) {
    setAiCache({ mindmap: dbAsset });
    if (shouldRender()) renderMindmap(dbAsset);
    return;
  }

  // 3차: Claude API 생성
  if (shouldRender()) showAiLoading("마인드맵 생성 중");

  await getChunks();
  const concepts = await getConcepts({ topK: 8, candidateK: 12 });

  if (shouldRender()) showAiLoading("마인드맵 생성 중");

  const range = decideOutputRange(AI_STATE.pageCount, "mindmap");
  const prompt = createMindmapPrompt({
    title: AI_STATE.docTitle,
    context: JSON.stringify(concepts, null, 2),
    range,
  });

  const mindmap = await askClaudeJson(prompt);
  setAiCache({ mindmap });
  saveAssetToDb('MINDMAP', mindmap);   // DB 저장

  if (shouldRender()) renderMindmap(mindmap);
}

function getMindmapTitle() {
  const rawTitle = AI_STATE.docTitle || window._docTitle || "문서";

  return String(rawTitle)
    .replace(/^눈길\s*[-–—:]*\s*/i, "")
    .replace(/\.(pdf|ppt|pptx)$/i, "")
    .replace(/\s*마인드맵\s*$/i, "")
    .trim() || "문서";
}

function renderMindmap(mindmapData) {
  injectMindmapCompactStyle();

  const container = getCanvas();
  setAiMode("mindmap-mode");

  container.innerHTML = `
    <div class="mindmap-app">
      <main class="mindmap-map-area">
        <div class="mindmap-header">
          <div class="ng-quiz-badge mindmap-badge">마인드맵</div>
          <h1 class="mindmap-title">${escapeHtml(getMindmapTitle())}</h1>

          <div class="mindmap-toolbar">
            <button type="button" id="mindmapZoomIn" title="확대">＋</button>
            <button type="button" id="mindmapZoomOut" title="축소">－</button>
            <button type="button" id="mindmapToggleAll" title="전체 펼치기">⤢</button>
          </div>
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

  const nodeWidth = 260;
const depthGap = 330;
const offsetX = 120;
const offsetY = 390;
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

  function update(source) {
    const treeLayout = d3.tree()
  .nodeSize([1, depthGap])
  .separation((a, b) => {
    const ah = getNodeHeight(a.data.name);
    const bh = getNodeHeight(b.data.name);

    return (ah + bh) / 2 + 42;
  });
    treeLayout(root);

    const nodes = root.descendants();
    const links = root.links();

    nodes.forEach((d) => {
  d.y = d.depth * depthGap;
});

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
      .attr("transform", () => `translate(${source.y0 + offsetX},${source.x0 + offsetY}) scale(0.72)`)
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
      .on("mouseover", function (event, d) {
        d3.select(this).raise();
        d3.select(this).select("rect")
          .transition()
          .duration(220)
          .ease(d3.easeCubicOut)
          .attr("x", -nodeWidth / 2 - 7)
          .attr("y", -getNodeHeight(d.data.name) / 2 - 4)
          .attr("width", nodeWidth + 14)
          .attr("height", getNodeHeight(d.data.name) + 8);
      })
      .on("mouseout", function () {
        d3.select(this).select("rect")
          .transition()
          .duration(220)
          .ease(d3.easeCubicOut)
          .attr("x", -nodeWidth / 2)
          .attr("y", (d) => -getNodeHeight(d.data.name) / 2)
          .attr("width", nodeWidth)
          .attr("height", (d) => getNodeHeight(d.data.name));
      });

    nodeEnter.append("rect")
      .attr("class", "mindmap-node-card")
      .attr("x", -nodeWidth / 2)
      .attr("y", (d) => -getNodeHeight(d.data.name) / 2)
      .attr("width", nodeWidth)
      .attr("height", (d) => getNodeHeight(d.data.name));
    nodeEnter.append("foreignObject")
      .attr("x", -nodeWidth / 2)
      .attr("y", (d) => -getNodeHeight(d.data.name) / 2)
      .attr("width", nodeWidth)
      .attr("height", (d) => getNodeHeight(d.data.name))
      .append("xhtml:div")
      .attr("class", "mindmap-node-label")
      .html((d) => `
    <div class="mindmap-node-label-inner">
      ${escapeHtml(d.data.name)}
    </div>
  `);

    nodeEnter.append("text")
      .attr("class", "mindmap-arrow-text")
      .attr("text-anchor", "middle")
      .attr("x", nodeWidth / 2 - 30)
      .attr("dy", 6)
      .attr("dy", 6.5)
      .style("display", (d) => d._children ? "block" : "none")
      .text("›");

    const nodeUpdate = nodeEnter.merge(node);

    nodeUpdate.transition(transition)
    .attr("transform", (d) => `translate(${d.y + offsetX},${d.x + offsetY}) scale(1)`)
      .style("opacity", 1);

    nodeUpdate.select(".mindmap-arrow-text")
      .style("display", (d) => d._children ? "block" : "none")
      .text("›");

    node.exit()
      .transition(transition)
      .attr("transform", () => `translate(${source.y + offsetX},${source.x + offsetY}) scale(0.72)`)
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
  const sx = d.source.x + offsetY;
  const sy = d.source.y + offsetX;
  const tx = d.target.x + offsetY;
  const ty = d.target.y + offsetX;

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
      .attr("width", nodeWidth + 20)
      .attr("y", (d) => -getNodeHeight(d.data.name) / 2 - 6)
      .attr("height", (d) => getNodeHeight(d.data.name) + 12)
      .transition()
      .duration(260)
      .ease(d3.easeCubicOut)
      .attr("x", -nodeWidth / 2)
      .attr("y", (d) => -getNodeHeight(d.data.name) / 2)
      .attr("width", nodeWidth)
      .attr("height", (d) => getNodeHeight(d.data.name));
  }

  function getNodeHeight(text) {
  const value = String(text || "").trim();

  const approxCharsPerLine = 15;
  const lines = Math.max(1, Math.ceil(value.length / approxCharsPerLine));

  return Math.max(58, lines * 20 + 20);
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

  requestAnimationFrame(() => {
    fitToVisibleNodes();
  });
}

  function fitToVisibleNodes() {
    const nodes = root.descendants();
    const area = container.querySelector(".mindmap-map-area");

    const minX = d3.min(
  nodes,
  (d) => d.x + offsetY - getNodeHeight(d.data.name)
);

const maxX = d3.max(
  nodes,
  (d) => d.x + offsetY + getNodeHeight(d.data.name)
);

const minY = d3.min(nodes, (d) => d.y + offsetX - nodeWidth);
const maxY = d3.max(nodes, (d) => d.y + offsetX + nodeWidth);

    const width = maxY - minY;
    const height = maxX - minX;

    const areaWidth = area.clientWidth;
    const areaHeight = area.clientHeight;

    const rawScale = Math.min(
  areaWidth / (width + 260),
  areaHeight / (height + 260),
  1.05
);

const scale = Math.max(rawScale, allExpanded ? 0.45 : 0.75);

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

function injectMindmapCompactStyle() {
  if (document.getElementById("ngMindmapCompactStyle")) return;

  const style = document.createElement("style");
  style.id = "ngMindmapCompactStyle";
  style.textContent = `
    body:has(#pdfContainer.mindmap-mode) {
      --quiz-top: 90px;
      --quiz-right: 32px;
      --quiz-bottom: 14px;
      --quiz-left-gap: 6px;
      --quiz-height: calc(100vh - var(--quiz-top) - var(--quiz-bottom));
    }

    body:has(#pdfContainer.mindmap-mode) .content-container {
      margin-top: var(--quiz-top) !important;
      padding: 0 var(--quiz-right) var(--quiz-bottom) var(--quiz-left-gap) !important;
      align-items: stretch !important;
    }

    body:has(#pdfContainer.mindmap-mode) .center-area {
      width: 100% !important;
      max-width: none !important;
      flex: 1 1 auto !important;
      justify-content: stretch !important;
      align-items: stretch !important;
      display: flex !important;
    }

    body:has(#pdfContainer.mindmap-mode) #pdfContainer {
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

    #pdfContainer.mindmap-mode .mindmap-app {
  width: 100%;
  min-height: var(--quiz-height);
  display: grid;
  grid-template-columns: minmax(0, 1fr) 270px;
  gap: 18px;
  padding: 0;
  overflow: hidden;
  border: 1px solid #e6edf5;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 8px 26px rgba(15, 23, 42, 0.035);
  box-sizing: border-box;
}

#pdfContainer.mindmap-mode .mindmap-map-area {
  position: relative;
  min-width: 0;
  min-height: 0;
  border-radius: 14px;
  overflow: hidden;
  background: #fbfcfe;
}

/* D3 svg가 위에서 배경처럼 덮어 보이는 문제 정리 */
#pdfContainer.mindmap-mode .mindmap-map-area svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  background: transparent !important;
}

/* 상단 배지/제목/버튼은 svg보다 위 */
#pdfContainer.mindmap-mode .mindmap-header {
  position: absolute;
  top: 18px;
  left: 18px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}


#pdfContainer.mindmap-mode .mindmap-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 9px;
  margin-bottom: 8px;
  border-radius: 999px;
  background: #eef4ff;
  color: #5b84d6;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
}

#pdfContainer.mindmap-mode .mindmap-title {
  margin: 0 0 10px;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.35;
  color: #1f2a44;
  letter-spacing: -0.2px;
}

#pdfContainer.mindmap-mode .mindmap-toolbar {
  position: static;
  display: flex;
  align-items: center;
  gap: 6px;
}

    #pdfContainer.mindmap-mode .mindmap-toolbar button {
      width: 30px;
      height: 30px;
      border-radius: 10px;
      font-size: 13px;
    }

    #pdfContainer.mindmap-mode .mindmap-node-label {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

#pdfContainer.mindmap-mode .mindmap-node-label-inner {
  width: 100%;
  height: 100%;
  padding: 0 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;

  font-size: 15px;
  font-weight: 500;
  line-height: 1.45;
  color: #334155;
  word-break: keep-all;
}

    #pdfContainer.mindmap-mode .mindmap-detail-panel {
  width: 270px;
  min-width: 270px;
  padding: 0;
  margin: 0;
  box-sizing: border-box;
}

#pdfContainer.mindmap-mode .mindmap-detail-card {
  width: 100%;
  min-height: 220px;
  margin: 0;
  padding: 18px;
  border-radius: 16px;
  border: 1px solid #e6edf6;
  background: #ffffff;
  box-shadow: 0 8px 22px rgba(47, 75, 116, 0.045);
  box-sizing: border-box;
}

    #pdfContainer.mindmap-mode .mindmap-pill {
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

#pdfContainer.mindmap-mode .mindmap-detail-card h2 {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  color: #1f2a44;
}

#pdfContainer.mindmap-mode .mindmap-detail-card p,
#pdfContainer.mindmap-mode .mindmap-detail-card li {
  font-size: 12.5px;
  line-height: 1.7;
  color: #526174;
}

#pdfContainer.mindmap-mode .mindmap-detail-card ul {
  padding-left: 16px;
  margin-top: 6px;
}

#pdfContainer.mindmap-mode .mindmap-hint {
  margin-top: 12px;
  font-size: 11.5px;
  color: #94a3b8;
}

#pdfContainer.mindmap-mode .ai-source {
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  background: #f8fafc;
  font-size: 11px;
  line-height: 1.5;
  color: #94a3b8;
}

    @media (max-width: 900px) {
      #pdfContainer.mindmap-mode .mindmap-app {
        grid-template-columns: 1fr;
      }

      #pdfContainer.mindmap-mode .mindmap-detail-panel {
        width: 100%;
        min-width: 0;
      }
    }
  `;

  document.head.appendChild(style);
}
