let layout = null
const TARGET_PAGE_WIDTH = 850
let scale = 1
let debug = false
let container = null
let pdfDoc = null
let pdfUrl = null

export async function renderLayoutViewer(layoutUrl, options = {}) {
  container = document.getElementById(options.containerId || 'pdfContainer')
  if (!container) return

  container.classList.add('pdf-viewer-mode')
  pdfUrl = options.pdfUrl || null

  const res = await fetch(layoutUrl)
  layout = normalizeLayout(await res.json())

  const firstPage = layout.pages?.[0]
  if (firstPage?.width) {
    scale = TARGET_PAGE_WIDTH / firstPage.width
  }

  if (pdfUrl && window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

    pdfDoc = await pdfjsLib.getDocument(pdfUrl).promise
  } else {
    pdfDoc = null
  }

  await render()
}

function normalizeLayout(data) {
  if (data?.pages?.length) return data

  // 혹시 Upstage 원본 JSON이 바로 들어온 경우 대비
  if (data?.elements?.length) {
    return upstageToLayout(data)
  }

  throw new Error('지원하지 않는 layout 형식입니다.')
}

function upstageToLayout(upstageJson) {
  const pageMap = new Map()

  for (const el of upstageJson.elements || []) {
    const pageNum = Number(el.page || el.page_num || 1)

    if (!pageMap.has(pageNum)) {
      pageMap.set(pageNum, {
        page: pageNum,
        width: el.page_width || el.width || 1280,
        height: el.page_height || el.height || 720,
        background: null,
        overlaySource: 'upstage',
        blocks: [],
        overlays: [],
      })
    }

    const page = pageMap.get(pageNum)
    const block = upstageElementToBlock(el, page)

    page.blocks.push(block)
    page.overlays.push(block)
  }

  return {
    parser: 'upstage-document-parse',
    page_count: pageMap.size,
    pages: [...pageMap.values()].sort((a, b) => a.page - b.page),
    chunks: createChunks([...pageMap.values()]),
  }
}

function upstageElementToBlock(el, page) {
  const category = el.category || el.type || 'paragraph'
  const type = mapCategoryToType(category)

  const content = el.content || {}
  const text =
    content.text ||
    content.markdown ||
    stripHtml(content.html || '') ||
    el.text ||
    ''

  const bbox = getBBox(el, page)

  return {
    block_id: `p${page.page}-up-${el.id ?? crypto.randomUUID()}`,
    type,
    category,
    page: page.page,

    x: bbox[0],
    y: bbox[1],
    width: bbox[2] - bbox[0],
    height: bbox[3] - bbox[1],
    bbox,

    text,
    cleanText: cleanText(text),
    html: content.html || '',
    markdown: content.markdown || '',
    source: 'upstage',
  }
}

function mapCategoryToType(category) {
  const c = String(category || '').toLowerCase()

  if (c.includes('heading') || c === 'title' || c === 'section_header') {
    return 'heading'
  }

  if (c.includes('list')) return 'list'
  if (c.includes('table')) return 'table'
  if (c.includes('figure') || c.includes('image')) return 'figure'
  if (c.includes('caption')) return 'caption'
  if (c.includes('equation') || c.includes('formula')) return 'equation'
  if (c.includes('code')) return 'code'
  if (c.includes('footer')) return 'footer'
  if (c.includes('header')) return 'header'

  return 'paragraph'
}

