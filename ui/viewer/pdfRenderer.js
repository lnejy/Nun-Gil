// ui/viewer/pdfRenderer.js
// viewer-demo.html 전용 PDF 렌더링 모듈.
// 기존 viewer.html에 바로 붙이지 말고, 데모 브랜치에서 먼저 검증하세요.

const PDF_WORKER_SRC =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const state = {
  pdfDoc: null,
  baseScale: 1,
  zoomFactor: 1,
  container: null,
  zoomLabel: null,
};

export async function initPdfRenderer({
  containerId = "pdfContainer",
  zoomLabelId = "zoomLevel",
} = {}) {
  state.container = document.getElementById(containerId);
  state.zoomLabel = document.getElementById(zoomLabelId);

  if (!state.container) {
    throw new Error(`${containerId}를 찾을 수 없습니다.`);
  }

  if (!window.pdfjsLib) {
    state.container.innerHTML =
      '<div class="pdf-no-content">pdf.js 로딩 실패</div>';
    throw new Error("pdf.js가 로드되지 않았습니다.");
  }

  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
}

export async function renderPdf(url) {
  if (!state.container || !url) return;

  state.container.innerHTML =
    '<div class="pdf-loading">PDF 불러오는 중...</div>';

  try {
    const pdf = await window.pdfjsLib.getDocument(url).promise;
    state.pdfDoc = pdf;

    const firstPage = await pdf.getPage(1);
    const viewport = firstPage.getViewport({ scale: 1 });

    const containerWidth = state.container.clientWidth - 48;
    state.baseScale = Math.min(
      Math.max(containerWidth / viewport.width, 0.5),
      2
    );

    state.zoomFactor = 1;
    updateZoomLabel();

    await renderPages();
  } catch (err) {
    state.container.innerHTML =
      `<div class="pdf-no-content">PDF 로드 실패: ${escapeHtml(err.message)}</div>`;
  }
}

export async function renderPages() {
  if (!state.pdfDoc || !state.container) return;

  const pdf = state.pdfDoc;
  const scale = state.baseScale * state.zoomFactor;

  state.container.innerHTML = "";

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    await renderPage(pdf, pageNum, scale);
  }

  window.dispatchEvent(new CustomEvent("pdf-rendered", {
    detail: {
      pageCount: pdf.numPages,
      scale,
      zoomFactor: state.zoomFactor,
    },
  }));
}

async function renderPage(pdf, pageNum, scale) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const wrapper = document.createElement("div");
  wrapper.className = "pdf-page-wrapper";
  wrapper.dataset.page = pageNum;
  wrapper.style.width = `${viewport.width}px`;

  const canvas = document.createElement("canvas");
  canvas.className = "pdf-page";
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const label = document.createElement("div");
  label.className = "pdf-page-num";
  label.textContent = `${pageNum} / ${pdf.numPages}`;

  wrapper.appendChild(canvas);
  wrapper.appendChild(label);
  state.container.appendChild(wrapper);

  await page.render({
    canvasContext: canvas.getContext("2d"),
    viewport,
  }).promise;
}

export async function zoomIn() {
  if (state.zoomFactor >= 2.5) return;

  state.zoomFactor = Math.round((state.zoomFactor + 0.1) * 10) / 10;
  updateZoomLabel();
  await renderPages();
}

export async function zoomOut() {
  if (state.zoomFactor <= 0.5) return;

  state.zoomFactor = Math.round((state.zoomFactor - 0.1) * 10) / 10;
  updateZoomLabel();
  await renderPages();
}

export async function reRenderPdf() {
  await renderPages();
}

export function getPdfRendererState() {
  return {
    pdfDoc: state.pdfDoc,
    baseScale: state.baseScale,
    zoomFactor: state.zoomFactor,
    scale: state.baseScale * state.zoomFactor,
  };
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
