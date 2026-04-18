import { sb } from './supabase.js'

/**
 * 인증 가드 - 로그인 상태가 아니면 start.html로 리다이렉트
 * @returns {Promise<import('@supabase/supabase-js').Session | null>}
 */
export async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession()
  if (!session) {
    location.href = '/ui/start.html'
    return null
  }
  return session
}

/**
 * 현재 로그인 유저 + DB 프로필 반환
 * @returns {Promise<{ id, email, profile: { name, created_at } } | null>}
 */
export async function getCurrentUser() {
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null

  const { data: profile } = await sb
    .from('users')
    .select('name, created_at')
    .eq('id', user.id)
    .single()

  return { ...user, profile: profile ?? {} }
}

/**
 * 로그아웃 후 start.html로 이동
 */
export async function signOut() {
  await sb.auth.signOut()
  location.href = '/ui/start.html'
}
