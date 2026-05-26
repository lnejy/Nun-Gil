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
  ? `너는 학습 도우미다. 사용자 지시를 받으면 결과물을 곧바로 완성해서 한국어 평문으로만 출력한다.

절대 하지 말 것:
- 인사말, "요청을 이해했습니다", "URL 디코딩 후", "정리하겠습니다", "분석해 드리겠습니다" 같은 서두
- 작업 계획·단계 나열·"작성 방향"·"1단계/2단계"
- 표·이모지·헤딩(#)·사용자에게 되묻기

맥락 정보가 부족하면 부족한 대로 짧게 2~3문장으로 설명하고 끝낸다. 추가 정보를 요청하지 않는다.
요청과 무관하거나 의미를 알 수 없는 입력이면, 길게 설명하지 말고 한 문장으로만 짧게 답한다.`
  : 'You are a JSON-only API for a grounded study assistant. Every output item that makes a claim about the document must include a "source_chunks" field — an array of chunk_ids referencing the provided context. If the context lacks sufficient evidence, omit that item rather than guessing. Respond with raw JSON only — no markdown, no code fences, no commentary. Output must start with { or [ and end with } or ].',
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
