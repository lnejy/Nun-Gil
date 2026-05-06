// ui/ai/퀴즈.js
import {
  AI_STATE,
  askClaudeJson,
  decideOutputRange,  // ← 추가
  escapeHtml,
  getAiCache,
  getCanvas,
  getChunks,
  getConcepts,
  setAiCache,
  setAiMode,
  showAiLoading,
  sourceText,
} from "./common.js";

import { createQuizPrompt } from "./prompt.js";

export async function loadQuiz({ shouldRender = () => true } = {}) {
  const cache = getAiCache();

  if (cache.quiz) {
    if (shouldRender()) renderQuiz(cache.quiz);
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

  if (shouldRender()) renderQuiz(quiz);
}

function renderQuiz(quiz) {
  const container = getCanvas();
  setAiMode();

  container.innerHTML = `
    <div class="ai-page">
      <h1 class="ai-title">퀴즈</h1>

      ${(quiz || []).map((q, idx) => `
        <div class="ai-result-card">
          <h3>Q${idx + 1}. ${escapeHtml(q.question)}</h3>

          <div class="ai-choice-list">
            ${(q.choices || []).map((choice) => `
              <button class="ai-choice" data-answer="${escapeHtml(q.answer)}">
                ${escapeHtml(choice)}
              </button>
            `).join("")}
          </div>

          <div class="ai-quiz-answer">
            <strong>정답:</strong> ${escapeHtml(q.answer)}
          </div>
          <p>${escapeHtml(q.explanation)}</p>
          <div class="ai-source">${escapeHtml(sourceText(q.source_chunks))}</div>
        </div>
      `).join("")}
    </div>
  `;

  container.querySelectorAll(".ai-choice").forEach((btn) => {
    btn.addEventListener("click", () => {
      const answer = btn.dataset.answer;
      const isCorrect = btn.textContent.trim() === answer;
      btn.classList.add(isCorrect ? "correct" : "wrong");
    });
  });
}
