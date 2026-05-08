// ui/ai/퀴즈.js
import {
  AI_STATE,
  askClaudeJson,
  decideOutputRange,
  escapeHtml,
  getAiCache,
  getCanvas,
  getChunks,
  getConcepts,
  loadAssetFromDb,
  saveAssetToDb,
  setAiCache,
  setAiMode,
  showAiLoading,
  sourceText,
} from "./common.js";

import { sb } from '/src/lib/supabase.js';
import { createQuizPrompt } from "./prompt.js";

// ── 퀴즈 상태 ─────────────────────────────────────────
let state = {
  quiz: [],          // Claude가 생성한 문제 배열
  selected: [],      // 사용자 선택 인덱스 (null = 미선택)
  submitted: false,  // 제출 여부
  pastAttempts: [],   // 이전 기록
};

// ── 퀴즈 로드 (3단 캐시) ───────────────────────────────
export async function loadQuiz({ shouldRender = () => true } = {}) {
  const cache = getAiCache();
  if (cache.quiz) {
    if (shouldRender()) startQuiz(cache.quiz);
    return;
  }

  if (shouldRender()) showAiLoading("저장된 퀴즈 확인 중");
  const dbAsset = await loadAssetFromDb('QUIZ');
  if (dbAsset) {
    setAiCache({ quiz: dbAsset });
    if (shouldRender()) startQuiz(dbAsset);
    return;
  }

  if (shouldRender()) showAiLoading("퀴즈 생성 중");
  await getChunks();
  const concepts = await getConcepts({ topK: 8, candidateK: 12 });

  if (shouldRender()) showAiLoading("퀴즈 생성 중");
  const range = decideOutputRange(AI_STATE.pageCount, "quiz");
  const prompt = createQuizPrompt({
    title: AI_STATE.docTitle,
    context: JSON.stringify(concepts, null, 2),
    range,
  });

  const quiz = await askClaudeJson(prompt, "array");
  setAiCache({ quiz });
  saveAssetToDb('QUIZ', quiz);

  if (shouldRender()) startQuiz(quiz);
}

// ── 퀴즈 시작 (상태 초기화) ────────────────────────────
function startQuiz(quiz) {
  state = {
    quiz: quiz || [],
    selected: Array(quiz?.length || 0).fill(null),
    submitted: false,
    pastAttempts: [],
  };
  render();
}

// ── 메인 렌더 ──────────────────────────────────────────
function render() {
  const container = getCanvas();
  setAiMode();

  const { quiz, selected, submitted } = state;
  const total = quiz.length;

  if (!total) {
    container.innerHTML = `<div class="ai-page"><p class="ai-empty">퀴즈를 생성하지 못했습니다.</p></div>`;
    return;
  }

  const answeredCount = selected.filter(s => s !== null).length;
  const correctCount = submitted
    ? quiz.filter((q, i) => isCorrectAt(i)).length
    : 0;

  container.innerHTML = `
    <div class="ai-page">
      <div class="quiz-header">
        <h1 class="ai-title">퀴즈</h1>
        <div class="quiz-header-actions">
          <button class="quiz-history-btn" type="button">이전 기록</button>
        </div>
      </div>

      ${submitted ? `
        <div class="quiz-result-banner">
          <span class="quiz-result-score">${correctCount} / ${total}</span>
          <span class="quiz-result-label">점수 ${Math.round((correctCount / total) * 100)}점</span>
        </div>
      ` : `
        <div class="quiz-progress">
          <span>${answeredCount} / ${total} 선택됨</span>
        </div>
      `}

      ${quiz.map((q, idx) => renderQuestion(q, idx)).join("")}

      <div class="quiz-bottom-actions">
        ${submitted ? `
          <button class="quiz-btn quiz-btn-primary quiz-retry-btn" type="button">다시 풀기</button>
        ` : `
          <button class="quiz-btn quiz-btn-primary quiz-submit-btn" type="button"
            ${answeredCount < total ? 'disabled' : ''}>
            제출하기 (${answeredCount}/${total})
          </button>
        `}
      </div>
    </div>
  `;

  bindEvents(container);
}

