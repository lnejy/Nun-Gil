/**
 * analyze-document Edge Function
 * PDF 문서를 Claude API로 분석하여 요약·마인드맵·퀴즈를 생성하고 learning_assets에 저장
 *
 * 호출 방법:
 *   POST /functions/v1/analyze-document
 *   Authorization: Bearer <user_jwt>
 *   Body: { document_id: string }
 *
 * 환경변수 (Supabase Dashboard > Functions > Secrets):
 *   Claude_API_KEY            - Anthropic API 키
 *   SUPABASE_URL              - 자동 주입
 *   SUPABASE_SERVICE_ROLE_KEY - 자동 주입
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'documents'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
      .select('id, file_url, file_type, converted_pdf_path, file_name')
      .eq('id', document_id)
      .eq('user_id', user.id)
      .single()

    if (docErr || !doc) return json({ error: 'Document not found' }, 404)

    const pdfPath = doc.file_type === 'PDF' ? doc.file_url : doc.converted_pdf_path
    if (!pdfPath) return json({ error: 'PDF not available' }, 400)

    // ── learning_assets PROCESSING으로 전환 ──────────────
    const { data: assets } = await sb
      .from('learning_assets')
      .select('id, type')
      .eq('document_id', document_id)
      .in('status', ['PENDING', 'FAILED'])

    if (!assets || assets.length === 0) return json({ error: 'No pending assets found' }, 400)

    const assetIds = assets.map((a: { id: string }) => a.id)
    await sb.from('learning_assets').update({ status: 'PROCESSING' }).in('id', assetIds)

    // ── Storage에서 PDF 다운로드 → base64 변환 ────────────
    const { data: fileData, error: dlErr } = await sb.storage
      .from(BUCKET)
      .download(pdfPath)

    if (dlErr || !fileData) {
      await sb.from('learning_assets').update({ status: 'FAILED' }).in('id', assetIds)
      return json({ error: `Storage download failed: ${dlErr?.message}` }, 500)
    }

    const uint8 = new Uint8Array(await fileData.arrayBuffer())
    let binary = ''
    for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i])
    const pdfBase64 = btoa(binary)

    // ── Claude API 호출 ───────────────────────────────────
    const apiKey = Deno.env.get('Claude_API_KEY')
    if (!apiKey) return json({ error: 'Claude_API_KEY not set' }, 500)

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
            },
            {
              type: 'text',
              text: `이 문서를 분석하여 아래 JSON 형식으로만 응답해주세요. 다른 텍스트는 포함하지 마세요.

{
  "summary": {
    "title": "문서 제목",
    "summary": "문서 전체 요약 5문장",
    "key_points": [
      { "id": "s1", "title": "핵심 포인트 제목", "description": "설명 2~3문장" },
      { "id": "s2", "title": "핵심 포인트 제목", "description": "설명 2~3문장" },
      { "id": "s3", "title": "핵심 포인트 제목", "description": "설명 2~3문장" },
      { "id": "s4", "title": "핵심 포인트 제목", "description": "설명 2~3문장" },
      { "id": "s5", "title": "핵심 포인트 제목", "description": "설명 2~3문장" }
    ]
  },
  "mindmap": {
    "name": "핵심 주제",
    "detail": "문서 전체 설명",
    "children": [
      {
        "name": "개념 1",
        "detail": "설명",
        "children": [
          { "name": "세부 개념", "detail": "설명", "children": [] }
        ]
      }
    ]
  },
  "quiz": [
    {
      "question": "문제",
      "options": ["선택지1", "선택지2", "선택지3", "선택지4"],
      "answerIndex": 0,
      "explanation": "문서 근거 기반 해설"
    }
  ]
}

조건:
- key_points 정확히 5개
- mindmap 최대 3단계, 최상위 개념 4~6개, 각 name은 15자 이내
- quiz 정확히 5문제, 선택지 4개, answerIndex는 0~3`,
            },
          ],
        }],
      }),
    })

    if (!claudeRes.ok) {
      const err = await claudeRes.json().catch(() => ({}))
      await sb.from('learning_assets').update({ status: 'FAILED' }).in('id', assetIds)
      return json({ error: 'Claude API failed', detail: err }, 500)
    }

    const claudeData = await claudeRes.json()
    const rawText = claudeData.content?.[0]?.text ?? ''

    // ── 응답 파싱 ─────────────────────────────────────────
    let parsed: { summary: string; mindmap: object; quiz: object[] }
    try {
      const match = rawText.match(/\{[\s\S]*\}/)
      parsed = JSON.parse(match ? match[0] : rawText)
    } catch {
      await sb.from('learning_assets').update({ status: 'FAILED' }).in('id', assetIds)
      return json({ error: 'Response parse failed', raw: rawText }, 500)
    }

    // ── 타입별 learning_assets 업데이트 ──────────────────
    const typeMap: Record<string, unknown> = {
      SUMMARY: parsed.summary,
      MINDMAP: parsed.mindmap,
      QUIZ:    parsed.quiz,
    }

    for (const asset of assets as { id: string; type: string }[]) {
      const content = typeMap[asset.type]
      if (content !== undefined) {
        await sb.from('learning_assets')
          .update({ status: 'DONE', content })
          .eq('id', asset.id)
      }
    }

    return json({ success: true })

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
