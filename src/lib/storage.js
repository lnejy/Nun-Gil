import { sb } from './supabase.js'

const BUCKET = 'documents'

/**
 * 허용 MIME 타입
 */
const ALLOWED_TYPES = {
  'application/pdf': 'PDF',
  'application/vnd.ms-powerpoint': 'PPT',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPT',
}

/**
 * 파일 확장자로 file_type 판별
 */
export function resolveFileType(file) {
  const mime = file.type
  if (ALLOWED_TYPES[mime]) return ALLOWED_TYPES[mime]

  // MIME이 정확하지 않을 때 확장자로 판별
  const ext = file.name.split('.').pop().toLowerCase()
  if (ext === 'pdf') return 'PDF'
  if (ext === 'ppt' || ext === 'pptx') return 'PPT'
  return null
}

/**
 * Supabase Storage에 파일 업로드
 * 경로: {userId}/{uuid}.{ext}
 *
 * @param {File} file
 * @param {string} userId  - auth.users.id
 * @returns {Promise<{ storagePath: string, fileType: 'PDF'|'PPT' }>}
 */
export async function uploadDocument(file, userId) {
  const fileType = resolveFileType(file)
  if (!fileType) throw new Error('PDF 또는 PPT/PPTX 파일만 업로드할 수 있습니다.')

  const ext = file.name.split('.').pop().toLowerCase()
  const uuid = crypto.randomUUID()
  const storagePath = `${userId}/${uuid}.${ext}`

  const { error } = await sb.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false,
    })

  if (error) throw error
  return { storagePath, fileType }
}

/**
 * 서명된 임시 URL 발급
 *
 * @param {string} storagePath
 * @param {object|number} [opts]  - { bucket, expiresIn } 또는 expiresIn(초)
 *                                  하위호환: 두 번째 인자가 number면 expiresIn으로 처리
 * @returns {Promise<string>}
 */
export async function getSignedUrl(storagePath, opts = {}) {
  const expiresIn = typeof opts === 'number' ? opts : (opts.expiresIn ?? 3600)
  const bucket = typeof opts === 'object' ? (opts.bucket ?? BUCKET) : BUCKET

  const { data, error } = await sb.storage
    .from(bucket)
    .createSignedUrl(storagePath, expiresIn)

  if (error) throw error
  return data.signedUrl
}

/**
 * layout-json 버킷의 layout.json signed URL
 *
 * @param {string} layoutPath  - 예: '{sha256}/layout.json'
 * @returns {Promise<string>}
 */
export async function getLayoutSignedUrl(layoutPath) {
  return getSignedUrl(layoutPath, { bucket: 'layout-json' })
}
/**
 * Storage에서 파일 삭제
 * @param {string} storagePath
 */
export async function deleteFile(storagePath) {
  const { error } = await sb.storage.from(BUCKET).remove([storagePath])
  if (error) throw error
}
