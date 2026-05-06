// ui/ai/공통.js
// AI 기능 공통 유틸: 캐시, PDF chunk, Claude 호출, 공통 렌더 보조

import { SUPABASE_URL, sb } from '/src/lib/supabase.js'
import {createConceptExtractPrompt} from './prompt.js'


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
  pageCount: 0,  // 추가
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
  canvas.classList.remove("ai-mode", "mindmap-mode");
}

export function setAiMode(extraClass = "") {
  const canvas = getCanvas();
  canvas.classList.add("ai-mode");
  canvas.classList.remove("mindmap-mode");
  if (extraClass) canvas.classList.add(extraClass);
}

export function showAiLoading(label) {
  const canvas = getCanvas();
  setAiMode();

  canvas.innerHTML = `
    <div class="ai-loading">
      <div class="ai-spinner"></div>
      <strong>${escapeHtml(label)}</strong>
      <span>문서 근거를 바탕으로 AI가 생성 중입니다...</span>
    </div>
  `;
}

export function showAiError(message) {
  const canvas = getCanvas();
  setAiMode();

  canvas.innerHTML = `
    <div class="pdf-no-content">AI 생성 실패: ${escapeHtml(message)}</div>
  `;
}

export async function getChunks() {
  const cache = getAiCache();
  if (Array.isArray(cache.chunks) && cache.chunks.length > 0) {
    if (cache.pageCount) AI_STATE.pageCount = cache.pageCount;  // 캐시에서 복원
    return cache.chunks;
  }

  if (!AI_STATE.pdfUrl) {
    throw new Error("PDF URL이 없습니다.");
  }

  showAiLoading("문서 텍스트 추출 중");
  const chunks = await extractPdfChunksFromUrl(AI_STATE.pdfUrl);
  setAiCache({ chunks, pageCount: AI_STATE.pageCount });  // 캐시에도 저장

  return chunks;
}

function rankChunksByHeuristic(chunks) {
  return chunks
    .map((chunk) => ({
      ...chunk,
      _score: scoreChunk(chunk),
    }))
    .sort((a, b) => b._score - a._score);
}

function scoreChunk(chunk) {
  const text = String(chunk.text || "");
  const section = String(chunk.section || "");
  let score = 0;

  const len = text.length;

  // 1. 적당한 길이
  if (len >= 300 && len <= 2200) score += 5;
  if (len < 120) score -= 8;
  if (len > 3500) score -= 4;

  // 2. 제목/섹션 신호
  if (/^\s*(\d+(\.\d+)*|[IVX]+|제\s*\d+\s*[장절부]|Chapter|Section|Unit)/i.test(text)) score += 5;
  if (/^\s*(\d+(\.\d+)*|[IVX]+|제\s*\d+\s*[장절부]|Chapter|Section|Unit)/i.test(section)) score += 5;

  // 3. 학습 중요 신호: 어떤 과목에도 일반적으로 통함
  const learningSignals = [
    "정의", "개념", "의미", "특징", "역할", "목적", "원리", "구조",
    "과정", "절차", "방법", "흐름", "단계", "조건", "기준",
    "원인", "결과", "영향", "문제", "해결", "한계", "주의",
    "장점", "단점", "비교", "차이", "분류", "유형",
    "사례", "예시", "적용", "활용", "핵심", "요약", "정리",
    "definition", "concept", "meaning", "feature", "role", "purpose",
    "principle", "structure", "process", "procedure", "method",
    "cause", "effect", "impact", "problem", "solution", "limitation",
    "advantage", "disadvantage", "compare", "difference", "type",
    "example", "application", "summary"
  ];

  for (const word of learningSignals) {
    if (text.toLowerCase().includes(word.toLowerCase())) score += 2;
  }

  // 4. 설명 문장 신호
  const explanationSignals = [
    "즉", "따라서", "예를 들어", "예컨대", "반면", "하지만", "그러나",
    "왜냐하면", "이유는", "결국", "정리하면", "다시 말해",
    "for example", "therefore", "however", "because", "in other words"
  ];

  for (const word of explanationSignals) {
    if (text.toLowerCase().includes(word.toLowerCase())) score += 3;
  }

  // 5. 관계/흐름 신호
  if (/→|->|⇒|=>/.test(text)) score += 4;
  if (/(첫째|둘째|셋째|1\.|2\.|3\.|①|②|③)/.test(text)) score += 4;

  // 6. 정보 밀도
  const sentenceCount = text.split(/[.!?。]|다\.|요\./).filter(Boolean).length;
  if (sentenceCount >= 3) score += 3;
  if (sentenceCount >= 6) score += 2;

  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length >= 40) score += 2;
  if (tokens.length >= 80) score += 2;

  score += scoreExampleChunk(text);
  
  // 7. 너무 표지/메타성인 내용 감점
  const lowValueSignals = [
    "담당", "교수", "학번", "이름", "제출", "출석", "강의계획",
    "목차", "참고문헌", "참고자료", "bibliography", "references",
    "copyright", "all rights reserved", "http://", "https://", "www."
  ];

  for (const word of lowValueSignals) {
    if (text.toLowerCase().includes(word.toLowerCase())) score -= 8;
  }

  // 8. 텍스트가 깨졌거나 숫자/기호 위주면 감점
  const compact = text.replace(/\s/g, "");
  if (compact.length > 0) {
    const numberRatio = (compact.match(/[0-9]/g) || []).length / compact.length;
    const symbolRatio = (compact.match(/[^\p{L}\p{N}]/gu) || []).length / compact.length;

    if (numberRatio > 0.35) score -= 4;
    if (symbolRatio > 0.45) score -= 5;
  }

  return score;
}

