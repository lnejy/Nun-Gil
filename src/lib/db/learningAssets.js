import { sb } from '../supabase.js'

const ASSET_TYPES = ['SUMMARY', 'MINDMAP', 'QUIZ']

/**
 * 문서에 대한 학습 자산 조회 (있으면 반환, 없으면 빈 배열)
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
 * 문서 업로드 시 PENDING 학습 자산 레코드 생성
 * 이미 존재하는 타입은 건너뜀 (중복 방지)
 *
 * @param {string} documentId
 * @param {string|null} sessionId
 * @returns {Promise<Array>}
 */
export async function createPendingAssets(documentId, sessionId = null) {
  const existing = await getLearningAssets(documentId)
  const existingTypes = existing.map(a => a.type)

  const toCreate = ASSET_TYPES
    .filter(type => !existingTypes.includes(type))
    .map(type => ({
      document_id: documentId,
      session_id: sessionId,
      type,
      status: 'PENDING',
    }))

  if (toCreate.length === 0) return existing

  const { data, error } = await sb
    .from('learning_assets')
    .insert(toCreate)
    .select()

  if (error) throw error
  return [...existing, ...(data ?? [])]
}

/**
 * 특정 타입의 학습 자산 상태 업데이트
 * Edge Function에서 처리 후 호출
 *
 * @param {string} assetId
 * @param {'PROCESSING'|'DONE'|'FAILED'} status
 * @param {object|null} content
 * @returns {Promise<Object>}
 */
export async function updateAssetStatus(assetId, status, content = null) {
  const updates = { status }
  if (content !== null) updates.content = content

  const { data, error } = await sb
    .from('learning_assets')
    .update(updates)
    .eq('id', assetId)
    .select()
    .single()

  if (error) throw error
  return data
}
