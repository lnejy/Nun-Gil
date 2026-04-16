/**
 * convert-ppt Edge Function
 * PPT/PPTX 파일을 PDF로 변환 후 Storage에 저장, documents 테이블 업데이트
 *
 * 호출 방법:
 *   POST /functions/v1/convert-ppt
 *   Authorization: Bearer <user_jwt>
 *   Body: { document_id: string }
 *
 * 변환 흐름:
 *   1. document_id로 DB에서 file_url(storage path) 조회
 *   2. Storage에서 PPT 파일 다운로드 → ArrayBuffer
 *   3. CloudConvert API로 PDF 변환 요청 (무료 25회/일)
 *   4. 변환된 PDF를 Storage {userId}/{docId}_converted.pdf 에 업로드
 *   5. documents.converted_pdf_path 업데이트
 *
 * 환경변수 (Supabase Dashboard > Functions > Secrets):
 *   CLOUDCONVERT_API_KEY  - https://cloudconvert.com/dashboard/api/v2/keys
 *   SUPABASE_URL          - 자동 주입
 *   SUPABASE_SERVICE_ROLE_KEY - 자동 주입
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'documents'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    })
  }

  try {
    // ── 인증 ─────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authErr } = await sb.auth.getUser()
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    // ── 요청 파싱 ─────────────────────────────────────────
    const { document_id } = await req.json()
    if (!document_id) return json({ error: 'document_id required' }, 400)

    // ── 문서 조회 ─────────────────────────────────────────
    const { data: doc, error: docErr } = await sb
      .from('documents')
      .select('id, file_url, file_type, user_id')
      .eq('id', document_id)
      .eq('user_id', user.id)
      .single()

    if (docErr || !doc) return json({ error: 'Document not found' }, 404)
    if (doc.file_type !== 'PPT') return json({ error: 'Not a PPT file' }, 400)
    if (!doc.file_url) return json({ error: 'No file_url' }, 400)

    // ── Storage에서 PPT 다운로드 ──────────────────────────
    const { data: fileData, error: dlErr } = await sb.storage
      .from(BUCKET)
      .download(doc.file_url)

    if (dlErr || !fileData) return json({ error: `Storage download failed: ${dlErr?.message}` }, 500)

    const pptBuffer = await fileData.arrayBuffer()

    // ── CloudConvert로 PDF 변환 ───────────────────────────
    const apiKey = Deno.env.get('CLOUDCONVERT_API_KEY')
    if (!apiKey) return json({ error: 'CLOUDCONVERT_API_KEY not set' }, 500)

    // 1) Job 생성
    const jobRes = await fetch('https://api.cloudconvert.com/v2/jobs', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tasks: {
          'upload-ppt': { operation: 'import/upload' },
          'convert-to-pdf': {
            operation: 'convert',
            input: 'upload-ppt',
            output_format: 'pdf',
          },
          'export-pdf': {
            operation: 'export/url',
            input: 'convert-to-pdf',
          },
        },
      }),
    })
    const job = await jobRes.json()
    if (!jobRes.ok) return json({ error: 'CloudConvert job create failed', detail: job }, 500)

    // 2) PPT 업로드 to CloudConvert
    const uploadTask = job.data.tasks.find((t: { operation: string }) => t.operation === 'import/upload')
    const uploadForm = uploadTask.result.form
    const formData   = new FormData()
    Object.entries(uploadForm.parameters as Record<string, string>).forEach(([k, v]) => formData.append(k, v))
    formData.append('file', new Blob([pptBuffer]), doc.file_url.split('/').pop())

    const uploadRes = await fetch(uploadForm.url, { method: 'POST', body: formData })
    if (!uploadRes.ok) return json({ error: 'CloudConvert upload failed' }, 500)

    // 3) Job 완료 대기 (polling, 최대 60초)
    let exportUrl: string | null = null
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000))
      const statusRes = await fetch(`https://api.cloudconvert.com/v2/jobs/${job.data.id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      })
      const status = await statusRes.json()
      const exportTask = status.data.tasks.find((t: { operation: string }) => t.operation === 'export/url')
      if (exportTask?.status === 'finished') {
        exportUrl = exportTask.result.files[0].url
        break
      }
      if (status.data.status === 'error') {
        return json({ error: 'Conversion failed' }, 500)
      }
    }
    if (!exportUrl) return json({ error: 'Conversion timeout' }, 500)

    // 4) 변환된 PDF 다운로드
    const pdfRes    = await fetch(exportUrl)
    const pdfBuffer = await pdfRes.arrayBuffer()

    // 5) Storage에 변환된 PDF 업로드
    const ext             = doc.file_url.split('.').pop()
    const convertedPath   = doc.file_url.replace(`.${ext}`, '_converted.pdf')

    const { error: upErr } = await sb.storage
      .from(BUCKET)
      .upload(convertedPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      })
    if (upErr) return json({ error: `PDF upload failed: ${upErr.message}` }, 500)

    // 6) DB 업데이트
    const { error: updateErr } = await sb
      .from('documents')
      .update({ converted_pdf_path: convertedPath })
      .eq('id', document_id)

    if (updateErr) return json({ error: `DB update failed: ${updateErr.message}` }, 500)

    return json({ success: true, converted_pdf_path: convertedPath })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
