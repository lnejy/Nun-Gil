import { sb } from '../supabase.js'

/**
 * 문서 메모 조회
 * @param {string} userId
 * @param {string} documentId
 * @returns {Promise<string>}
 */
export async function getNote(userId, documentId) {
  const { data, error } = await sb
    .from('document_notes')
    .select('content')
    .eq('user_id', userId)
    .eq('document_id', documentId)
    .maybeSingle()

  if (error) throw error
  return data?.content ?? ''
}

/**
 * 문서 메모 저장 (없으면 insert, 있으면 update)
 * @param {string} userId
 * @param {string} documentId
 * @param {string} content
 */
export async function upsertNote(userId, documentId, content) {
  const { error } = await sb
    .from('document_notes')
    .upsert(
      { user_id: userId, document_id: documentId, content, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,document_id' }
    )

  if (error) throw error
}
