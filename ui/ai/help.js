import {
  getChunksQuiet,
  askClaudeText,
  AI_STATE,
  buildHelpContext,
  extractKeywordsHeuristic,
  escapeHtml,
} from './common.js'
import { sb } from '/src/lib/supabase.js'

// 탭 정의 (순서 = 2×2 그리드 순서)
const TABS = [
  { type: '어려운 단어 풀이', label: '단어 풀이' },
  { type: '쉬운 말로 다시 설명', label: '쉽게 설명' },
  { type: '예시 들어주기', label: '예시' },
  { type: '앞뒤 맥락 짚어주기', label: '맥락 설명' },
]

let currentPopup = null   // 동시 1개만

// ─── 이벤트 진입점 ───────────────────────────────────────────
// layoutViewer.js: 💡 클릭 → open-help-popup (메뉴 없이 바로)
window.addEventListener('open-help-popup', (e) => {
  const { block, element } = e.detail
  openPopup(block, element)
})

window.addEventListener('doc-changed', () => {
  removePopup()
  helpCache = { docId: null, data: null }   // ← 수정 (helpCacheMem → helpCache)
  window._helpedBlocks = new Set()
  window._helpDoneTypes = {}
})

// ─── 팝업 생성/제거 ─────────────────────────────────────────
function removePopup() {
  currentPopup?.remove()
  currentPopup = null
}

function openPopup(block, markerEl) {
  // 같은 마커 다시 클릭 → 토글로 닫기
  if (currentPopup && currentPopup.dataset.blockId === block.blockId) {
    removePopup()
    return
  }
  removePopup()  // 다른 팝업 열려 있으면 닫기

  const popup = document.createElement('div')
  popup.className = 'help-popup'
  popup.dataset.blockId = block.blockId

  const done = window._helpDoneTypes?.[block.blockId] || new Set()

  popup.innerHTML = `
    <div class="help-popup-header">
      <span class="help-popup-title">도움말</span>
      <button class="help-popup-close" type="button" aria-label="닫기">×</button>
    </div>
    <div class="help-popup-tabs">
  ${TABS.map(t => `
    <button class="help-tab${done.has(t.type) ? ' done' : ''}"
            data-type="${escapeHtml(t.type)}"
            title="${escapeHtml(t.type)}">
      ${escapeHtml(t.label)}
    </button>
  `).join('')}
</div>
    <div class="help-popup-body">
      <div class="help-popup-intro">
        어떤 도움이 필요한가요?<br>위 탭을 눌러보세요.
      </div>
    </div>
  `

  // 마커와 같은 레일에 붙임 (마커의 부모 = page-help-rail)
  markerEl.parentElement.appendChild(popup)
  const markerTop = parseFloat(markerEl.style.top) || 0
  popup.style.top = `${markerTop + 40}px`   // 마커(32px) + 여백 8px
  popup.style.left = '0px'

  popup.querySelector('.help-popup-close')
    .addEventListener('click', removePopup)

  popup.querySelectorAll('.help-tab').forEach(tabBtn => {
    tabBtn.addEventListener('click', () => {
      selectTab(popup, block, tabBtn.dataset.type)
    })
  })

  currentPopup = popup
}

