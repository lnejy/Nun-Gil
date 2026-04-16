import { sb } from '../supabase.js'
import { deleteFile } from '../storage.js'

/**
 * 워크스페이스 내 문서 목록 조회
 * workspaceId가 null이면 워크스페이스 없는 문서만, undefined면 전체 조회
 *
 * @param {string|null|undefined} workspaceId
 * @returns {Promise<Array>}
 */
export async function getDocuments(workspaceId) {
  let query = sb
    .from('documents')
    .select('id, file_name, file_url, file_type, page_count, uploaded_at, workspace_id, converted_pdf_path')
    .order('uploaded_at', { ascending: false })

  if (workspaceId === null) {
    query = query.is('workspace_id', null)
  } else if (workspaceId !== undefined) {
    query = query.eq('workspace_id', workspaceId)
  }

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

/**
 * 최근 업로드 문서 조회 (사이드바용)
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function getRecentDocuments(limit = 5) {
  const { data, error } = await sb
    .from('documents')
    .select('id, file_name, file_type, uploaded_at, workspace_id')
    .order('uploaded_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data ?? []
}

/**
 * 문서 단건 조회
 * @param {string} id
 * @returns {Promise<Object>}
 */
export async function getDocument(id) {
  const { data, error } = await sb
    .from('documents')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

/**
 * 문서 레코드 생성 (Storage 업로드 후 호출)
 *
 * @param {{
 *   userId: string,
 *   workspaceId: string|null,
 *   fileName: string,
 *   storagePath: string,
 *   fileType: 'PDF'|'PPT',
 *   pageCount?: number
 * }} params
 * @returns {Promise<Object>}
 */
export async function createDocument({ userId, workspaceId, fileName, storagePath, fileType, pageCount = 0 }) {
  const { data, error } = await sb
    .from('documents')
    .insert({
      user_id: userId,
      workspace_id: workspaceId ?? null,
      file_name: fileName,
      file_url: storagePath,
      file_type: fileType,
      page_count: pageCount,
    })
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * PPT 변환 완료 후 converted_pdf_path 업데이트
 * @param {string} id
 * @param {string} convertedPdfPath
 * @returns {Promise<Object>}
 */
export async function updateConvertedPdfPath(id, convertedPdfPath) {
  const { data, error } = await sb
    .from('documents')
    .update({ converted_pdf_path: convertedPdfPath })
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * 문서 삭제 (Storage 파일 + DB 레코드)
 * @param {string} id
 */
export async function deleteDocument(id) {
  const doc = await getDocument(id)

  // Storage 파일 삭제
  if (doc.file_url) await deleteFile(doc.file_url)
  if (doc.converted_pdf_path) await deleteFile(doc.converted_pdf_path)

  const { error } = await sb.from('documents').delete().eq('id', id)
  if (error) throw error
}