function scoreExampleChunk(text) {
  let score = 0;

  const titlePatternCount =
    (text.match(/<[^>]{2,60}>/g) || []).length +
    (text.match(/「[^」]{2,60}」/g) || []).length +
    (text.match(/『[^』]{2,60}』/g) || []).length;

  const yearParenCount =
    (text.match(/\([^)]*(19|20)\d{2}[^)]*\)/g) || []).length;

  const interpretationSignals = [
    "통해", "보여준다", "드러낸다", "나타낸다",
    "상징한다", "의미한다", "재현한다", "설명한다",
    "사례", "예시", "대표적", "전형적",
  ];

  const interpretationCount = interpretationSignals
    .filter((word) => text.includes(word)).length;

  if (titlePatternCount >= 1) score += 8;
  if (yearParenCount >= 1) score += 6;
  if (titlePatternCount >= 1 && yearParenCount >= 1) score += 8;
  if (interpretationCount >= 1) score += 4;
  if (interpretationCount >= 2) score += 4;

  // “사례명 + 해석어”가 같이 있으면 진짜 사례 중심 chunk일 확률 높음
  if (
    (titlePatternCount > 0 || yearParenCount > 0) &&
    interpretationCount > 0
  ) {
    score += 10;
  }

  return score;
}

async function askClaudeChunkIds(prompt) {
  const result = await askClaudeJson(prompt);

  if (Array.isArray(result)) return result;
  if (Array.isArray(result.selected_chunk_ids)) return result.selected_chunk_ids;
  if (Array.isArray(result.chunk_ids)) return result.chunk_ids;

  return [];
}

// ===== 청크 선택 프롬프트 (purpose 제거, 일반화) =====
function createChunkSelectionPrompt({ title, chunks, topK }) {
  const compact = chunks.map((c) => {
    const shortText = c.text.length > 350
      ? c.text.slice(0, 350) + "..."
      : c.text;
    return `[${c.chunk_id} | page ${c.page_start} | score ${c._score ?? 0}]
${shortText}`;
  }).join("\n\n");

  return `
너는 학습 문서 분석가다.
아래 후보 chunk 중에서 학습에 가장 중요한 chunk ${topK}개를 고른다.

선택 기준:
- 표지, 담당자, 참고문헌, 단순 목차는 제외한다.
- 핵심 개념, 정의, 특징, 비교, 사례, 절차, 의미 설명이 있는 chunk를 우선한다.
- 문서 전체 주제를 대표하는 chunk를 우선한다.
- 출력은 JSON 객체만 반환한다.

[문서 제목]
${title}

[후보 chunk]
${compact}

출력 형식:
{
  "selected_chunk_ids": ["c0002", "c0005"],
  "reason": "선택 이유 한 문장"
}
`;
}

// ===== 중요 청크 추출 (도구 무관, 문서당 1회) =====
export async function getImportantChunks({
  topK = 6,
  candidateK = 10,
} = {}) {
  const cache = getAiCache();

  if (Array.isArray(cache.important_chunks) && cache.important_chunks.length > 0) {
    return cache.important_chunks;
  }

  const chunks = dedupeChunks(await getChunks());

  const candidates = rankChunksByHeuristic(chunks)
    .slice(0, Math.min(candidateK, chunks.length));

  if (candidates.length <= topK) {
    setAiCache({ important_chunks: candidates });
    return candidates;
  }

  const selectedIds = await askClaudeChunkIds(createChunkSelectionPrompt({
    title: AI_STATE.docTitle,
    chunks: candidates,
    topK,
  }));

  const selected = selectedIds
    .map((id) => candidates.find((c) => c.chunk_id === id))
    .filter(Boolean);

  const finalChunks = selected.length
    ? selected
    : candidates.slice(0, topK);

  setAiCache({
    important_chunks: finalChunks,
    important_chunk_ids: finalChunks.map((c) => c.chunk_id),
  });

  return finalChunks;
}