// ─── 탭 선택 ────────────────────────────────────────────────
// ─── 탭 선택 ────────────────────────────────────────────────
async function selectTab(popup, block, type, opts = {}) {
  // [3번] 이미 생성 중인 탭이면 무시 (연타 차단)
  if (popup.dataset.loading) return

  popup.querySelectorAll('.help-tab').forEach(t => {
    t.classList.toggle('current', t.dataset.type === type)
  })
  const bodyEl = popup.querySelector('.help-popup-body')
  const marker = document.querySelector(`.page-help-marker[data-block-id="${cssEscape(block.blockId)}"]`)

  // 단어 탭은 항상 picker
  if (type === '어려운 단어 풀이') {
    const chunks = await getChunksQuiet()
    if (!popup.isConnected) return                     // [2번] 팝업 닫혔으면 중단
    const targetChunk = findChunkByBlockId(chunks, block.blockId)
    const result = await handleVocab({ targetChunk, contextText: '', userInput: '' })
    if (!popup.isConnected) return                     // [2번]
    renderResult(bodyEl, result, block, popup)
    return
  }

  // 나머지 탭 — 캐시 있으면 즉시
  const cached = await getHelpCacheEntry(block.blockId, type, '')
  if (cached) {
    if (!popup.isConnected) return                     // [2번]
    renderResult(bodyEl, cached, block, popup)
    return
  }

  bodyEl.innerHTML = `
    <div class="help-loading">
      <div class="help-spinner"></div>
      <span>${escapeHtml(type)} 생성 중...</span>
    </div>
  `
  setMarkerState(marker, 'loading')
  popup.dataset.loading = type                         // [3번] 생성 중 표시

  try {
    const chunks = await getChunksQuiet()
    const targetChunk = findChunkByBlockId(chunks, block.blockId)
    if (!targetChunk) {
      if (popup.isConnected) {
        bodyEl.innerHTML = `<div class="help-error">단락을 청크에서 찾을 수 없습니다.</div>`
      }
      setMarkerState(marker, 'idle')
      return
    }

    const helpCtx = buildHelpContext(targetChunk.chunk_id, chunks)
    const contextText = formatHelpContext(helpCtx, targetChunk.chunk_id)
    const result = await routeHelp(type, { targetChunk, contextText })

    if (result.mode !== 'vocab_picker' && !result.thin) {
      await setHelpCacheEntry(block.blockId, type, '', result)
      markTabDone(popup, block.blockId, type)
    }

    if (!popup.isConnected) return                     // [2번] 응답 도착했는데 팝업 닫힘 → 버림
    renderResult(bodyEl, result, block, popup)
    setMarkerState(marker, result.thin ? 'idle' : 'done')
  } catch (err) {
    console.error(err)
    if (popup.isConnected) {
      bodyEl.innerHTML = `<div class="help-error">${escapeHtml(err.message || '생성 실패')}</div>`
    }
    setMarkerState(marker, 'idle')
  } finally {
    delete popup.dataset.loading                       // [3번] 생성 끝 → 플래그 해제
  }
}

// 마커 이모지/상태 변경
function setMarkerState(marker, state) {
  if (!marker) return
  const iconSpan = marker.childNodes[0]  // 첫 노드 = 이모지 텍스트

  if (state === 'loading') {
    marker.classList.add('loading')
    marker.firstChild.textContent = '⏳'
  } else if (state === 'done') {
    marker.classList.remove('loading')
    marker.classList.add('has-help')
    marker.firstChild.textContent = '​📝'   // 도움말 있음 = 문서 이모지
  } else {
    marker.classList.remove('loading')
    marker.firstChild.textContent = '💡'
  }
}

// 탭/마커 "생성됨" 상태 기록
function markTabDone(popup, blockId, type) {
  window._helpedBlocks = window._helpedBlocks || new Set()
  window._helpedBlocks.add(blockId)
  window._helpDoneTypes = window._helpDoneTypes || {}
  window._helpDoneTypes[blockId] = window._helpDoneTypes[blockId] || new Set()
  window._helpDoneTypes[blockId].add(type)

  popup.querySelector(`.help-tab[data-type="${cssEscape(type)}"]`)
    ?.classList.add('done')

  document.querySelector(`.page-help-marker[data-block-id="${cssEscape(blockId)}"]`)
    ?.classList.add('has-help')
}

// ─── 결과 렌더링 ────────────────────────────────────────────
function renderResult(bodyEl, result, block, popup) {
  if (result.mode === 'vocab_picker') {
    renderVocabPicker(bodyEl, result, block, popup)
  } else {
    bodyEl.innerHTML = `
      ${result.targetText ? `<div class="help-result-target">${escapeHtml(result.targetText)}</div>` : ''}
      <div class="help-result-title">${escapeHtml(result.title)}</div>
      <div class="help-result-body">${renderMarkdown(result.body)}</div>
    `
  }
}