// ── 개별 문항 렌더 ─────────────────────────────────────
function renderQuestion(q, idx) {
  const { selected, submitted } = state;
  const choices = q.choices || [];
  const sel = selected[idx];
  const correct = submitted ? isCorrectAt(idx) : null;

  // 정답 인덱스 찾기
  const correctIdx = choices.findIndex(c => c.trim() === (q.answer || "").trim());

  return `
    <div class="ai-result-card quiz-card ${submitted ? (correct ? 'quiz-correct' : 'quiz-wrong') : ''}">
      <div class="quiz-q-header">
        <span class="quiz-q-num">Q${idx + 1}</span>
        ${submitted ? `<span class="quiz-q-badge ${correct ? 'correct' : 'wrong'}">${correct ? '정답' : '오답'}</span>` : ''}
      </div>
      <h3 class="quiz-q-text">${escapeHtml(q.question)}</h3>

      <div class="ai-choice-list">
        ${choices.map((choice, ci) => {
          let cls = 'ai-choice';
          if (sel === ci) cls += ' selected';
          if (submitted) {
            if (ci === correctIdx) cls += ' correct';
            else if (ci === sel && ci !== correctIdx) cls += ' wrong';
            cls += ' disabled';
          }
          return `
            <button class="${cls}" type="button"
              data-q="${idx}" data-c="${ci}" ${submitted ? 'disabled' : ''}>
              ${submitted && ci === correctIdx ? '✓ ' : ''}${submitted && ci === sel && ci !== correctIdx ? '✕ ' : ''}${escapeHtml(choice)}
            </button>`;
        }).join("")}
      </div>

      ${submitted ? `
        <div class="quiz-explain">
          <div class="quiz-explain-row">
            <strong>정답:</strong> ${escapeHtml(q.answer)}
          </div>
          <div class="quiz-explain-row">
            <strong>해설:</strong> ${escapeHtml(q.explanation)}
          </div>
          ${q.source_chunks?.length ? `
            <div class="quiz-explain-row quiz-source">
              ${escapeHtml(sourceText(q.source_chunks))}
            </div>
          ` : ''}
        </div>
      ` : ''}
    </div>
  `;
}

// ── 이벤트 바인딩 ──────────────────────────────────────
function bindEvents(container) {
  // 선택지 클릭
  container.querySelectorAll(".ai-choice:not(.disabled)").forEach(btn => {
    btn.addEventListener("click", () => {
      const qi = parseInt(btn.dataset.q);
      const ci = parseInt(btn.dataset.c);
      state.selected[qi] = ci;
      render();
    });
  });

  // 제출
  const submitBtn = container.querySelector(".quiz-submit-btn");
  if (submitBtn) {
    submitBtn.addEventListener("click", () => {
      if (state.selected.some(s => s === null)) {
        const go = confirm("아직 선택하지 않은 문제가 있습니다. 그래도 제출하시겠습니까?");
        if (!go) return;
      }
      state.submitted = true;
      render();
      saveAttemptToDb();
    });
  }

  // 다시 풀기
  const retryBtn = container.querySelector(".quiz-retry-btn");
  if (retryBtn) {
    retryBtn.addEventListener("click", () => startQuiz(state.quiz));
  }

  // 이전 기록
  const historyBtn = container.querySelector(".quiz-history-btn");
  if (historyBtn) {
    historyBtn.addEventListener("click", () => showPastAttempts());
  }
}

// ── 정답 판별 ──────────────────────────────────────────
function isCorrectAt(idx) {
  const q = state.quiz[idx];
  const sel = state.selected[idx];
  if (sel === null || sel === undefined) return false;
  const choices = q.choices || [];
  return (choices[sel] || "").trim() === (q.answer || "").trim();
}

// ── DB 저장 ────────────────────────────────────────────
async function saveAttemptToDb() {
  const docId = AI_STATE.docId;
  if (!sb || !docId || docId === 'demo') return;

  try {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;

    // learning_assets에서 QUIZ asset_id 가져오기
    const { data: asset } = await sb
      .from('learning_assets')
      .select('id')
      .eq('document_id', docId)
      .eq('type', 'QUIZ')
      .eq('status', 'DONE')
      .maybeSingle();

    if (!asset) {
      console.warn('퀴즈 자산을 찾을 수 없어 기록을 저장하지 못했습니다.');
      return;
    }

    const { quiz, selected } = state;
    const total = quiz.length;
    const correct = quiz.filter((_, i) => isCorrectAt(i)).length;

    // 개별 답안 기록
    const answers = quiz.map((q, i) => ({
      question: q.question,
      choices: q.choices,
      selected: selected[i] !== null ? (q.choices || [])[selected[i]] : null,
      answer: q.answer,
      isCorrect: isCorrectAt(i),
      explanation: q.explanation,
    }));

    await sb.from('quiz_attempts').insert({
      user_id: user.id,
      document_id: docId,
      asset_id: asset.id,
      session_id: window._currentSessionId || null,
      total_questions: total,
      correct_count: correct,
      score: Math.round((correct / total) * 100),
      answers,
    });

    console.log('퀴즈 결과 저장 완료');
  } catch (e) {
    console.warn('퀴즈 결과 저장 실패:', e.message);
  }
}

