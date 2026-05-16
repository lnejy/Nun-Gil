// ui/ai/공통.js
// AI 기능 공통 유틸: 캐시, PDF chunk, Claude 호출, 공통 렌더 보조

import { SUPABASE_URL, sb } from '/src/lib/supabase.js'
import { createConceptExtractPrompt } from './prompt.js'

const ASK_CLAUDE_URL = `${SUPABASE_URL}/functions/v1/ask-claude`

async function getAuthHeader() {
  const { data: { session } } = await sb.auth.getSession()
  if (!session) throw new Error('로그인이 필요합니다.')
  return `Bearer ${session.access_token}`
}

export const AI_STATE = {
  docId: null,
  docTitle: "문서",
  pdfUrl: null,
  canvasId: "pdfContainer",
  pageCount: 0,
};

export function initAiState() {
  const params = new URLSearchParams(location.search);
  AI_STATE.docId = params.get("doc_id") || "demo";
  AI_STATE.docTitle = window._docTitle || document.title || "문서";
  AI_STATE.pdfUrl = window._pdfUrl || null;
}

export function getCanvas() {
  const el = document.getElementById(AI_STATE.canvasId);
  if (!el) throw new Error("pdfContainer를 찾을 수 없습니다.");
  return el;
}

export function getCacheKey() {
  return `nungil_ai_${AI_STATE.docId || "unknown"}`;
}

export function getAiCache() {
  try {
    return JSON.parse(sessionStorage.getItem(getCacheKey()) || "{}");
  } catch {
    return {};
  }
}

export function setAiCache(next) {
  const prev = getAiCache();
  sessionStorage.setItem(getCacheKey(), JSON.stringify({
    ...prev,
    ...next,
    updated_at: new Date().toISOString(),
  }));
}

export function clearAiMode() {
  const canvas = getCanvas();

  canvas.classList.remove(
    "ai-mode",
    "summary-mode",
    "mindmap-mode",
    "quiz-mode",
    "ai-loading-mode"
  );

  document.body.classList.remove(
    "quiz-inline-mode",
    "quiz-fullscreen-mode",
    "ai-view-mode"
  );

  canvas.className = "paper-canvas";
}

export function setAiMode(extraClass = "") {
  const canvas = getCanvas();
  canvas.classList.add("ai-mode");
  canvas.classList.remove("mindmap-mode");
  if (extraClass) canvas.classList.add(extraClass);
}

export function showAiLoading(label) {
  const canvas = getCanvas();

  canvas.classList.remove(
    "summary-mode",
    "mindmap-mode",
    "quiz-mode"
  );
  canvas.classList.add("ai-mode", "ai-loading-mode");

  document.body.classList.remove(
    "quiz-inline-mode",
    "quiz-fullscreen-mode"
  );

  canvas.innerHTML = `
    <div class="ai-loading">
      <div class="ai-spinner"></div>
      <strong>${escapeHtml(label)}</strong>
      <span>문서 근거를 바탕으로 생성 중입니다...</span>
    </div>
  `;
}

export function showAiError(message) {
  const canvas = getCanvas();
  setAiMode();

  canvas.innerHTML = `
    <div class="pdf-no-content">생성 실패: ${escapeHtml(message)}</div>
  `;
}

export async function getChunks() {
  const cache = getAiCache()
  if (Array.isArray(cache.chunks) && cache.chunks.length > 0) {
    return cache.chunks
  }

  showAiLoading("문서 분석 결과 불러오는 중")

  const chunks = await loadChunksFromLayoutJson()

  setAiCache({ chunks })
  return chunks
}

async function loadChunksFromLayoutJson() {
  const { data: doc, error: docErr } = await sb
    .from('documents')
    .select('layout_json_path, file_name')
    .eq('id', AI_STATE.docId)
    .single()

  if (docErr || !doc?.layout_json_path) {
    throw new Error('문서 분석 JSON이 없습니다.')
  }

  const { data: file, error: dlErr } = await sb.storage
    .from('layout-json')
    .download(doc.layout_json_path)

  if (dlErr || !file) {
    throw new Error('layout JSON 다운로드 실패')
  }

  const layoutText =
    typeof file.text === 'function'
      ? await file.text()
      : await new Response(file).text()

  const layout = JSON.parse(layoutText)

  const chunks = Array.isArray(layout.chunks) && layout.chunks.length > 0
    ? layout.chunks
    : createChunksFromLayout(layout, {
        documentId: AI_STATE.docId,
        title: doc.file_name || AI_STATE.docTitle,
      })

  AI_STATE.pageCount = layout.pages?.length || chunks.length
  return chunks
}