async function renderVocabPicker(bodyEl, result, block, popup) {
  // 이 단락에서 이미 물어본 단어들 (캐시 키에서 추출)
  const cache = await loadHelpCache()
  const askedWords = Object.keys(cache)
    .filter(k => k.startsWith(`${block.blockId}::어려운 단어 풀이::`))
    .map(k => k.split('::')[2])
    .filter(Boolean)

  const suggestChips = result.suggestions
    .map(w => `<button class="help-vocab-chip" data-word="${escapeHtml(w)}">${escapeHtml(w)}</button>`)
    .join('')

  const askedChips = askedWords.length
    ? `<div class="help-vocab-prompt" style="margin-top:10px;">이미 찾아본 단어</div>
       <div class="help-vocab-chips">
         ${askedWords.map(w =>
           `<button class="help-vocab-chip asked" data-word="${escapeHtml(w)}">${escapeHtml(w)}</button>`
         ).join('')}
       </div>`
    : ''

  bodyEl.innerHTML = `
    <div class="help-vocab-picker">
      <div class="help-vocab-prompt">어떤 단어가 어려운가요?</div>
      <div class="help-vocab-chips">${suggestChips}</div>
      <input class="help-vocab-input" placeholder="직접 입력 후 Enter" />
      ${askedChips}
    </div>
  `

  bodyEl.querySelectorAll('.help-vocab-chip').forEach(btn => {
    btn.addEventListener('click', () => askVocab(bodyEl, block, popup, btn.dataset.word))
  })
  const input = bodyEl.querySelector('.help-vocab-input')
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && input.value.trim()) {
      askVocab(bodyEl, block, popup, input.value.trim())
    }
  })
  input.focus()
}

async function askVocab(bodyEl, block, popup, word) {
  if (popup.dataset.loading) return                    // [3번] 연타 차단

  bodyEl.innerHTML = `
    <div class="help-loading">
      <div class="help-spinner"></div>
      <span>"${escapeHtml(word)}" 설명 생성 중...</span>
    </div>
  `
  popup.dataset.loading = 'vocab'

  try {
    const cached = await getHelpCacheEntry(block.blockId, '어려운 단어 풀이', word)
    if (cached) {
      if (popup.isConnected) renderVocabResult(bodyEl, block, popup, cached)
      return
    }

    const chunks = await getChunksQuiet()
    const targetChunk = findChunkByBlockId(chunks, block.blockId)
    const helpCtx = buildHelpContext(targetChunk.chunk_id, chunks)
    const contextText = formatHelpContext(helpCtx, targetChunk.chunk_id)

    const result = await handleVocab({ targetChunk, contextText, userInput: word })

    if (!result.thin) {
      await setHelpCacheEntry(block.blockId, '어려운 단어 풀이', word, result)
      markTabDone(popup, block.blockId, '어려운 단어 풀이')
    }

    if (!popup.isConnected) return                     // [2번]
    renderVocabResult(bodyEl, block, popup, result)
  } catch (err) {
    if (popup.isConnected) {
      bodyEl.innerHTML = `<div class="help-error">${escapeHtml(err.message || '생성 실패')}</div>`
    }
  } finally {
    delete popup.dataset.loading
  }
}

function renderVocabResult(bodyEl, block, popup, result) {
  bodyEl.innerHTML = `
    <div class="help-result-title">${escapeHtml(result.title)}</div>
    <div class="help-result-body">${renderMarkdown(result.body)}</div>
    <button class="help-vocab-again" type="button">다른 단어 물어보기</button>
  `
  bodyEl.querySelector('.help-vocab-again')
    .addEventListener('click', () => {
      // picker 다시 — 단, 이미 물어본 단어는 칩에 표시
      selectTab(popup, block, '어려운 단어 풀이', { forcePicker: true })
    })
}

// ─── 컨텍스트 헬퍼 ──────────────────────────────────────────
function findChunkByBlockId(chunks, blockId) {
  return chunks.find(c =>
    c.block_ids?.includes(blockId) ||
    c.source_blocks?.includes(blockId) ||
    c.block_id === blockId
  )
}

function formatHelpContext(helpCtx, targetId) {
  return helpCtx.map(({ chunk, role }) => {
    const marker = chunk.chunk_id === targetId ? '👉 ' : ''
    return `${marker}[${chunk.chunk_id} | role: ${role}]\n${chunk.text}`
  }).join('\n\n')
}

