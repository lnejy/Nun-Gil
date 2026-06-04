import { sb } from '../supabase.js'

/**
 * 문서에 대한 학습 자산 조회
 * @param {string} documentId
 * @returns {Promise<Array>}
 */
export async function getLearningAssets(documentId) {
  const { data, error } = await sb
    .from('learning_assets')
    .select('*')
    .eq('document_id', documentId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data ?? []
}

/**
 * 지식 자산 단건 삭제
 * @param {string} assetId
 */
export async function deleteAsset(assetId) {
  const { error } = await sb
    .from('learning_assets')
    .delete()
    .eq('id', assetId)

  if (error) throw error
}

/**
 * 특정 학습 자산 상태 업데이트
 * @param {string} assetId
 * @param {'PENDING'|'RUNNING'|'DONE'|'ERROR'} status
 * @param {object|null} content
 * @param {string|null} errorMessage
 * @returns {Promise<Object>}
 */
export async function updateAssetStatus(assetId, status, content = null, errorMessage = null) {
  const now = new Date().toISOString()

  const updates = {
    status,
    updated_at: now,
  }

  if (content !== null) {
    updates.content = content
  }

  if (errorMessage !== null) {
    updates.error_message = errorMessage
  }

  if (status === 'DONE') {
    updates.error_message = null
  }

  if (status === 'PENDING') {
    updates.requested_at = now
  }

  if (status === 'RUNNING') {
    updates.started_at = now
  }

  if (status === 'DONE' || status === 'ERROR') {
    updates.finished_at = now
  }

  const { data, error } = await sb
    .from('learning_assets')
    .update(updates)
    .eq('id', assetId)
    .select()
    .single()

  if (error) throw error
  return data
}