// ===== 핵심 개념 추출 (도구 무관, 문서당 1회) =====
export async function getConcepts({
  topK = 8,
  candidateK = 12,
} = {}) {
  const cache = getAiCache();

  if (Array.isArray(cache.concepts) && cache.concepts.length > 0) {
    return cache.concepts;
  }


  const chunks = await getImportantChunks({ topK, candidateK });

  const prompt = createConceptExtractPrompt({
    title: AI_STATE.docTitle,
    context: buildContext(chunks, 14000),  // 9500 → 14000 (선별 청크 안 잘리게)
    estimatedPageCount: AI_STATE.pageCount || 10,
  });

  const concepts = await askClaudeJson(prompt, "array");

  setAiCache({
    concepts,
    concept_source_chunk_ids: chunks.map(c => c.chunk_id),
  });

  return concepts;
}

async function extractPdfChunksFromUrl(url) {
  if (!window.pdfjsLib) {
    throw new Error("pdf.js가 로드되지 않았습니다.");
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const pdf = await pdfjsLib.getDocument(url).promise;
  AI_STATE.pageCount = pdf.numPages;  // ← 추가

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
      text,
    });
  }

  return createSemanticChunks({
    documentId: AI_STATE.docId || "doc",
    title: AI_STATE.docTitle,
    pages,
  });
}

// 페이지 수 기반 출력 범위 결정
export function decideOutputRange(pageCount, kind = "summary") {
  const tiers = {
    summary: [
      { max: 5,   min: 3, max2: 5 },
      { max: 20,  min: 4, max2: 7 },
      { max: 50,  min: 6, max2: 10 },
      { max: Infinity, min: 8, max2: 14 },
    ],
    mindmap: [
      { max: 5,   min: 3, max2: 4 },
      { max: 20,  min: 4, max2: 6 },
      { max: 50,  min: 5, max2: 8 },
      { max: Infinity, min: 6, max2: 10 },
    ],
    quiz: [
      { max: 5,   min: 3, max2: 5 },
      { max: 20,  min: 5, max2: 8 },
      { max: 50,  min: 8, max2: 12 },
      { max: Infinity, min: 10, max2: 15 },
    ],
  };

  const table = tiers[kind] || tiers.summary;
  const tier = table.find((t) => pageCount <= t.max);
  return { min: tier.min, max: tier.max2 };
}

function createSemanticChunks({
  documentId = "doc",
  title = "문서",
  pages,
  maxChars = 2200,
  minChars = 350,
  overlapChars = 400,
}) {
  const blocks = [];

  for (const page of pages) {
    const pageBlocks = splitPageIntoBlocks(page.text);
    for (const block of pageBlocks) {
      blocks.push({
        page: page.page,
        text: block.text,
        type: block.type,
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
    text: "",
  };
}

function extractKeywords(text) {
  return [...new Set(
    String(text)
      .match(/[가-힣A-Za-z0-9]{2,}/g) || []
  )].slice(0, 20);
}

function finalizeChunk(chunk, index) {
  return {
    ...chunk,
    chunk_id: `c${String(index).padStart(4, "0")}`,
    text: chunk.text
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    keywords: extractKeywords(chunk.text),
  };
}
function dedupeChunks(chunks) {
  const seen = new Set();

  return chunks.filter(c => {
    const key = c.text.slice(0, 120);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
    type: isHeading(block) ? "heading" : "paragraph",
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

export function buildContext(chunks, maxChars = 9000) {
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

function extractJson(text) {
  
  const cleaned = text
  .replace(/^```json\s*/i, "")
  .replace(/^```\s*/i, "")
  .replace(/```$/i, "")
  .trim();

  const startObj = cleaned.indexOf("{");
  const startArr = cleaned.indexOf("[");

  const starts = [startObj, startArr].filter(i => i !== -1);
  if (!starts.length) {
    throw new Error("Claude 응답에서 JSON을 찾지 못했습니다.");
  }

  const start = Math.min(...starts);
  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === open) depth++;
    if (ch === close) depth--;

    if (depth === 0) {
      const jsonText = cleaned.slice(start, i + 1);
      return JSON.parse(jsonText);
    }
  }

  throw new Error("Claude 응답 JSON이 닫히지 않았습니다.");
}

export async function askClaudeJson(prompt, expect = "object") {
  const prefill = expect === "array" ? "[" : "{";

  const res = await fetch(ASK_CLAUDE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": await getAuthHeader(),
    },
    body: JSON.stringify({
      prompt: sanitizeForJson(prompt),
      encoded: true,
      prefill,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || "Claude 요청 실패");
  }

  const text = data.content?.[0]?.text || "";
  if (!text) throw new Error("Claude 응답이 비어 있습니다.");

  return extractJson(text);
}

export async function askClaudeText(prompt) {
  const res = await fetch(ASK_CLAUDE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": await getAuthHeader(),
    },
    body: JSON.stringify({
  prompt: sanitizeForJson(prompt),
  encoded: true
}),
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
    String(value ?? "").replace(/\u0000/g, "")
  );
}