function isTooThin(text) {
  const clean = String(text || '')
    .replace(/\[.*?\]/g, '')
    .trim()

  const lines = clean
    .split('\n')
    .map(v => v.trim())
    .filter(Boolean)

  // 본문 없이 제목/키워드만 있는 경우
  const looksLikeOnlyTitles = lines.every(line => {
    return (
      line.length < 40 &&
      !/[.!?다요됨음]/.test(line)
    )
  })

  return looksLikeOnlyTitles
}
function thinResult(title) {
  return {
    mode: 'text',
    thin: true,
    title,
    body: '이 부분은 내용이 짧아 설명할 내용이 부족합니다.'
  }
}

// ─── 라우터 + 4핸들러 ───────────────────────────────────────
async function routeHelp(type, ctx) {
  switch (type) {
    case '어려운 단어 풀이': return handleVocab(ctx)
    case '쉬운 말로 다시 설명': return handleSimplify(ctx)
    case '예시 들어주기': return handleExample(ctx)
    case '앞뒤 맥락 짚어주기': return handleContext(ctx)
    default: throw new Error('알 수 없는 도움말 유형: ' + type)
  }
}

async function handleVocab({ targetChunk, contextText, userInput }) {
  if (!userInput) {
    const suggestions = targetChunk.keywords?.length
      ? targetChunk.keywords
      : extractKeywordsHeuristic(targetChunk.text || '')
    if (!suggestions.length) return thinResult('단어 풀이')
    return { mode: 'vocab_picker', suggestions: suggestions.slice(0, 5) }
  }

  const prompt = `
"${userInput}"의 뜻을 2문장으로 설명해라.
1문장: "쉽게 말하면 ~" 정의. 2문장: 이 문서에서 왜 중요한지.

[참고 맥락]
${contextText}

만약 "${userInput}"이 실제 단어·용어·약어가 아니면(오타·무작위 입력 등),
설명하지 말고 아래 문장 하나만 그대로 출력해라:
관련된 단어를 입력해 주세요.

규칙: 서두·인사·분석 과정 쓰지 말고 곧바로 결과만. 표·이모지·목록 금지.
"${userInput}" 외의 다른 용어를 대신 설명하지 마라.
`.trim()

  const body = await askClaudeText(prompt)
  return { mode: 'text', title: `"${userInput}"`, body }
}

async function handleSimplify({ targetChunk }) {
  if (isTooThin(targetChunk.text)) return thinResult('쉬운 말로 풀어보면')
  const prompt = `
다음 단락을, 이 분야를 처음 접하는 사람도 이해할 수 있게 쉬운 말로 다시 써주세요.

[원문]
${targetChunk.text}

[작성 지침]
- 전문용어는 풀어쓰기 (예: "오버헤드" → "추가로 드는 부담")
- 긴 문장은 짧게 나누기
- 핵심 뜻은 유지
- 3~5문장
- 마크다운 강조는 핵심 단어에만
`.trim()

  const body = await askClaudeText(prompt)
  return { mode: 'text', title: '쉬운 말로 풀어보면', body }
}

async function handleExample({ targetChunk, contextText }) {
  if (isTooThin(targetChunk.text)) return thinResult('예를 들면')
  const prompt = `
다음 내용을 일상적인 예시나 비유로 설명해라.

[설명할 내용]
${targetChunk.text}

[참고 맥락]
${contextText}

규칙:
- 일상 비유 사용 (요리, 운동, 학교생활, 게임 등), 구체적 예시 1~2개
- 비유가 원래 개념과 어떻게 대응되는지 한 줄로 짚기
- 4~6문장
- 'c0003' 같은 식별자나 'before/after/target' 같은 내부 용어를 답변에 쓰지 마라.
- 표·이모지·헤딩 금지.
`.trim()

  const body = await askClaudeText(prompt)
  return { mode: 'text', title: '예를 들면', body }
}