function createChunksFromLayout(
  layout,
  {
    documentId,
    title,
    maxChars = 1200,
    minChars = 300,
    overlapChars = 120,
  }
) {
  const chunks = []
  let current = null
  let index = 1
  let section = title

  const blocks = []

  for (const page of layout.pages || []) {
    for (const block of page.blocks || []) {
      const text = (block.cleanText || block.text || '').trim()
      if (!text) continue

      blocks.push({
        page: page.page,
        text,
        type: block.type || block.category || 'paragraph',
        block_id: block.block_id || null,
      })
    }
  }

  for (const block of blocks) {
    const isHeading =
      block.type === 'heading' ||
      block.type === 'title'

    if (isHeading) {
      if (current && current.text.length >= minChars) {
        chunks.push(finalizeLayoutChunk(current, index++))
        current = null
      }
      section = block.text
      continue
    }

    if (!current) {
      current = makeLayoutChunk(documentId, title, section, block.page)
    }

    const nextText = current.text
      ? `${current.text}\n\n${block.text}`
      : block.text

    if (nextText.length > maxChars && current.text.length >= minChars) {
      chunks.push(finalizeLayoutChunk(current, index++))

      const overlap = getOverlapText(current.text, overlapChars)
      current = makeLayoutChunk(documentId, title, section, block.page)
      current.text = overlap ? `${overlap}\n\n${block.text}` : block.text
      current.page_start = block.page
      current.page_end = block.page
    } else {
      current.text = nextText
      current.page_end = block.page
    }

    current.source_blocks.push(block.block_id)
  }

  if (current && current.text.trim()) {
    chunks.push(finalizeLayoutChunk(current, index++))
  }

  return chunks
}

function makeLayoutChunk(documentId, title, section, page) {
  return {
    chunk_id: '',
    document_id: documentId,
    title,
    section,
    page_start: page,
    page_end: page,
    page,
    text: '',
    source_blocks: [],
  }
}

function finalizeLayoutChunk(chunk, index) {
  return {
    ...chunk,
    chunk_id: `c${String(index).padStart(4, '0')}`,
    source_blocks: [...new Set(chunk.source_blocks.filter(Boolean))],
    text: chunk.text
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  }
}

function getOverlapText(text, overlapChars) {
  if (!text || text.length <= overlapChars) return text || ''
  return text.slice(-overlapChars).trim()
}

export function buildContext(chunks, maxChars = 22000) {
  let context = ""

  for (const chunk of chunks) {
    // page 정보 호환: page_start/page_end 또는 page 하나만 있는 경우
    const ps = chunk.page_start ?? chunk.page
    const pe = chunk.page_end ?? chunk.page
    const pageInfo =
      ps == null ? "page ?" :
      ps === pe  ? `page ${ps}` :
                   `pages ${ps}-${pe}`

    const section = chunk.section || chunk.type || "unknown"
    // section이 없으면 type(table/paragraph/heading)이라도 보내주면
    // Claude가 "이건 표구나" 정도는 인지함

    const block =
      `[${chunk.chunk_id} | ${pageInfo} | section: ${section}]
${chunk.text}

`

    if ((context + block).length > maxChars) break
    context += block
  }

  return context.trim()
}

export async function askClaudeJson(prompt) {
  const res = await fetch(ASK_CLAUDE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": await getAuthHeader(),
    },
    body: JSON.stringify({ prompt: sanitizeForJson(prompt) }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message || "Claude 요청 실패");
  }

  const text = data.content?.[0]?.text || "";
  if (!text) throw new Error("Claude 응답이 비어 있습니다.");

  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  return JSON.parse(cleaned);
}

