/**
 * parse-document Edge Function
 *
 * docId를 받아 다음을 수행:
 *   1. documents 조회
 *   2. file_url(또는 converted_pdf_path) Storage에서 다운로드
 *   3. sha256 계산
 *   4. 같은 sha256 + DONE 문서 있으면 layout_json_path 재사용
 *   5. 없으면 Upstage Document Parse 호출 → layout 변환
 *   6. layout-json 버킷에 업로드
 *   7. documents UPDATE
 *
 * 호출 방법:
 *   POST /functions/v1/parse-document
 *   Authorization: Bearer <user_jwt>
 *   Body: { docId: string }
 *
 * 환경변수 (Supabase Dashboard > Functions > Secrets):
 *   UPSTAGE_API_KEY           - Upstage API 키
 *   SUPABASE_URL              - 자동 주입
 *   SUPABASE_SERVICE_ROLE_KEY - 자동 주입
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DOCUMENT_BUCKET = 'documents'
const LAYOUT_BUCKET = 'layout-json'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  })
}

  let docId: string | undefined

  try {
    // ── 인증 ─────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    const { data: { user }, error: authErr } = await sb.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    // ── 요청 파싱 ─────────────────────────────────────────
    const body = await req.json().catch(() => ({}))

docId = body?.docId || body?.document_id

if (!docId) {
  return json({ error: 'docId required' }, 400)
}
    const apiKey = Deno.env.get('UPSTAGE_API_KEY')
    if (!apiKey) return json({ error: 'UPSTAGE_API_KEY not set' }, 500)

    // ── PROCESSING ──────────────────────────────────────
    await updateDoc(sb, docId, {
      parse_status: 'PROCESSING',
      parse_error: null,
    })

    // ── 문서 조회 ────────────────────────────────────────
    const { data: doc, error: docErr } = await sb
      .from('documents')
      .select('*')
      .eq('id', docId)
      .eq('user_id', user.id)
      .single()

    if (docErr || !doc) {
      await updateDoc(sb, docId, {
        parse_status: 'FAILED',
        parse_error: 'Document not found',
      })
      return json({ error: 'Document not found' }, 404)
    }

    const sourcePath =
      doc.file_type === 'PDF' ? doc.file_url : doc.converted_pdf_path

    if (!sourcePath) {
      await updateDoc(sb, docId, {
        parse_status: 'FAILED',
        parse_error: '분석할 PDF 경로가 없습니다.',
      })
      return json({ error: '분석할 PDF 경로가 없습니다.' }, 400)
    }

    // ── Storage 다운로드 ─────────────────────────────────
    const { bytes, fileName } = await downloadStorageFile(sb, sourcePath)
    const hash = await sha256Bytes(bytes)

    // ── 캐시 체크 ────────────────────────────────────────
    const cached = await findCachedLayout(sb, hash, docId)

    if (cached?.layout_json_path) {
      await updateDoc(sb, docId, {
        sha256: hash,
        parse_status: 'DONE',
        layout_json_path: cached.layout_json_path,
        parse_error: null,
      })

      return json({
        ok: true,
        cached: true,
        docId,
        sha256: hash,
        layoutJsonPath: cached.layout_json_path,
      })
    }

    // ── Upstage 호출 ─────────────────────────────────────
    const upstageJson = await callUpstageParseBytes(bytes, fileName, apiKey)

    const layout = upstageToLayout(upstageJson, {
      docId,
      sha256: hash,
      fileName: doc.file_name || fileName,
    })

    const layoutPath = `${hash}/layout.json`
    await uploadLayoutJson(sb, layoutPath, layout)

    await updateDoc(sb, docId, {
      sha256: hash,
      parse_status: 'DONE',
      layout_json_path: layoutPath,
      parse_error: null,
    })

    return json({
      ok: true,
      cached: false,
      docId,
      sha256: hash,
      layoutJsonPath: layoutPath,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[PARSE ERROR]', msg, e)

    if (docId) {
      try {
        const sb = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        )
        await updateDoc(sb, docId, {
          parse_status: 'FAILED',
          parse_error: msg,
        })
      } catch { /* ignore */ }
    }

    return json({ error: msg }, 500)
  }
})

// ============================================================================
// utils
// ============================================================================
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  })
}

