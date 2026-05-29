// viewer/pdfRenderer.js

const PDF_WORKER_SRC =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"

const state = {
  pdfDoc: null,
  baseScale: 1,
  zoomFactor: 1,
  container: null,
  zoomLabel: null,
}

export async function initPdfRenderer({
  containerId = "pdfContainer",
  zoomLabelId = "zoomLevel",
} = {}) {
  state.container = document.getElementById(containerId)
  state.zoomLabel = document.getElementById(zoomLabelId)

  if (!state.container) {
    throw new Error(`${containerId}를 찾을 수 없습니다.`)
  }

  if (!window.pdfjsLib) {
    showPdfError("pdf.js 로딩 실패")
    throw new Error("pdf.js가 로드되지 않았습니다.")
  }

  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC

  window.renderPdf = renderPdf
  window.reRenderPdf = reRenderPdf
  window.zoomIn = zoomIn
  window.zoomOut = zoomOut
  window.getPdfRendererState = getPdfRendererState
}

export async function renderPdf(url) {
  if (!state.container || !url) return

  showPdfLoading("문서 로딩 중...")

  try {
    const pdf = await window.pdfjsLib.getDocument(url).promise
    state.pdfDoc = pdf

    window._pdfDoc = pdf

    const firstPage = await pdf.getPage(1)
    const viewport = firstPage.getViewport({ scale: 1 })

    const TARGET_PAGE_WIDTH = 850

    state.baseScale = TARGET_PAGE_WIDTH / viewport.width
    state.zoomFactor = 1
    updateZoomLabel()

    await renderPages()
  } catch (err) {
    showPdfError(`PDF 로드 실패: ${escapeHtml(err.message)}`)
  }
}

export async function renderPages() {
  if (!state.pdfDoc || !state.container) return

  const pdf = state.pdfDoc
  const scale = state.baseScale * state.zoomFactor

  resetContainerToPdfMode()
  state.container.innerHTML = ""

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    await renderPage(pdf, pageNum, scale)
  }

  window.dispatchEvent(new CustomEvent("pdf-rendered", {
    detail: {
      pageCount: pdf.numPages,
      scale,
      zoomFactor: state.zoomFactor,
    },
  }))
}

async function renderPage(pdf, pageNum, scale) {
  const page = await pdf.getPage(pageNum)
  const viewport = page.getViewport({ scale })

  const wrapper = document.createElement("div")
  wrapper.className = "pdf-page-wrapper"
  wrapper.dataset.page = String(pageNum)
  wrapper.style.width = `${viewport.width}px`
  wrapper.style.height = `${viewport.height}px`

  const canvas = document.createElement("canvas")
  canvas.className = "pdf-page"

  const dpr = window.devicePixelRatio || 1

  canvas.width = Math.floor(viewport.width * dpr)
  canvas.height = Math.floor(viewport.height * dpr)

  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`

  const ctx = canvas.getContext("2d")

  await page.render({
    canvasContext: ctx,
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
  }).promise

  const label = document.createElement("div")
  label.className = "pdf-page-num"
  label.textContent = `${pageNum} / ${pdf.numPages}`

  wrapper.appendChild(canvas)
  wrapper.appendChild(label)
  state.container.appendChild(wrapper)

}

export async function reRenderPdf() {
  await renderPages()
}

export async function zoomIn() {
  if (window._layoutJsonUrl && typeof window.zoomLayoutIn === "function") {
    window.zoomLayoutIn()
    return
  }

  if (state.zoomFactor >= 2.5) return

  state.zoomFactor = Math.round((state.zoomFactor + 0.1) * 10) / 10
  updateZoomLabel()
  await renderPages()
}

export async function zoomOut() {
  if (window._layoutJsonUrl && typeof window.zoomLayoutOut === "function") {
    window.zoomLayoutOut()
    return
  }

  if (state.zoomFactor <= 0.5) return

  state.zoomFactor = Math.round((state.zoomFactor - 0.1) * 10) / 10
  updateZoomLabel()
  await renderPages()
}

export function getPdfRendererState() {
  return {
    pdfDoc: state.pdfDoc,
    baseScale: state.baseScale,
    zoomFactor: state.zoomFactor,
    scale: state.baseScale * state.zoomFactor,
  }
}

function resetContainerToPdfMode() {
  if (!state.container) return

  state.container.classList.remove(
    "ai-mode",
    "summary-mode",
    "mindmap-mode",
    "quiz-mode",
    "ai-loading-mode"
  )

  document.body.classList.remove(
    "quiz-inline-mode",
    "quiz-fullscreen-mode",
    "ai-view-mode"
  )

  state.container.classList.add("paper-canvas", "pdf-viewer-mode")
}

function resetContainerToLoadingMode() {
  if (!state.container) return

  state.container.classList.remove(
    "ai-mode",
    "summary-mode",
    "mindmap-mode",
    "quiz-mode",
    "ai-loading-mode",
    "pdf-viewer-mode"
  )

  document.body.classList.remove(
    "quiz-inline-mode",
    "quiz-fullscreen-mode",
    "ai-view-mode"
  )

  state.container.classList.add("paper-canvas")
}

function showPdfLoading(message = "문서 로딩 중...") {
  resetContainerToLoadingMode()

  state.container.innerHTML = `
    <div class="pdf-loading">
      ${message}
    </div>
  `
}

function showPdfError(message) {
  resetContainerToLoadingMode()

  state.container.innerHTML = `
    <div class="pdf-no-content">
      ${message}
    </div>
  `
}

function updateZoomLabel() {
  if (state.zoomLabel) {
    state.zoomLabel.textContent = `${Math.round(state.zoomFactor * 100)}%`
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}