export async function askClaudeText(prompt) {
  const res = await fetch(ASK_CLAUDE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": await getAuthHeader(),
    },
    body: JSON.stringify({ prompt: sanitizeForJson(prompt), mode: 'text' }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message || "Claude 요청 실패");
  }

  return data.content?.[0]?.text || "응답을 불러오지 못했습니다.";
}

export function sourceText(sourceChunks) {
  return sourceChunks?.length ? `근거: ${sourceChunks.join(", ")}` : "";
}

// DB에서 기존 생성 자산 불러오기 (새로고침 후 재생성 방지)
export async function loadAssetFromDb(type) {
  const docId = AI_STATE.docId || window._currentDocId;
  if (!docId) return null;

  try {
    const { data } = await sb
      .from('learning_assets')
      .select('content')
      .eq('document_id', docId)
      .eq('type', type)
      .eq('status', 'DONE')
      .maybeSingle();

    return data?.content ?? null;
  } catch {
    return null;
  }
}

// 생성된 지식 자산을 learning_assets DB에 저장
export async function saveAssetToDb(type, content) {
  const docId = AI_STATE.docId || window._currentDocId;
  if (!docId || docId === 'demo') return;

  const { error } = await sb
    .from('learning_assets')
    .upsert(
      { document_id: docId, type, status: 'DONE', content },
      { onConflict: 'document_id,type' }
    );

  if (error) {
    console.error('지식 자산 저장 실패:', error.message, { docId, type });
    return;
  }

  if (typeof window.loadKnowledgeAssets === 'function') {
    window.loadKnowledgeAssets(docId);
  }
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function sanitizeForJson(value) {
  return encodeURIComponent(
    String(value ?? "")
      .replace(/\u0000/g, "")
  );
}
// 문서 페이지 수 기반으로 출력 항목 범위 결정
export function decideOutputRange(pageCount = 10, _type = "summary") {
  if (pageCount <= 5) return { min: 3, max: 4 };
  if (pageCount <= 15) return { min: 4, max: 6 };
  if (pageCount <= 30) return { min: 5, max: 7 };
  return { min: 6, max: 8 };
}

// 문서 전체에서 균등하게 k개 chunk 선택
function selectSpreadChunks(chunks, k) {
  if (chunks.length <= k) return chunks;
  const step = chunks.length / k;
  return Array.from({ length: k }, (_, i) => chunks[Math.floor(i * step)]);
}

// 핵심 개념 추출 (캐시 → Claude)
export async function getConcepts({ topK = 8, candidateK = 12 } = {}) {
  const cache = getAiCache();
  if (Array.isArray(cache.concepts) && cache.concepts.length > 0) {
    return cache.concepts.slice(0, topK);
  }

  const chunks = await getChunks();
  const selected = selectSpreadChunks(chunks, Math.min(candidateK, chunks.length));
  const context = buildContext(selected);

  showAiLoading("핵심 개념 추출 중");

  const prompt = createConceptExtractPrompt({
    title: AI_STATE.docTitle,
    context,
    estimatedPageCount: AI_STATE.pageCount || 10,
  });

  const concepts = await askClaudeJson(prompt);
  const list = Array.isArray(concepts) ? concepts : [];
  setAiCache({ concepts: list });

  return list.slice(0, topK);
}

// 중요 chunk 반환 (문서 전체에서 균등 선택)
export async function getImportantChunks({ topK = 6, candidateK = 16 } = {}) {
  const chunks = await getChunks();
  return selectSpreadChunks(chunks, Math.min(topK, candidateK, chunks.length));
}

export function setCanvasMode(mode) {
  const container = getCanvas();

  container.classList.remove(
    "pdf-viewer-mode",
    "ai-mode",
    "summary-mode",
    "mindmap-mode",
    "quiz-mode",
    "ai-loading-mode"
  )

  document.body.classList.remove(
    "quiz-inline-mode",
    "quiz-fullscreen-mode"
  );

  if (mode === "original") {
    return container;
  }

  container.classList.add("ai-mode", `${mode}-mode`);

  if (mode === "quiz") {
    document.body.classList.add("quiz-inline-mode");
  }

  return container;
}
