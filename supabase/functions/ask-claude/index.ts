/**
 * ask-claude Edge Function
 * 프론트엔드 AI 기능(요약·마인드맵·퀴즈)에서 Claude API를 안전하게 호출하는 프록시
 *
 * 호출 방법:
 *   POST /functions/v1/ask-claude
 *   Authorization: Bearer <user_jwt>
 *   Body: { prompt: string }
 *
 * 환경변수 (Supabase Dashboard > Functions > Secrets):
 *   Claude_API_KEY        - Anthropic API 키
 *   SUPABASE_URL          - 자동 주입
 *   SUPABASE_SERVICE_ROLE_KEY - 자동 주입
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
   const { prompt, encoded, prefill, mode } = await req.json()
const decodedPrompt = encoded ? decodeURIComponent(prompt) : prompt
const isTextMode = mode === 'text'

const apiKey = Deno.env.get('Claude_API_KEY')
if (!apiKey) return json({ error: 'Claude_API_KEY not set' }, 500)

const messages: any[] = [
  { role: 'user', content: decodedPrompt }
]

if (prefill) {
  messages.push({ role: 'assistant', content: prefill })
}

const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8000,
    system: isTextMode
      ? 'You are a helpful study assistant. Respond in Korean markdown format only. No JSON, no code fences wrapping the entire response.'
      : 'You are a JSON-only API for a grounded study assistant. Every output item that makes a claim about the document must include a "source_chunks" field — an array of chunk_ids (e.g., ["c0003","c0007"]) referencing the provided context. If the context lacks sufficient evidence for an item, omit that item rather than guessing. Respond with raw JSON only — no markdown, no code fences, no commentary. Output must start with { or [ and end with } or ].',
    messages,
  }),
})

const data = await claudeRes.json()

if (!claudeRes.ok) {
  return json({ error: data }, claudeRes.status)
}

// prefill 사용 시 응답 앞에 prefill 복원
if (prefill && data.content?.[0]?.text) {
  data.content[0].text = prefill + data.content[0].text
}

return json(data)

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
