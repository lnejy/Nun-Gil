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
  setAiCache,
  setAiMode,
  showAiLoading,
  sourceText,
  saveAssetToDb,
} from "./common.js";

import {
  createMindmapPrompt,
  createConceptExtractPrompt,
} from "./prompt.js";

export async function loadMindmap({ shouldRender = () => true } = {}) {
  const cache = getAiCache();

  if (cache.mindmap) {
    if (shouldRender()) renderMindmap(cache.mindmap);
    return;
  }

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
  saveAssetToDb('MINDMAP', mindmap);

  if (shouldRender()) renderMindmap(mindmap);
}

function renderMindmap(mindmapData) {
  const container = getCanvas();
  setAiMode("mindmap-mode");

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

function shorten(text) {
  const value = String(text || "");
  return value.length > 12 ? value.slice(0, 12) + "…" : value;
}