// ── 이전 기록 보기 ─────────────────────────────────────
async function showPastAttempts() {
  const container = getCanvas();
  const docId = AI_STATE.docId;
  if (!sb || !docId || docId === 'demo') {
    alert('이전 기록을 불러올 수 없습니다.');
    return;
  }

  setAiMode();
  container.innerHTML = `
    <div class="ai-page">
      <div class="ai-loading">
        <div class="ai-spinner"></div>
        <strong>이전 기록 불러오는 중</strong>
      </div>
    </div>
  `;

  try {
    const { data: attempts, error } = await sb
      .from('quiz_attempts')
      .select('*')
      .eq('document_id', docId)
      .order('attempted_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    renderPastAttempts(attempts || []);
  } catch (e) {
    container.innerHTML = `
      <div class="ai-page">
        <p class="ai-empty">기록 로드 실패: ${escapeHtml(e.message)}</p>
      </div>
    `;
  }
}

function renderPastAttempts(attempts) {
  const container = getCanvas();

  container.innerHTML = `
    <div class="ai-page">
      <div class="quiz-header">
        <h1 class="ai-title">퀴즈 이전 기록</h1>
        <div class="quiz-header-actions">
          <button class="quiz-btn quiz-back-btn" type="button">퀴즈로 돌아가기</button>
        </div>
      </div>

      ${attempts.length === 0 ? `
        <p class="ai-empty">아직 풀이 기록이 없습니다.</p>
      ` : attempts.map((a, i) => `
        <div class="ai-result-card quiz-attempt-card" data-attempt-idx="${i}">
          <div class="quiz-attempt-header">
            <span class="quiz-attempt-date">${formatDate(a.attempted_at)}</span>
            <span class="quiz-attempt-score-badge">${a.score}점</span>
          </div>
          <div class="quiz-attempt-summary">
            ${a.correct_count} / ${a.total_questions} 정답
          </div>
          <button class="quiz-btn quiz-btn-outline quiz-detail-btn" type="button" data-attempt-idx="${i}">
            상세 보기
          </button>
        </div>
      `).join("")}
    </div>
  `;

  // 돌아가기
  container.querySelector(".quiz-back-btn")?.addEventListener("click", () => {
    render();
  });

  // 상세 보기
  container.querySelectorAll(".quiz-detail-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.attemptIdx);
      renderAttemptDetail(attempts[idx], attempts);
    });
  });
}

function renderAttemptDetail(attempt, allAttempts) {
  const container = getCanvas();
  const answers = attempt.answers || [];

  container.innerHTML = `
    <div class="ai-page">
      <div class="quiz-header">
        <h1 class="ai-title">${formatDate(attempt.attempted_at)} 풀이 결과</h1>
        <div class="quiz-header-actions">
          <button class="quiz-btn quiz-back-list-btn" type="button">목록으로</button>
        </div>
      </div>

      <div class="quiz-result-banner">
        <span class="quiz-result-score">${attempt.correct_count} / ${attempt.total_questions}</span>
        <span class="quiz-result-label">${attempt.score}점</span>
      </div>

      ${answers.map((a, idx) => `
        <div class="ai-result-card quiz-card ${a.isCorrect ? 'quiz-correct' : 'quiz-wrong'}">
          <div class="quiz-q-header">
            <span class="quiz-q-num">Q${idx + 1}</span>
            <span class="quiz-q-badge ${a.isCorrect ? 'correct' : 'wrong'}">${a.isCorrect ? '정답' : '오답'}</span>
          </div>
          <h3 class="quiz-q-text">${escapeHtml(a.question)}</h3>

          <div class="ai-choice-list">
            ${(a.choices || []).map(choice => {
              let cls = 'ai-choice disabled';
              const isAnswer = choice.trim() === (a.answer || "").trim();
              const isSelected = choice.trim() === (a.selected || "").trim();
              if (isAnswer) cls += ' correct';
              if (isSelected && !isAnswer) cls += ' wrong selected';
              if (isSelected && isAnswer) cls += ' selected';
              return `<button class="${cls}" disabled>
                ${isAnswer ? '✓ ' : ''}${isSelected && !isAnswer ? '✕ ' : ''}${escapeHtml(choice)}
              </button>`;
            }).join("")}
          </div>

          <div class="quiz-explain">
            <div class="quiz-explain-row"><strong>내 답:</strong> ${escapeHtml(a.selected || '미선택')}</div>
            <div class="quiz-explain-row"><strong>정답:</strong> ${escapeHtml(a.answer)}</div>
            <div class="quiz-explain-row"><strong>해설:</strong> ${escapeHtml(a.explanation || '')}</div>
          </div>
        </div>
      `).join("")}
    </div>
  `;

  container.querySelector(".quiz-back-list-btn")?.addEventListener("click", () => {
    renderPastAttempts(allAttempts);
  });
}

// ── 날짜 포맷 ──────────────────────────────────────────
function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}.${dd} ${hh}:${mi}`;
}
