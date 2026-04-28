import { sb } from '../supabase.js'

/**
 * 학습 세션 생성 (ET 트래킹 시작 시점에 호출)
 * @param {{ userId: string, documentId: string, calibrationData?: string }} params
 * @returns {Promise<Object>} 생성된 세션
 */
export async function createStudySession({ userId, documentId, calibrationData = null }) {
  const { data, error } = await sb
    .from('study_sessions')
    .insert({
      user_id:          userId,
      document_id:      documentId,
      status:           'ONGOING',
      calibration_data: calibrationData ? { raw: calibrationData } : null,
      start_time:       new Date().toISOString(),
    })
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * 학습 세션 업데이트 (주기적 자동저장 + 종료 시 호출)
 * @param {string} id
 * @param {{
 *   durationMinutes?: number,
 *   alertCount?: number,
 *   focusTimeSeconds?: number,
 *   avgAlertResponseSeconds?: number,
 *   status?: 'ONGOING'|'COMPLETED'|'ABORTED',
 * }} params
 */
export async function updateStudySession(id, {
  durationMinutes,
  alertCount,
  focusTimeSeconds,
  avgAlertResponseSeconds,
  status,
} = {}) {
  const payload = {}
  if (durationMinutes          !== undefined) payload.duration_minutes           = durationMinutes
  if (alertCount               !== undefined) payload.alert_count                = alertCount
  if (focusTimeSeconds         !== undefined) payload.focus_time_seconds         = focusTimeSeconds
  if (avgAlertResponseSeconds  !== undefined) payload.avg_alert_response_seconds = avgAlertResponseSeconds
  if (status                   !== undefined) {
    payload.status = status
    if (status === 'COMPLETED' || status === 'ABORTED') {
      payload.end_time = new Date().toISOString()
    }
  }

  const { error } = await sb
    .from('study_sessions')
    .update(payload)
    .eq('id', id)

  if (error) throw error
}

/**
 * 세션 종료 — 최종 지표 계산 후 COMPLETED로 업데이트
 * @param {string} id
 * @param {{ startTime: number, focusTotal: number, alertCount: number, alertTimes: number[] }} metrics
 */
export async function completeStudySession(id, { startTime, focusTotal, alertCount, alertTimes, focusStart }) {
  const now      = Date.now()
  const T        = (now - startTime) / 1000                          // 총 측정 시간 (초)
  const F        = focusTotal + (focusStart ? (now - focusStart) / 1000 : 0)  // 마지막 집중 구간 포함
  const R        = alertTimes.length ? alertTimes.reduce((a, b) => a + b, 0) / alertTimes.length : 0

  await updateStudySession(id, {
    durationMinutes:         T / 60,
    alertCount,
    focusTimeSeconds:        F,
    avgAlertResponseSeconds: R,
    status:                  'COMPLETED',
  })
}

/**
 * 세션 강제 종료 (비정상 이탈)
 * @param {string} id
 * @param {{ startTime: number, focusTotal: number, alertCount: number, alertTimes: number[], focusStart: number }} metrics
 */
export async function abortStudySession(id, metrics) {
  try {
    await completeStudySession(id, { ...metrics, status: undefined })
    await updateStudySession(id, { status: 'ABORTED' })
  } catch (e) {
    console.warn('세션 ABORTED 저장 실패:', e.message)
  }
}

/**
 * 사용자의 완료된 세션 목록 조회
 * @param {string} userId
 * @param {number} limit
 */
export async function getCompletedSessions(userId, limit = 50) {
  const { data, error } = await sb
    .from('study_sessions')
    .select('id, document_id, start_time, end_time, duration_minutes, alert_count, focus_time_seconds, avg_alert_response_seconds, total_focus_score')
    .eq('user_id', userId)
    .eq('status', 'COMPLETED')
    .order('start_time', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data ?? []
}