async function handleContext({ targetChunk, contextText }) {
  const realText = String(contextText || '').replace(/\[.*?\]/g, '')
  if (isTooThin(realText)) return thinResult('앞뒤 흐름')

  const prompt = `
학생이 문서를 읽다가 아래 단락에서 막혔습니다.
이 단락이 문서 흐름에서 어떤 역할인지, 앞 내용과 어떻게 이어지고 뒤로 어떻게 연결되는지 4~6문장으로 설명해라.

[지금 막힌 단락]
${targetChunk.text}

[주변 맥락 — 이해를 돕기 위한 자료]
${contextText}

규칙:
- 'c0003', 'c0004' 같은 식별자나 'before', 'after', 'target', 'role' 같은 내부 용어를 절대 답변에 쓰지 마라.
- 대신 "앞에서는", "이 부분은", "이어지는 내용에서는" 처럼 자연스러운 한국어로 표현해라.
- 학생은 문서가 조각으로 나뉜 걸 모른다. 하나의 글을 읽는 사람에게 말하듯 설명해라.
- 설명문만 출력. 계획·단계·표·이모지·헤딩 금지.
- 맥락이 적으면 그 안에서 짧게 설명하고 끝낼 것.
`.trim()

  const body = await askClaudeText(prompt)
  return { mode: 'text', title: '앞뒤 흐름', body }
}

// ─── 마크다운 (강조/단락만) ─────────────────────────────────
function renderMarkdown(text) {
  return escapeHtml(text || '')
    .replace(/^#{1,6}\s*/gm, '')        // #### 헤딩 마커 제거
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .split(/\n\n+/)
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

// ─── 도움말 DB (document_help 테이블) ───────────────────────
async function loadHelpFromDb() {
  const docId = AI_STATE.docId
  if (!docId || docId === 'demo') return {}
  try {
    const { data } = await sb
      .from('document_help')
      .select('cache')
      .eq('document_id', docId)
      .maybeSingle()
    return data?.cache ?? {}
  } catch (e) {
    console.warn('도움말 로드 실패:', e.message)
    return {}
  }
}

async function saveHelpToDb(cache) {
  const docId = AI_STATE.docId
  if (!docId || docId === 'demo') return
  try {
    await sb
      .from('document_help')
      .upsert(
        { document_id: docId, cache, updated_at: new Date().toISOString() },
        { onConflict: 'document_id' }
      )
  } catch (e) {
    console.warn('도움말 저장 실패:', e.message)
  }
}

// ─── 캐시 (sessionStorage + DB 2단) ─────────────────────────
let helpCache = { docId: null, data: null }

async function loadHelpCache() {
  const docId = AI_STATE.docId
  // 같은 문서 메모리 캐시면 재사용
  if (helpCache.docId === docId && helpCache.data) {
    return helpCache.data
  }
  // sessionStorage
  try {
    const ss = sessionStorage.getItem(`nungil_help_${docId}`)
    if (ss) {
      helpCache = { docId, data: JSON.parse(ss) }
      return helpCache.data
    }
  } catch { }
  // DB
  const data = await loadHelpFromDb()
  helpCache = { docId, data }
  return data
}

async function setHelpCacheEntry(blockId, type, userInput, value) {
  const docId = AI_STATE.docId
  const cache = await loadHelpCache()
  cache[`${blockId}::${type}::${userInput || ''}`] = value
  helpCache = { docId, data: cache }
  sessionStorage.setItem(`nungil_help_${docId}`, JSON.stringify(cache))
  await saveHelpToDb(cache)
}

async function getHelpCacheEntry(blockId, type, userInput) {
  const cache = await loadHelpCache()
  return cache[`${blockId}::${type}::${userInput || ''}`] ?? null
}

// CSS 셀렉터에 한글/특수문자 안전하게
function cssEscape(str) {
  return (window.CSS && CSS.escape) ? CSS.escape(str) : str
}

// 문서 열릴 때 — DB 캐시 기준으로 마커 has-help 복원
async function restoreHelpMarkers() {
  const cache = await loadHelpCache()
  const blockIds = new Set()
  const doneTypes = {}

  for (const key of Object.keys(cache)) {
    const [blockId, type] = key.split('::')
    blockIds.add(blockId)
    doneTypes[blockId] = doneTypes[blockId] || new Set()
    doneTypes[blockId].add(type)
  }

  window._helpedBlocks = blockIds
  window._helpDoneTypes = doneTypes

  blockIds.forEach(id => {
    const marker = document.querySelector(`.page-help-marker[data-block-id="${id}"]`)
    if (marker) {
      marker.classList.add('has-help')
      if (marker.firstChild) marker.firstChild.textContent = '​📝'   // ← 이모지도 복원
    }
  })
}
window.addEventListener('layout-rendered', restoreHelpMarkers)