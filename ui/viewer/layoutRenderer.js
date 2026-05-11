// ui/viewer/layoutRenderer.js
// analyze_pdf.py 가 생성한 layout JSON을 받아 페이지 이미지 + 텍스트 오버레이로 렌더링합니다.
// pdfRenderer.js와 동일한 공개 인터페이스를 제공합니다.

const state = {
  layout: null,
  scale: 1,
  zoomFactor: 1,
  container: null,
  zoomLabel: null,
};

export async function initLayoutRenderer({
  containerId = "pdfContainer",
  zoomLabelId = "zoomLevel",
} = {}) {
  state.container = document.getElementById(containerId);
  state.zoomLabel = document.getElementById(zoomLabelId);

  if (!state.container) {
    throw new Error(`${containerId}를 찾을 수 없습니다.`);
  }
}

export async function renderLayout(layoutUrl) {
  if (!state.container || !layoutUrl) return;

  state.container.innerHTML = '<div class="pdf-loading">레이아웃 불러오는 중...</div>';

  try {
    const res = await fetch(layoutUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.layout = await res.json();
  } catch (err) {
    state.container.innerHTML =
      `<div class="pdf-no-content">레이아웃 로드 실패: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const containerWidth = state.container.clientWidth - 48;
  const firstPage = state.layout?.pages?.[0];
  if (firstPage) {
    state.scale = Math.min(Math.max(containerWidth / firstPage.width, 0.5), 2);
  } else {
    state.scale = 1;
  }

  state.zoomFactor = 1;
  updateZoomLabel();
  renderPages();
}

export async function zoomIn() {
  if (state.zoomFactor >= 2.5) return;
  state.zoomFactor = Math.round((state.zoomFactor + 0.1) * 10) / 10;
  updateZoomLabel();
  renderPages();
}

export async function zoomOut() {
  if (state.zoomFactor <= 0.5) return;
  state.zoomFactor = Math.round((state.zoomFactor - 0.1) * 10) / 10;
  updateZoomLabel();
  renderPages();
}

export function getLayoutRendererState() {
  return {
    layout: state.layout,
    scale: state.scale,
    zoomFactor: state.zoomFactor,
    effectiveScale: state.scale * state.zoomFactor,
  };
}

// ── 내부 함수 ──────────────────────────────────────────────────────────────────

function renderPages() {
  if (!state.layout || !state.container) return;

  const s = state.scale * state.zoomFactor;
  state.container.innerHTML = "";

  for (const page of state.layout.pages) {
    state.container.appendChild(buildPageEl(page, s));
  }

  window.dispatchEvent(new CustomEvent("pdf-rendered", {
    detail: {
      pageCount: state.layout.page_count,
      scale: s,
      zoomFactor: state.zoomFactor,
      source: "layout",
    },
  }));
}

function buildPageEl(page, s) {
  const wrapper = document.createElement("div");
  wrapper.className = "pdf-page-wrapper";
  wrapper.dataset.page = page.page;
  wrapper.style.cssText = `
    position: relative;
    width: ${page.width * s}px;
    height: ${page.height * s}px;
    overflow: hidden;
    background: white;
    box-shadow: 0 2px 16px rgba(0,0,0,.13);
    border-radius: 3px;
    margin: 0 auto 20px;
  `;

  // 배경 이미지
  if (page.background) {
    const img = document.createElement("img");
    img.className = "pdf-page";
    img.src = page.background;
    img.alt = `page ${page.page}`;
    img.style.cssText = `
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: fill;
      user-select: none;
      pointer-events: none;
    `;
    wrapper.appendChild(img);
  }

  // 텍스트 오버레이 (hover 시 텍스트 선택 가능)
  for (const block of (page.overlays ?? [])) {
    wrapper.appendChild(buildOverlay(block, s));
  }

  // 페이지 번호 레이블
  const label = document.createElement("div");
  label.className = "pdf-page-num";
  label.style.cssText = `
    position: absolute;
    right: 8px;
    bottom: 6px;
    font-size: 11px;
    color: rgba(17,24,39,.4);
    background: rgba(255,255,255,.65);
    padding: 2px 5px;
    border-radius: 4px;
    user-select: none;
    pointer-events: none;
  `;
  label.textContent = `${page.page} / ${state.layout.page_count}`;
  wrapper.appendChild(label);

  return wrapper;
}

function buildOverlay(block, s) {
  const el = document.createElement("div");
  el.dataset.blockId = block.block_id ?? "";
  el.dataset.text = block.cleanText ?? block.text ?? "";

  el.style.cssText = `
    position: absolute;
    left: ${block.x * s}px;
    top: ${block.y * s}px;
    width: ${block.width * s}px;
    height: ${block.height * s}px;
    box-sizing: border-box;
    cursor: text;
    color: transparent;
    font-size: ${(block.spans?.[0]?.fontSize ?? 12) * s}px;
    line-height: 1;
    overflow: hidden;
    white-space: pre;
    user-select: text;
  `;

  // 호버 시 반투명 하이라이트
  el.addEventListener("mouseenter", () => {
    el.style.background = "rgba(59,130,246,.15)";
    el.style.outline = "1px solid rgba(37,99,235,.5)";
  });
  el.addEventListener("mouseleave", () => {
    el.style.background = "";
    el.style.outline = "";
  });

  // 시선 추적 이벤트 전파를 위한 block_id 노출
  el.setAttribute("data-block-id", block.block_id ?? "");
  el.setAttribute("data-page", block.page ?? "");
  el.textContent = block.cleanText ?? block.text ?? "";

  return el;
}

function updateZoomLabel() {
  if (state.zoomLabel) {
    state.zoomLabel.textContent = `${Math.round(state.zoomFactor * 100)}%`;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
