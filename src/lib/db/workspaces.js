import { sb } from '../supabase.js'

/**
 * 현재 유저의 워크스페이스 목록 조회
 * @returns {Promise<Array>}
 */
export async function getWorkspaces() {
  const { data, error } = await sb
    .from('workspaces')
    .select('id, title, created_at')
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}

/**
 * 워크스페이스 생성
 * @param {string} title
 * @returns {Promise<Object>}
 */
export async function createWorkspace(title) {
  const { data: { user } } = await sb.auth.getUser()

  const { data, error } = await sb
    .from('workspaces')
    .insert({ title, user_id: user.id })
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * 워크스페이스 삭제 (소속 문서도 CASCADE 삭제됨)
 * @param {string} id
 */
export async function deleteWorkspace(id) {
  const { error } = await sb.from('workspaces').delete().eq('id', id)
  if (error) throw error
}

/**
 * 워크스페이스 이름 수정
 * @param {string} id
 * @param {string} title
 * @returns {Promise<Object>}
 */
export async function updateWorkspace(id, title) {
  const { data, error } = await sb
    .from('workspaces')
    .update({ title })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}