function basename(p: string): string {
  const parts = p.split('/')
  return parts[parts.length - 1] || p
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// ============================================================================
// Supabase helpers
// ============================================================================
// deno-lint-ignore no-explicit-any
async function updateDoc(sb: any, docId: string, patch: Record<string, unknown>) {
  const { error } = await sb.from('documents').update(patch).eq('id', docId)
  if (error) throw error
}

// deno-lint-ignore no-explicit-any
async function findCachedLayout(sb: any, sha256: string, currentDocId: string) {
  const { data, error } = await sb
    .from('documents')
    .select('id, layout_json_path')
    .eq('sha256', sha256)
    .eq('parse_status', 'DONE')
    .not('layout_json_path', 'is', null)
    .neq('id', currentDocId)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}

function parseStoragePath(value: string) {
  const raw = String(value || '').replace(/^\/+/, '')

  if (raw.includes('://')) {
    throw new Error('signed URL이 아니라 Storage path가 필요합니다.')
  }

  const parts = raw.split('/')

  if (parts[0] === DOCUMENT_BUCKET) {
    return { bucket: DOCUMENT_BUCKET, path: parts.slice(1).join('/') }
  }

  return { bucket: DOCUMENT_BUCKET, path: raw }
}

// deno-lint-ignore no-explicit-any
async function downloadStorageFile(sb: any, storagePath: string) {
  const parsed = parseStoragePath(storagePath)

  const { data, error } = await sb.storage
    .from(parsed.bucket)
    .download(parsed.path)

  if (error) throw error

  const arrayBuffer = await data.arrayBuffer()
  return {
    bytes: new Uint8Array(arrayBuffer),
    fileName: basename(parsed.path),
  }
}

// deno-lint-ignore no-explicit-any
async function uploadLayoutJson(sb: any, layoutPath: string, layout: unknown) {
  const body = new TextEncoder().encode(JSON.stringify(layout, null, 2))

  const { error } = await sb.storage
    .from(LAYOUT_BUCKET)
    .upload(layoutPath, body, {
      contentType: 'application/json',
      upsert: true,
    })

  if (error) throw error
}

// ============================================================================
// Upstage
// ============================================================================
async function callUpstageParseBytes(
  bytes: Uint8Array,
  fileName: string,
  apiKey: string,
) {
  const form = new FormData()
  const blob = new Blob([bytes], { type: 'application/pdf' })

  form.append('document', blob, fileName)
  form.append('model', 'document-parse')
  form.append('ocr', 'auto')
  form.append('base64_encoding', '[]')
  form.append('output_formats', '["html","markdown"]')

  const response = await fetch(
    'https://api.upstage.ai/v1/document-digitization',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    },
  )

  const text = await response.text()

  if (!response.ok) {
    throw new Error(`Upstage 오류 ${response.status}: ${text}`)
  }

  return JSON.parse(text)
}

// ============================================================================
// Layout 변환 (Upstage → 내부 layout JSON)
// ============================================================================
// deno-lint-ignore no-explicit-any
function upstageToLayout(
  upstageJson: any,
  { docId, sha256, fileName }: { docId: string; sha256: string; fileName: string },
) {
  // deno-lint-ignore no-explicit-any
  const pages = new Map<number, any>()

  for (const el of upstageJson.elements || []) {
    const pageNum = Number(el.page || el.page_num || 1)

    if (!pages.has(pageNum)) {
      pages.set(pageNum, {
        page: pageNum,
        width: 595,
        height: 842,
        background: null,
        overlaySource: 'upstage',
        blocks: [],
        overlays: [],
      })
    }

    const page = pages.get(pageNum)
    const block = upstageElementToBlock(el, page)

    page.blocks.push(block)
    page.overlays.push(block)
  }

  const pageList = [...pages.values()].sort((a, b) => a.page - b.page)

  return {
    docId,
    sha256,
    fileName,
    parser: 'upstage-document-parse',
    page_count: pageList.length,
    pages: pageList,
    chunks: createChunks(pageList),
    rawUpstage: upstageJson,
  }
}

// deno-lint-ignore no-explicit-any
function upstageElementToBlock(el: any, page: any) {
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

function mapCategoryToType(category: string) {
  const c = String(category || '').toLowerCase()

  if (c.includes('heading') || c === 'title' || c === 'section_header') return 'heading'
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

// deno-lint-ignore no-explicit-any
function getBBox(el: any, page: any): number[] {
  const coords = el.coordinates || el.bounding_box || el.boundingPoly || el.bbox

  if (!coords) return [40, 40, page.width - 40, 80]

  if (
    Array.isArray(coords) &&
    coords.length === 4 &&
    coords.every((v: unknown) => typeof v === 'number')
  ) {
    return normalizeBBox(coords as number[], page)
  }

  if (Array.isArray(coords)) {
    // deno-lint-ignore no-explicit-any
    const points = coords.map((p: any) => {
      if (Array.isArray(p)) return { x: Number(p[0]), y: Number(p[1]) }
      return { x: Number(p.x), y: Number(p.y) }
    })

    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)

    return normalizeBBox(
      [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
      page,
    )
  }

  return [40, 40, page.width - 40, 80]
}

// deno-lint-ignore no-explicit-any
function normalizeBBox(bbox: number[], page: any): number[] {
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

// deno-lint-ignore no-explicit-any
function createChunks(pages: any[]) {
  // deno-lint-ignore no-explicit-any
  const chunks: any[] = []
  let idx = 1

  for (const page of pages) {
    for (const block of page.blocks) {
      const text = block.markdown || block.cleanText || block.text || ''
      if (!text.trim()) continue

      chunks.push({
        chunk_id: `c${String(idx).padStart(4, '0')}`,
        block_id: block.block_id,
        block_ids: [block.block_id],
        type: block.type,
        page: page.page,
        text,
        html: block.html || '',
        markdown: block.markdown || '',
        source: 'upstage',
        useForSearch: true,
      })

      idx++
    }
  }

  return chunks
}

function cleanText(text: string) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/(?<=[가-힣])\s+(?=[가-힣])/g, '')
    .trim()
}

function stripHtml(html: string) {
  return String(html || '').replace(/<[^>]*>/g, ' ')
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}