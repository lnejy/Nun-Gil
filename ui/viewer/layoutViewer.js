let layout = null;
let scale = 1.25;
let debug = false;
let container = null;

export async function renderLayoutViewer(layoutUrl, options = {}) {
  container = document.getElementById(options.containerId || 'pdfContainer');
  if (!container) return;

  const res = await fetch(layoutUrl);
  layout = await res.json();

  render();
}

function render() {
  container.innerHTML = '';
  container.classList.toggle('debug-layout', debug);

  for (const page of layout.pages) {
    const pageEl = document.createElement('div');
    pageEl.className = 'layout-page';
    pageEl.style.width = `${page.width * scale}px`;
    pageEl.style.height = `${page.height * scale}px`;

    const bg = document.createElement('img');
    bg.className = 'layout-page-bg';
    bg.src = resolveBackground(page);
    bg.alt = `page ${page.page}`;
    pageEl.appendChild(bg);

    for (const block of page.overlays || []) {
      pageEl.appendChild(renderOverlay(block));
    }

    container.appendChild(pageEl);
  }
}

function resolveBackground(page) {
  const bg = page.background || '';

  if (bg.startsWith('/public/demo-pages/')) {
    return bg;
  }

  return `/public/demo-pages/page_${page.page}.png`;
}

function renderOverlay(block) {
  const el = document.createElement('div');

  el.className = `gaze-block ${block.type || ''}`;
  el.dataset.blockId = block.block_id || '';
  el.dataset.page = block.page || '';
  el.dataset.text = block.cleanText || block.text || '';
  el.dataset.source = block.source || '';

  el.style.left = `${block.x * scale}px`;
  el.style.top = `${block.y * scale}px`;
  el.style.width = `${block.width * scale}px`;
  el.style.height = `${block.height * scale}px`;

  return el;
}

export function detectGazedBlock(x, y) {
  document.querySelectorAll('.gaze-block.gazed')
    .forEach(el => el.classList.remove('gazed'));

  const el = document.elementFromPoint(x, y);

  if (el?.classList.contains('gaze-block')) {
    el.classList.add('gazed');

    window._lastGazedBlock = {
      blockId: el.dataset.blockId,
      page: el.dataset.page,
      text: el.dataset.text,
      source: el.dataset.source,
    };
  }
}

export function zoomLayoutIn() {
  scale = Math.min(scale + 0.1, 3);
  if (layout) render();
}

export function zoomLayoutOut() {
  scale = Math.max(scale - 0.1, 0.4);
  if (layout) render();
}

export function toggleLayoutDebug() {
  debug = !debug;
  if (layout) render();
}

window.renderLayoutViewer = renderLayoutViewer;
window.detectGazedBlock = detectGazedBlock;
window.zoomLayoutIn = zoomLayoutIn;
window.zoomLayoutOut = zoomLayoutOut;
window.toggleLayoutDebug = toggleLayoutDebug;