function getBBox(el, page) {
  const coords =
    el.coordinates ||
    el.bounding_box ||
    el.boundingPoly ||
    el.bbox

  if (!coords) {
    return [40, 40, page.width - 40, 80]
  }

  // bbox: [x0, y0, x1, y1]
  if (
    Array.isArray(coords) &&
    coords.length === 4 &&
    coords.every(v => typeof v === 'number')
  ) {
    return normalizeBBox(coords, page)
  }

  // polygon: [{x,y}, ...] or [[x,y], ...]
  if (Array.isArray(coords)) {
    const points = coords.map(p => {
      if (Array.isArray(p)) return { x: Number(p[0]), y: Number(p[1]) }
      return { x: Number(p.x), y: Number(p.y) }
    })

    const xs = points.map(p => p.x)
    const ys = points.map(p => p.y)

    return normalizeBBox(
      [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      page,
    )
  }

  return [40, 40, page.width - 40, 80]
}

function normalizeBBox(bbox, page) {
  let [x0, y0, x1, y1] = bbox.map(Number)

  const isNormalized = Math.max(x0, y0, x1, y1) <= 1.5

  if (isNormalized) {
    x0 *= page.width
    x1 *= page.width
    y0 *= page.height
    y1 *= page.height
  }

  return [
    clamp(x0, 0, page.width),
    clamp(y0, 0, page.height),
    clamp(x1, 0, page.width),
    clamp(y1, 0, page.height),
  ]
}

function createChunks(pages) {
  const chunks = []
  let idx = 1

  for (const page of pages) {
    let currentHeading = null
    let group = []

    const flush = () => {
      if (!group.length) return

      const text = group
        .map(b => b.cleanText || b.text || '')
        .filter(Boolean)
        .join('\n')
        .trim()

      if (text) {
        chunks.push({
          chunk_id: `c${String(idx).padStart(4, '0')}`,
          block_ids: group.map(b => b.block_id),
          type: 'section',
          page: page.page,
          text,
          section: currentHeading,
          source: 'upstage',
          useForSearch: true,
        })
        idx++
      }

      group = []
    }

    for (const block of page.blocks) {
      if (block.type === 'heading') {
        flush()
        currentHeading = block.cleanText || block.text
        group = [block]
        continue
      }

      if (block.type === 'table') {
        flush()

        chunks.push({
          chunk_id: `c${String(idx).padStart(4, '0')}`,
          block_ids: [block.block_id],
          type: 'table',
          page: page.page,
          text: block.markdown || block.cleanText || block.text || '',
          html: block.html || '',
          markdown: block.markdown || '',
          section: currentHeading,
          source: 'upstage',
          useForSearch: true,
        })
        idx++
        continue
      }

      if (block.type === 'footer' || block.type === 'header') continue

      group.push(block)
    }

    flush()
  }

  return chunks
}

async function render() {
  container.innerHTML = ''
  container.classList.toggle('debug-layout', debug)

  for (const page of layout.pages) {
    let sx = 1
    let sy = 1

    if (pdfDoc) {
      const originalWidth = page.width
      const originalHeight = page.height

      const pdfPage = await pdfDoc.getPage(page.page)
      const viewport = pdfPage.getViewport({ scale: 1 })

      page.width = viewport.width
      page.height = viewport.height

      sx = page.width / originalWidth
      sy = page.height / originalHeight
    }

    const pageEl = document.createElement('div')
    pageEl.className = 'layout-page'
    pageEl.dataset.page = page.page
    pageEl.style.width = `${page.width * scale}px`
    pageEl.style.height = `${page.height * scale}px`

    if (pdfDoc) {
      await renderPdfPageBackground(pageEl, page.page)
    } else {
      const bg = document.createElement('img')
      bg.className = 'layout-page-bg'
      bg.src = resolveBackground(page)
      bg.alt = `page ${page.page}`
      pageEl.appendChild(bg)
    }

    for (const block of page.overlays || []) {
      pageEl.appendChild(renderOverlay(block, sx, sy))
    }
    container.appendChild(pageEl)
  }

  window._currentLayout = layout
}
async function renderPdfPageBackground(pageEl, pageNum) {
  const pdfPage = await pdfDoc.getPage(pageNum)
  const viewport = pdfPage.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.className = 'layout-page-bg'
  canvas.style.pointerEvents = 'none'

  const dpr = window.devicePixelRatio || 1

  canvas.width = Math.floor(viewport.width * dpr)
  canvas.height = Math.floor(viewport.height * dpr)
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`

  pageEl.insertBefore(canvas, pageEl.firstChild)

  await pdfPage.render({
    canvasContext: canvas.getContext('2d'),
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
  }).promise
}
function resolveBackground(page) {
  const bg = page.background || ''

  if (
    bg.startsWith('/public/demo-pages/') ||
    bg.startsWith('/public/cache/') ||
    bg.startsWith('http') ||
    bg.startsWith('data:')
  ) {
    return bg
  }

  return `/public/demo-pages/page_${page.page}.png`
}

function renderOverlay(block, sx = 1, sy = 1) {
  const el = document.createElement('div')

  el.className = `gaze-block ${block.type || ''}`
  el.dataset.blockId = block.block_id || ''
  el.dataset.page = block.page || ''
  el.dataset.text = block.cleanText || block.text || ''
  el.dataset.source = block.source || ''
  el.dataset.category = block.category || ''
  el.dataset.html = block.html || ''
  el.dataset.markdown = block.markdown || ''

  el.style.left = `${block.x * sx * scale}px`
  el.style.top = `${block.y * sy * scale}px`
  el.style.width = `${block.width * sx * scale}px`
  el.style.height = `${block.height * sy * scale}px`

  el.addEventListener('pointerenter', () => {
    document
      .querySelectorAll('.gaze-block.hovered, .gaze-block.gazed')
      .forEach(node => node.classList.remove('hovered', 'gazed'))

    el.classList.add('hovered')

    window._lastGazedBlock = {
      blockId: el.dataset.blockId,
      page: el.dataset.page,
      text: el.dataset.text,
      source: el.dataset.source,
      category: el.dataset.category,
      html: el.dataset.html,
      markdown: el.dataset.markdown,
    }
  })

  el.addEventListener('pointerleave', () => {
    el.classList.remove('hovered')
  })

  return el
}

export function detectGazedBlock(x, y) {
  document
    .querySelectorAll('.gaze-block.gazed')
    .forEach(el => el.classList.remove('gazed'))

  const el = document.elementFromPoint(x, y)

  if (el?.classList.contains('gaze-block')) {
    el.classList.add('gazed')

    window._lastGazedBlock = {
      blockId: el.dataset.blockId,
      page: el.dataset.page,
      text: el.dataset.text,
      source: el.dataset.source,
      category: el.dataset.category,
      html: el.dataset.html,
      markdown: el.dataset.markdown,
    }
  }
}

export function zoomLayoutIn() {
  scale = Math.min(scale + 0.1, 3)
  if (layout) render()
}

export function zoomLayoutOut() {
  scale = Math.max(scale - 0.1, 0.4)
  if (layout) render()
}
export function toggleLayoutDebug() {
  debug = !debug
  if (layout) render()
}

function cleanText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/(?<=[가-힣])\s+(?=[가-힣])/g, '')
    .trim()
}

function stripHtml(html) {
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent || div.innerText || ''
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

window.renderLayoutViewer = renderLayoutViewer
window.detectGazedBlock = detectGazedBlock
window.zoomLayoutIn = zoomLayoutIn
window.zoomLayoutOut = zoomLayoutOut
window.toggleLayoutDebug = toggleLayoutDebug