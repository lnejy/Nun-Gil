// ui/ai/퀴즈.js
import {
  AI_STATE,
  askClaudeJson,
  buildContext,
  escapeHtml,
  getAiCache,
  getCanvas,
  getChunks,
  setAiCache,
  setAiMode,
  showAiLoading,
  sourceText,
} from "./common.js";

import { createQuizPrompt } from "./prompt.js";

export async function loadQuiz() {
  const cache = getAiCache();

  if (cache.quiz) {
    renderQuiz(cache.quiz);
    return;
  }

  showAiLoading("퀴즈 생성 중");

  const chunks = await getChunks();
  const prompt = createQuizPrompt({
    title: AI_STATE.docTitle,
    context: buildContext(chunks),
  });

  const quiz = await askClaudeJson(prompt);
  setAiCache({ quiz });
  renderQuiz(quiz);
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
