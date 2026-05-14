[1mdiff --git a/devServer.js b/devServer.js[m
[1mindex 23e8c67e..0e3edfea 100644[m
[1m--- a/devServer.js[m
[1m+++ b/devServer.js[m
[36m@@ -1,56 +1,461 @@[m
[31m-const http = require('http');[m
[31m-const fs = require('fs');[m
[31m-const path = require('path');[m
[31m-[m
[31m-const PORT = 3000;[m
[31m-[m
[31m-const MIME = {[m
[31m-  '.html': 'text/html',[m
[31m-  '.js': 'application/javascript',[m
[31m-  '.mjs': 'application/javascript',[m
[31m-  '.css': 'text/css',[m
[31m-  '.json': 'application/json',[m
[31m-  '.wasm': 'application/wasm',[m
[31m-  '.png': 'image/png',[m
[31m-  '.jpg': 'image/jpeg',[m
[31m-  '.jpeg': 'image/jpeg',[m
[31m-  '.svg': 'image/svg+xml',[m
[31m-  '.ico': 'image/x-icon',[m
[31m-  '.data': 'application/octet-stream',[m
[31m-  '.bin': 'application/octet-stream',[m
[31m-};[m
[31m-[m
[31m-http.createServer((req, res) => {[m
[31m-  let url = req.url.split('?')[0];[m
[31m-[m
[31m-  if (url === '/') {[m
[31m-    res.writeHead(302, { Location: '/ui/start.html' });[m
[31m-    res.end();[m
[31m-    return;[m
[31m-  }[m
[31m-[m
[31m-  const fp = path.join(__dirname, url);[m
[31m-[m
[31m-  fs.readFile(fp, (err, data) => {[m
[31m-    if (err) {[m
[31m-      res.writeHead(404);[m
[31m-      res.end('404');[m
[31m-      return;[m
[32m+[m[32m// ============================================================================[m
[32m+[m[32m// devServer.js  ―  눈길 Dev Server (로컬 개발용)[m
[32m+[m[32m// ============================================================================[m
[32m+[m[32m// 실행 전 체크[m
[32m+[m[32m//   1) npm i express @supabase/supabase-js[m
[32m+[m[32m//   2) Node 18+ (fetch / FormData / Blob 내장)[m
[32m+[m[32m//   3) 아래 SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY 채우기[m
[32m+[m[32m//   4) node devServer.js[m
[32m+[m[32m// ============================================================================[m
[32m+[m[32m//[m
[32m+[m[32m// 흐름:[m
[32m+[m[32m//   프론트 → devServer.js (/analyze-document)[m
[32m+[m[32m//          → PDF 다운로드, sha256, 캐시 체크[m
[32m+[m[32m//          → parse-document Edge Function 호출 (Upstage 키 보호용)[m
[32m+[m[32m//          → layout 변환, Storage 업로드, DB 업데이트[m
[32m+[m[32m//[m
[32m+[m[32m// ============================================================================[m
[32m+[m
[32m+[m[32mconst express = require('express')[m
[32m+[m[32mconst path = require('path')[m
[32m+[m[32mconst crypto = require('crypto')[m
[32m+[m[32mconst { createClient } = require('@supabase/supabase-js')[m
[32m+[m
[32m+[m[32mconst app = express()[m
[32m+[m[32mconst PORT = 3000[m
[32m+[m
[32m+[m[32m// ---- 설정 ------------------------------------------------------------------[m
[32m+[m[32mconst SUPABASE_URL = 'https://cnaublclebiysmqatwzu.supabase.co'[m
[32m+[m[32mconst SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOi...'  // ← Project Settings → API → service_role[m
[32m+[m[32mconst SUPABASE_ANON_KEY = 'eyJhbGciOi...'          // ← Project Settings → API → anon (Edge Function 호출용)[m
[32m+[m[32mconst DOCUMENT_BUCKET = 'documents'[m
[32m+[m[32mconst LAYOUT_BUCKET = 'layout-json'[m
[32m+[m
[32m+[m[32m// Upstage 키는 Edge Function 안에만 있음. devServer는 Edge Function을 호출만 함.[m
[32m+[m[32mconst PARSE_DOCUMENT_URL = `${SUPABASE_URL}/functions/v1/parse-document`[m
[32m+[m
[32m+[m[32mconst sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {[m
[32m+[m[32m  auth: { persistSession: false },[m
[32m+[m[32m})[m
[32m+[m
[32m+[m[32mapp.use(express.json({ limit: '50mb' }))[m
[32m+[m
[32m+[m[32m// ---- COOP / COEP ----------------------------------------------------------[m
[32m+[m[32mapp.use((req, res, next) => {[m
[32m+[m[32m  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')[m
[32m+[m[32m  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')[m
[32m+[m[32m  next()[m
[32m+[m[32m})[m
[32m+[m
[32m+[m[32m// ---- 정적 서빙 -------------------------------------------------------------[m
[32m+[m[32mapp.use('/public', express.static(path.join(__dirname, 'public')))[m
[32m+[m[32mapp.use('/demo-pages', express.static(path.join(__dirname, 'public/demo-pages')))[m
[32m+[m[32mapp.use(express.static(__dirname))[m
[32m+[m
[32m+[m[32mapp.get('/', (_, res) => {[m
[32m+[m[32m  res.redirect('/ui/start.html')[m
[32m+[m[32m})[m
[32m+[m
[32m+[m[32m// ============================================================================[m
[32m+[m[32m// /analyze-document[m
[32m+[m[32m// ============================================================================[m
[32m+[m[32mapp.post('/analyze-document', async (req, res) => {[m
[32m+[m[32m  const { docId, userJwt } = req.body[m
[32m+[m
[32m+[m[32m  if (!docId) {[m
[32m+[m[32m    return res.status(400).json({ ok: false, error: 'docId가 없습니다.' })[m
[32m+[m[32m  }[m
[32m+[m
[32m+[m[32m  try {[m
[32m+[m[32m    await updateDoc(docId, {[m
[32m+[m[32m      parse_status: 'PROCESSING',[m
[32m+[m[32m      parse_error: null,[m
[32m+[m[32m    })[m
[32m+[m
[32m+[m[32m    const doc = await getDoc(docId)[m
[32m+[m
[32m+[m[32m    const sourcePath =[m
[32m+[m[32m      doc.file_type === 'PDF'[m
[32m+[m[32m        ? doc.file_url[m
[32m+[m[32m        : doc.converted_pdf_path[m
[32m+[m
[32m+[m[32m    if (!sourcePath) {[m
[32m+[m[32m      throw new Error('분석할 PDF 경로가 없습니다. PPT는 먼저 PDF 변환이 필요합니다.')[m
[32m+[m[32m    }[m
[32m+[m
[32m+[m[32m    const { buffer, fileName } = await downloadStorageFile(sourcePath)[m
[32m+[m[32m    const hash = sha256Buffer(buffer)[m
[32m+[m
[32m+[m[32m    // 같은 sha256 + DONE 문서가 이미 있으면 layout 재사용[m
[32m+[m[32m    const cached = await findCachedLayout(hash, docId)[m
[32m+[m
[32m+[m[32m    if (cached?.layout_json_path) {[m
[32m+[m[32m      await updateDoc(docId, {[m
[32m+[m[32m        sha256: hash,[m
[32m+[m[32m        parse_status: 'DONE',[m
[32m+[m[32m        layout_json_path: cached.layout_json_path,[m
[32m+[m[32m        parse_error: null,[m
[32m+[m[32m      })[m
[32m+[m
[32m+[m[32m      return res.json({[m
[32m+[m[32m        ok: true,[m
[32m+[m[32m        cached: true,[m
[32m+[m[32m        docId,[m
[32m+[m[32m        sha256: hash,[m
[32m+[m[32m        layoutJsonPath: cached.layout_json_path,[m
[32m+[m[32m      })[m
[32m+[m[32m    }[m
[32m+[m
[32m+[m[32m    // 캐시 miss → Edge Function 통해 Upstage 호출[m
[32m+[m[32m    const upstageJson = await callParseDocumentEdgeFunction(buffer, fileName, userJwt)[m
[32m+[m
[32m+[m[32m    const layout = upstageToLayout(upstageJson, {[m
[32m+[m[32m      docId,[m
[32m+[m[32m      sha256: hash,[m
[32m+[m[32m      fileName: doc.file_name || fileName,[m
[32m+[m[32m    })[m
[32m+[m
[32m+[m[32m    const layoutPath = `${hash}/layout.json`[m
[32m+[m[32m    await uploadLayoutJson(layoutPath, layout)[m
[32m+[m
[32m+[m[32m    await updateDoc(docId, {[m
[32m+[m[32m      sha256: hash,[m
[32m+[m[32m      parse_status: 'DONE',[m
[32m+[m[32m      layout_json_path: layoutPath,[m
[32m+[m[32m      parse_error: null,[m
[32m+[m[32m    })[m
[32m+[m
[32m+[m[32m    return res.json({[m
[32m+[m[32m      ok: true,[m
[32m+[m[32m      cached: false,[m
[32m+[m[32m      docId,[m
[32m+[m[32m      sha256: hash,[m
[32m+[m[32m      layoutJsonPath: layoutPath,[m
[32m+[m[32m    })[m
[32m+[m[32m  } catch (e) {[m
[32m+[m[32m    console.error('[ANALYZE ERROR]', e)[m
[32m+[m
[32m+[m[32m    await updateDoc(docId, {[m
[32m+[m[32m      parse_status: 'FAILED',[m
[32m+[m[32m      parse_error: e.message,[m
[32m+[m[32m    }).catch(() => {})[m
[32m+[m
[32m+[m[32m    return res.status(500).json({[m
[32m+[m[32m      ok: false,[m
[32m+[m[32m      error: e.message,[m
[32m+[m[32m    })[m
[32m+[m[32m  }[m
[32m+[m[32m})[m
[32m+[m
[32m+[m[32m// ============================================================================[m
[32m+[m[32m// Edge Function 호출[m
[32m+[m[32m// ============================================================================[m
[32m+[m[32masync function callParseDocumentEdgeFunction(buffer, fileName, userJwt) {[m
[32m+[m[32m  const pdfBase64 = buffer.toString('base64')[m
[32m+[m
[32m+[m[32m  const response = await fetch(PARSE_DOCUMENT_URL, {[m
[32m+[m[32m    method: 'POST',[m
[32m+[m[32m    headers: {[m
[32m+[m[32m      'Content-Type': 'application/json',[m
[32m+[m[32m      Authorization: `Bearer ${userJwt || SUPABASE_ANON_KEY}`,[m
[32m+[m[32m    },[m
[32m+[m[32m    body: JSON.stringify({ pdfBase64, fileName }),[m
[32m+[m[32m  })[m
[32m+[m
[32m+[m[32m  const text = await response.text()[m
[32m+[m
[32m+[m[32m  if (!response.ok) {[m
[32m+[m[32m    throw new Error(`parse-document Edge Function 오류 ${response.status}: ${text}`)[m
[32m+[m[32m  }[m
[32m+[m
[32m+[m[32m  return JSON.parse(text)[m
[32m+[m[32m}[m
[32m+[m
[32m+[m[32m// ============================================================================[m
[32m+[m[32m// Supabase helpers[m
[32m+[m[32m// ============================================================================[m
[32m+[m[32masync function getDoc(docId) {[m
[32m+[m[32m  const { data, error } = await sb[m
[32m+[m[32m    .from('documents')[m
[32m+[m[32m    .select('*')[m
[32m+[m[32m    .eq('id', docId)[m
[32m+[m[32m    .single()[m
[32m+[m
[32m+[m[32m  if (error) throw error[m
[32m+[m[32m  return data[m
[32m+[m[32m}[m
[32m+[m
[32m+[m[32masync function updateDoc(docId, patch) {[m
[32m+[m[32m  const { error } = await sb[m
[32m+[m[32m    .from('documents')[m
[32m+[m[32m    .update(patch)[m
[32m+[m[32m    .eq('id', docId)[m
[32m+[m
[32m+[m[32m  if (error) throw error[m
[32m+[m[32m}[m
[32m+[m
[32m+[m[32masync function findCachedLayout(sha256, currentDocId) {[m
[32m+[m[32m  const { data, error } = await sb[m
[32m+[m[32m    .from('documents')[m
[32m+[m[32m    .select('id, layout_json_path')[m
[32m+[m[32m    .eq('sha256', sha256)[m
[32m+[m[32m    .eq('parse_status', 'DONE')[m
[32m+[m[32m    .not('layout_json_path', 'is', null)[m
[32m+[m[32m    .neq('id', currentDocId)[m
[32m+[m[32m    .limit(1)[m
[32m+[m[32m    .maybeSingle()[m
[32m+[m
[32m+[m[32m  if (error) throw error[m
[32m+[m[32m  return data[m
[32m+[m[32m}[m
[32m+[m
[32m+[m[32mfunction parseStoragePath(value) {[m
[32m+[m[32m  const raw = String(value || '').replace(/^\/+/, '')[m
[32m+[m
[32m+[m[32m  if (raw.includes('://')) {[m
[32m+[m[32m    throw new Error('signed URL이 아니라 Storage path가 필요합니다.')[m
[32m+[m[32m  }[m
[32m+[m
[32m+[m[32m  const parts = raw.split('/')[m
[32m+[m
[32m+[m[32m  if (parts[0] === DOCUMENT_BUCKET) {[m
[32m+[m[32m    return {[m
[32m+[m[32m      bucket: DOCUMENT_BUCKET,[m
[32m+[m[32m      path: parts.slice(1).join('/'),[m
     }[m
[32m+[m[32m  }[m
[32m+[m
[32m+[m[32m  return {[m
[32m+[m[32m    bucket: DOCUMENT_BUCKET,[m
[32m+[m[32m    path: raw,[m
[32m+[m[32m  }[m
[32m+[m[32m}[m
[32m+[m
[32m+[m[32masync function downloadStorageFile(storagePath) {[m
[32m+[m[32m  const parsed = parseStoragePath(storagePath)[m
[32m+[m
[32m+[m[32m  const { data, error } = await sb.storage[m
[32m+[m[32m    .from(parsed.bucket)[m
[32m+[m[32m    .download(parsed.path)[m
[32m+[m
[32m+[m[32m  if (error) throw error[m
[32m+[m
[32m+[m[32m  const arrayBuffer = await data.arrayBuffer()[m
[32m+[m[32m  const buffer = Buffer.from(arrayBuffer)[m
[32m+[m
[32m+[m[32m  return {[m
[32m+[m[32m    buffer,[m
[32m+[m[32m    fileName: path.basename(parsed.path),[m
[32m+[m[32m  }[m
[32m+[m[32m}[m
[32m+[m
[32m+[m[32mfunction sha256Buffer(buffer) {[m
[32m+[m[32m  return crypto[m
[32m+[m[32m    .createHash('sha256')[m
[32m+[m[32m    .update(buffer)[m
[32m+[m[32m    .digest('hex')[m
[32m+[m[32m}[m
[32m+[m
[32m+[m[32masync function uploadLayoutJson(layoutPath, layout) {[m
[32m+[m[32m  const body = Buffer.from(JSON.stringify(layout, null, 2), 'utf-8')[m
[32m+[m
[32m+[m[32m  const { error } = await sb.storage[m
[32m+[m[32m    .from(LAYOUT_BUCKET)[m
[32m+[m[32m    .upload(layoutPath, body, {[m
[32m+[m[32m      contentType: 'application/json',[m
[32m+[m[32m      upsert: true,[m
[32m+[m[32m    })[m
[32m+[m
[32m+[m[32m  if (error) throw error[m
[32m+[m[32m}[m
[32m+[m
[32m+[m[32m// ============================================================================[m
[32m+[m[32m// Layout 변환 (Upstage → 내부 layout JSON)[m
[32m+[m[32m// ============================================================================[m
[32m+[m[32mfunction upstageToLayout(upstageJson, { docId, sha256, fileName }) {[m
[32m+[m[32m  const pages = new Map()[m
[32m+[m
[32m+[m[32m  for (const el of upstageJson.elements || []) {[m
[32m+[m[32m    const pageNum = Number(el.page || el.page_num || 1)[m
[32m+[m
[32m+[m[32m    if (!pages.has(pageNum)) {[m
[32m+[m[32m      pages.set(pageNum, {[m
[32m+[m[32m        page: pageNum,[m
[32m+[m[32m        width: 595,[m
[32m+[m[32m        height: 842,[m
[32m+[m[32m        background: null,[m
[32m+[m[32m        overlaySource: 'upstage',[m
[32m+[m[32m        blocks: [],[m
[32m+[m[32m        overlays: [],[m
[32m+[m[32m      })[m
[32m+[m[32m    }[m
[32m+[m
[32m+[m[32m    const page = pages.get(pageNum)[m
[32m+[m[32m    const block = upstageElementToBlock(el, page)[m
[32m+[m
[32m+[m[32m    page.blocks.push(block)[m
[32m+[m[32m    page.overlays.push(block)[m
[32m+[m[32m  }[m
[32m+[m
[32m+[m[32m  const pageList = [...pages.values()].sort((a, b) => a.page - b.page)[m
[32m+[m
[32m+[m[32m  return {[m
[32m+[m[32m    docId,[m
[32m+[m[32m    sha256,[m
[32m+[m[32m    fileName,[m
[32m+[m[32m    parser: 'upstage-document-parse',[m
[32m+[m[32m    page_count: pageList.length,[m
[32m+[m[32m    pages: pageList,[m
[32m+[m[32m    chunks: createChunks(pageList),[m
[32m+[m[32m    rawUpstage: upstageJson,[m
[32m+[m[32m  }[m
[32m+[m[32m}[m
[32m+[m
[32m+[m[32mfunction upstageElementToBlock(el, page) {[m
[32m+[m[32m  const category = el.category || el.type || 'paragraph'[m
[32m+[m[32m  const type = mapCategoryToType(category)[m
[32m+[m
[32m+[m[32m  const content = el.content || {}[m
[32m+[m[32m  const text =[m
[32m+[m[32m    content.text ||[m
[32m+[m[32m    content.markdown ||[m
[32m+[m[32m    stripHtml(content.html || '') ||[m
[32m+[m[32m    el.text ||[m
[32m+[m[32m    ''[m
[32m+[m
[32m+[m[32m  const bbox = getBBox(el, page)[m
[32m+[m
[32m+[m[32m  return {[m
[32m+[m[32m    block_id: `p${page.page}-up-${el.id ?? crypto.randomUUID()}`,[m
[32m+[m[32m    type,[m
[32m+[m[32m    category,[m
[32m+[m[32m    page: page.page,[m
[32m+[m[32m    x: bbox[0],[m
[32m+[m[32m    y: bbox[1],[m
[32m+[m[32m    width: bbox[2] - bbox[0],[m
[32m+[m[32m    height: bbox[3] - bbox[1],[m
[32m+[m[32m    bbox,[m
[32m+[m[32m    text,[m
[32m+[m[32m    cleanText: cleanText(text),[m
[32m+[m[32m    html: content.html || '',[m
[32m+[m[32m    markdown: content.markdown || '',[m
[32m+[m[32m    source: 'upstage',[m
[32m+[m[32m  }[m
[32m+[m[32m}[m
[32m+[m
[32m+[m[32mfunction mapCategoryToType(category) {[m
[32m+[m[32m  const c = String(category || '').toLowerCase()[m
[32m+[m
[32m+[m[32m  if (c.includes('heading') || c === 'title' || c === 'section_header') return 'heading'[m
[32m+[m[32m  if (c.includes('list')) return 'list'[m
[32m+[m[32m  if (c.includes('table')) return 'table'[m
[32m+[m[32m  if (c.includes('figure') || c.includes('image')) return 'figure'[m
[32m+[m[32m  if (c.includes('caption')) return 'caption'[m
[32m+[m[32m  if (c.includes('equation') || c.includes('formula')) return 'equation'[m
[32m+[m[32m  if (c.includes('code')) return 'code'[m
[32m+[m[32m  if (c.includes('footer')) return 'footer'[m
[32m+[m[32m  if (c.includes('header')) return 'header'[m
[32m+[m
[32m+[m[32m  return 'paragraph'[m
[32m+[m[32m}[m
[32m+[m
[32m+[m[32mfunction getBBox(el, page) {[m
[32m+[m[32m  const coords = el.coordinates || el.bounding_box || el.boundingPoly || el.bbox[m
[32m+[m
[32m+[m[32m  if (!coords) return [40, 40, page.width - 40, 80][m
[32m+[m
[32m+[m[32m  if ([m
[32m+[m[32m    Array.isArray(coords) &&[m
[32m+[m[32m    coords.length === 4 &&[m
[32m+[m[32m    coords.every(v => typeof v === 'number')[m
[32m+[m[32m  ) {[m
[32m+[m[32m    return normalizeBBox(coords, page)[m
[32m+[m[32m  }[m
[32m+[m
[32m+[m[32m  if (Array.isArray(coords)) {[m
[32m+[m[32m    const points = coords.map(p => {[m
[32m+[m[32m      if (Array.isArray(p)) return { x: Number(p[0]), y: Number(p[1]) }[m
[32m+[m[32m      return { x: Number(p.x), y: Number(p.y) }[m
[32m+[m[32m    })[m
[32m+[m
[32m+[m[32m    const xs = points.map(p => p.x)[m
[32m+[m[32m    const ys = points.map(p => p.y)[m
[32m+[m
[32m+[m[32m    return normalizeBBox([m
[32m+[m[32m      [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],[m
[32m+[m[32m      page,[m
[32m+[m[32m    )[m
[32m+[m[32m  }[m
[32m+[m
[32m+[m[32m  return [40, 40, page.width - 40, 80][m
[32m+[m[32m}[m
[32m+[m
[32m+[m[32mfunction normalizeBBox(bbox, page) {[m
[32m+[m[32m  let [x0, y0, x1, y1] = bbox.map(Number)[m
[32m+[m
[32m+[m[32m  const isNormalized = Math.max(x0, y0, x1, y1) <= 1.5[m
[32m+[m
[32m+[m[32m  if (isNormalized) {[m
[32m+[m[32m    x0 *= page.width[m
[32m+[m[32m    x1 *= page.width[m
[32m+[m[32m    y0 *= page.height[m
[32m+[m[32m    y1 *= page.height[m
[32m+[m[32m  }[m
[32m+[m
[32m+[m[32m  return [[m
[32m+[m[32m    clamp(x0, 0, page.width),[m
[32m+[m[32m    clamp(y0, 0, page.height),[m
[32m+[m[32m    clamp(x1, 0, page.width),[m
[32m+[m[32m    clamp(y1, 0, page.height),[m
[32m+[m[32m  ][m
[32m+[m[32m}[m
[32m+[m
[32m+[m[32mfunction createChunks(pages) {[m
[32m+[m[32m  const chunks = [][m
[32m+[m[32m  let idx = 1[m
[32m+[m
[32m+[m[32m  for (const page of pages) {[m
[32m+[m[32m    for (const block of page.blocks) {[m
[32m+[m[32m      const text = block.markdown || block.cleanText || block.text || ''[m
[32m+[m[32m      if (!text.trim()) continue[m
[32m+[m
[32m+[m[32m      chunks.push({[m
[32m+[m[32m        chunk_id: `c${String(idx).padStart(4, '0')}`,[m
[32m+[m[32m        block_id: block.block_id,[m
[32m+[m[32m        block_ids: [block.block_id],[m
[32m+[m[32m        type: block.type,[m
[32m+[m[32m        page: page.page,[m
[32m+[m[32m        text,[m
[32m+[m[32m        html: block.html || '',[m
[32m+[m[32m        markdown: block.markdown || '',[m
[32m+[m[32m        source: 'upstage',[m
[32m+[m[32m        useForSearch: true,[m
[32m+[m[32m      })[m
[32m+[m
[32m+[m[32m      idx++[m
[32m+[m[32m    }[m
[32m+[m[32m  }[m
[32m+[m
[32m+[m[32m  return chunks[m
[32m+[m[32m}[m
 [m
[31m-    const ext = path.extname(fp).toLowerCase();[m
[31m-    const ct = MIME[ext] || 'application/octet-stream';[m
[32m+[m[32mfunction cleanText(text) {[m
[32m+[m[32m  return String(text || '')[m
[32m+[m[32m    .replace(/\s+/g, ' ')[m
[32m+[m[32m    .replace(/(?<=[가-힣])\s+(?=[가-힣])/g, '')[m
[32m+[m[32m    .trim()[m
[32m+[m[32m}[m
 [m
[31m-    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');[m
[31m-    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');[m
[32m+[m[32mfunction stripHtml(html) {[m
[32m+[m[32m  return String(html || '').replace(/<[^>]*>/g, ' ')[m
[32m+[m[32m}[m
 [m
[31m-    res.setHeader('Content-Type', ct);[m
[31m-    res.writeHead(200);[m
[31m-    res.end(data);[m
[31m-  });[m
[32m+[m[32mfunction clamp(n, min, max) {[m
[32m+[m[32m  return Math.max(min, Math.min(max, n))[m
[32m+[m[32m}[m
 [m
[31m-}).listen(PORT, () => {[m
[31m-  console.log(`\n눈길 EyeDID Dev Server`);[m
[31m-  console.log(`http://localhost:${PORT}`);[m
[31m-  console.log(`COOP: same-origin / COEP: credentialless\n`);[m
[31m-});[m
\ No newline at end of file[m
[32m+[m[32m// ============================================================================[m
[32m+[m[32mapp.listen(PORT, () => {[m
[32m+[m[32m  console.log('\n눈길 Dev Server')[m
[32m+[m[32m  console.log(`http://localhost:${PORT}\n`)[m
[32m+[m[32m})[m
\ No newline at end of file[m
