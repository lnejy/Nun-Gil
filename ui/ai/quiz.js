import {
  AI_STATE,
  askClaudeJson,
  buildContext,
  escapeHtml,
  getAiCache,
  getCanvas,
  getChunks,
  loadAssetFromDb,
  saveAssetToDb,
  setAiCache,
  setAiMode,
  showAiLoading,
  sourceText,
} from "./common.js";

import { sb } from '/src/lib/supabase.js';
import { createQuizPrompt } from "./prompt.js";

let quizState = {
  list: [],
  currentIndex: 0,
  answers: [],
  bookmarks: [],
  fullscreen: false,
  showResult: false,
};

export async function loadQuiz() {
  const cache = getAiCache();

// ── 퀴즈 로드 (3단 캐시: sessionStorage → Supabase DB → Claude API) ──
export async function loadQuiz({ shouldRender = () => true } = {}) {
  // 1차: sessionStorage 캐시
  const cache = getAiCache();
  if (cache.quiz) {
    renderQuiz(cache.quiz);
    return;
  }


  // 2차: Supabase DB
  if (shouldRender()) showAiLoading("저장된 퀴즈 확인 중");
  const dbAsset = await loadAssetFromDb('QUIZ');
  if (dbAsset) {
    setAiCache({ quiz: dbAsset });
    if (shouldRender()) renderQuiz(dbAsset);
    return;
  }

  // 3차: Claude API 생성
  if (shouldRender()) showAiLoading("퀴즈 생성 중");

  const chunks = await getChunks();
  const prompt = createQuizPrompt({
    title: AI_STATE.docTitle,
    context: buildContext(chunks),
  });


  const quiz = await askClaudeJson(prompt, "array");

  setAiCache({ quiz });
  saveAssetToDb('QUIZ', quiz);

  setAiCache({ quiz });
  saveAssetToDb('QUIZ', quiz);
  renderQuiz(quiz);
}

function normalizeQuiz(quiz) {
  return (quiz || []).map((q) => {
    const options = q.options || q.choices || [];

    let answerIndexes = [];

    if (Array.isArray(q.answerIndexes)) {
      answerIndexes = q.answerIndexes;
    } else if (typeof q.answerIndex === "number") {
      answerIndexes = [q.answerIndex];
    } else if (Array.isArray(q.answers)) {
      answerIndexes = q.answers
        .map((answer) =>
          options.findIndex(
            (option) => String(option).trim() === String(answer).trim()
          )
        )
        .filter((index) => index >= 0);
    } else if (q.answer) {
      const index = options.findIndex(
        (option) => String(option).trim() === String(q.answer).trim()
      );
      if (index >= 0) answerIndexes = [index];
    }

    if (!answerIndexes.length) {
      answerIndexes = [0];
    }

    answerIndexes = [...new Set(answerIndexes)]
      .filter((index) => index >= 0 && index < options.length)
      .slice(0, 2);

    let questionText = String(q.question || "");

    // 문제 문장 안의 선택 안내 문구 제거
    questionText = questionText
      .replace(/\(?\s*하나만\s*고르시오\s*\)?\.?/g, "")
      .replace(/\(?\s*한\s*개만\s*고르시오\s*\)?\.?/g, "")
      .replace(/\(?\s*두\s*개\s*고르시오\s*\)?\.?/g, "")
      .replace(/\(?\s*두\s*개를\s*고르시오\s*\)?\.?/g, "")
      .replace(/\(?\s*모두\s*고르시오\s*\)?\.?/g, "")
      .replace(/\s+/g, " ")
      .replace(/\s+([?.!])/g, "$1")
      .trim();

    // 하나만 고르시오는 문제에 표시하지 않음
    // 정답이 2개 이상이면 문제 문장에만 확실히 표시
    if (answerIndexes.length >= 2) {
      questionText = `${questionText} 두 개 고르시오`;
    }

    return {
  type: "",
  question: questionText,
  options,
  answerIndexes,
  answer: answerIndexes.map((index) => options[index]).join(", "),
  explanation: q.explanation || "",
  optionExplanations:
    q.optionExplanations ||
    q.option_explanations ||
    q.choiceExplanations ||
    q.choice_explanations ||
    [],
  source_chunks: q.source_chunks || [],
};
  });
}
  
function getQuizTitle() {
  const rawTitle = AI_STATE.docTitle || window._docTitle || "문서";

  const cleanTitle = String(rawTitle)
    // 확장자 제거
    .replace(/\.(pdf|ppt|pptx)$/i, "")
    .trim();

  return `${cleanTitle}`;
}

function formatOptionLabel(index, option) {
  return `${index + 1}. ${option}`;
}

function getAnswerText(quiz, indexes = quiz.answerIndexes) {
  if (!indexes?.length) return "미선택";

  return indexes
    .map((index) => formatOptionLabel(index, quiz.options[index]))
    .join(", ");
}

function getOptionExplanation(quiz, optionIndex) {
  const explanations =
    quiz.optionExplanations ||
    quiz.option_explanations ||
    quiz.choiceExplanations ||
    quiz.choice_explanations ||
    [];

  return (
    explanations[optionIndex] ||
    "이 선택지에 대한 개별 해설은 생성되지 않았습니다."
  );
}

function getAnswerNumberText(quiz) {
  return quiz.answerIndexes
    .map((index) => `${index + 1}번`)
    .join(", ");
}

function renderQuiz(quiz) {
  injectQuizStyle();

  const container = getCanvas();

  // 기존 AI 문서 기반 퀴즈 생성 기능 유지
  setAiMode();

  // 기본 퀴즈 모드: viewer 사이드바/상단바 유지
  document.body.classList.remove("ai-view-mode");
  document.body.classList.remove("quiz-fullscreen-mode");
  document.body.classList.add("quiz-inline-mode");

  const normalized = normalizeQuiz(quiz);

  quizState = {
    list: normalized,
    currentIndex: 0,
    answers: Array(normalized.length).fill(null),
    bookmarks: Array(normalized.length).fill(false),
    fullscreen: false,
    showResult: false,
  };

  renderQuizLayout(container);
}

function renderQuizLayout(container) {
  const total = quizState.list.length;

  if (!total) {
    container.innerHTML = `
      <div class="ng-quiz-empty">
        퀴즈를 생성하지 못했습니다.<br>
        문서 내용을 확인한 뒤 다시 시도해 주세요.
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <section class="ng-quiz">
      <div class="ng-quiz-shell ${quizState.fullscreen ? "fullscreen" : ""}">
        <aside class="ng-quiz-index-panel">
          <div class="ng-quiz-index-card">
            <p class="ng-quiz-index-title">문제 번호</p>
            <div id="ngQuizIndexList" class="ng-quiz-index-list"></div>
          </div>
        </aside>

        <div class="ng-quiz-main">
          <div class="ng-quiz-panel">
            <div class="ng-quiz-topbar">
              <div>
                <div class="ng-quiz-badge">${total}문제</div>
                <h1 class="ng-quiz-title">${escapeHtml(getQuizTitle())}</h1>
                <p class="ng-quiz-desc">
                  문서 내용을 바탕으로 생성된 문제를 한 문제씩 풀어보세요.
                </p>
              </div>

              <div class="ng-quiz-actions">
                <button
                  id="ngQuizFullscreenBtn"
                  class="ng-quiz-icon-btn ${quizState.fullscreen ? "active" : ""}"
                  type="button"
                  title="전체화면"
                >
                  ${getFullscreenIcon()}
                </button>

                <button id="ngQuizOriginalBtn" class="ng-quiz-soft-btn" type="button">
                  원본으로
                </button>
              </div>
            </div>

            <div class="ng-quiz-progress-card">
              <div class="ng-quiz-progress-info">
                <p id="ngQuizProgressText" class="ng-quiz-progress-text"></p>
                <p id="ngQuizProgressPercent" class="ng-quiz-progress-percent"></p>
              </div>
              <div class="ng-quiz-progress-bar">
                <div id="ngQuizProgressFill" class="ng-quiz-progress-fill"></div>
              </div>
            </div>

            <article
              id="ngQuizQuestionCard"
              class="ng-quiz-question-card ${quizState.showResult ? "hidden" : ""}"
            ></article>

            <section
              id="ngQuizResultView"
              class="ng-quiz-result-card ${quizState.showResult ? "" : "hidden"}"
            >
              <h2>퀴즈 결과</h2>
              <p id="ngQuizScore" class="ng-quiz-score"></p>
              <p id="ngQuizScoreDesc" class="ng-quiz-score-desc"></p>

              <div class="ng-quiz-result-actions">
                <button id="ngQuizRestartBtn" class="ng-quiz-primary-btn" type="button">
                  다시 풀기
                </button>
                <button id="ngQuizBackToQuestionBtn" class="ng-quiz-soft-btn" type="button">
                  문제로 돌아가기
                </button>
              </div>

              <div id="ngQuizReviewList" class="ng-quiz-review-list"></div>
            </section>
          </div>
        </div>
      </div>
    </section>
  `;

  bindBaseEvents();
  renderIndexList();
  updateProgress();

  if (quizState.showResult) {
    renderResult();
  } else {
    renderQuestion();
  }
}

function getFullscreenIcon() {
  if (quizState.fullscreen) {
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M8 3v5H3" />
        <path d="M16 3v5h5" />
        <path d="M8 21v-5H3" />
        <path d="M16 21v-5h5" />
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M8 3H3v5" />
      <path d="M16 3h5v5" />
      <path d="M8 21H3v-5" />
      <path d="M16 21h5v-5" />
    </svg>
  `;
}

function bindBaseEvents() {
  document
    .getElementById("ngQuizFullscreenBtn")
    ?.addEventListener("click", toggleFullscreen);

  document
    .getElementById("ngQuizOriginalBtn")
    ?.addEventListener("click", showOriginalDocument);

  document
    .getElementById("ngQuizRestartBtn")
    ?.addEventListener("click", restartQuiz);

  document
    .getElementById("ngQuizBackToQuestionBtn")
    ?.addEventListener("click", () => {
      quizState.showResult = false;
      renderQuizLayout(getCanvas());
    });
}

function renderIndexList() {
  const list = document.getElementById("ngQuizIndexList");
  if (!list) return;

  list.innerHTML = "";

  quizState.list.forEach((_, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ng-quiz-number-btn";
    button.textContent = index + 1;

    if (index === quizState.currentIndex) button.classList.add("current");
    if (quizState.answers[index]?.isSubmitted) button.classList.add("done");
    if (quizState.bookmarks[index]) button.classList.add("bookmarked");

    button.addEventListener("click", () => {
      quizState.currentIndex = index;
      quizState.showResult = false;
      renderQuizLayout(getCanvas());
    });

    list.appendChild(button);
  });
}

function renderQuestion() {
  const card = document.getElementById("ngQuizQuestionCard");
  if (!card) return;

  const quiz = quizState.list[quizState.currentIndex];
  const answerData = quizState.answers[quizState.currentIndex];
  const isSubmitted = answerData?.isSubmitted;

  card.innerHTML = `
    <div class="ng-quiz-question-top">
      <div class="ng-quiz-question-meta">
        <span class="ng-quiz-question-number">Q${quizState.currentIndex + 1}</span>
        <span class="ng-quiz-question-type">${escapeHtml(quiz.type)}</span>
      </div>

      <button
        id="ngQuizBookmarkBtn"
        class="ng-quiz-bookmark-btn ${quizState.bookmarks[quizState.currentIndex] ? "active" : ""}"
        type="button"
        title="북마크"
      >
        <svg
          viewBox="0 0 24 24"
          width="17"
          height="17"
          fill="${quizState.bookmarks[quizState.currentIndex] ? "currentColor" : "none"}"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      </button>
    </div>

    <h2 class="ng-quiz-question-text">${escapeHtml(quiz.question)}</h2>

    <div id="ngQuizOptionList" class="ng-quiz-option-list"></div>

    <div class="ng-quiz-answer-box ${isSubmitted ? "" : "hidden"}">
      <p class="ng-quiz-result-text ${answerData?.isCorrect ? "correct-text" : "wrong-text"}">
        ${isSubmitted ? (answerData.isCorrect ? "정답입니다!" : "오답입니다.") : ""}
      </p>

      <div class="ng-quiz-answer-detail">
        <p class="ng-quiz-answer-title">정답</p>
        <p class="ng-quiz-answer-content">
          ${isSubmitted ? escapeHtml(quiz.answer) : ""}
        </p>
      </div>

      <div class="ng-quiz-answer-detail">
        <p class="ng-quiz-answer-title">해설</p>
        <p class="ng-quiz-answer-content">
          ${isSubmitted ? escapeHtml(quiz.explanation) : ""}
        </p>
      </div>

      ${
        quiz.source_chunks?.length
          ? `
            <div class="ng-quiz-answer-detail">
              <p class="ng-quiz-answer-title">근거</p>
              <p class="ng-quiz-answer-content">
                ${escapeHtml(sourceText(quiz.source_chunks))}
              </p>
            </div>
          `
          : ""
      }
    </div>

    <div class="ng-quiz-card-actions">
      <div class="ng-quiz-nav-actions">
        <button id="ngQuizPrevBtn" class="ng-quiz-soft-btn" type="button">이전</button>
        <button id="ngQuizNextBtn" class="ng-quiz-soft-btn" type="button">다음</button>
      </div>

      <div class="ng-quiz-submit-actions">
        <button id="ngQuizSubmitBtn" class="ng-quiz-primary-btn" type="button">
          ${isSubmitted ? "제출 완료" : "제출 및 해설 보기"}
        </button>
        <button id="ngQuizResultBtn" class="ng-quiz-soft-btn" type="button">결과 보기</button>
      </div>
    </div>
  `;

  renderOptions(quiz, answerData, isSubmitted);
  bindQuestionEvents(isSubmitted);
}

function renderOptions(quiz, answerData, isSubmitted) {
  const optionList = document.getElementById("ngQuizOptionList");
  if (!optionList) return;

  quiz.options.forEach((option, optionIndex) => {
    const optionBtn = document.createElement("button");
    optionBtn.type = "button";
    optionBtn.className = "ng-quiz-option-btn";
    optionBtn.textContent = option;

    if (answerData?.selectedIndex === optionIndex) {
      optionBtn.classList.add("selected");
    }

    if (isSubmitted) {
      optionBtn.disabled = true;

      if (optionIndex === quiz.answerIndex) {
        optionBtn.classList.add("correct");
        optionBtn.textContent = `✓ ${option}`;
      }

      if (optionIndex === answerData.selectedIndex && optionIndex !== quiz.answerIndex) {
        optionBtn.classList.add("wrong");
        optionBtn.textContent = `✕ ${option}`;
      }
    }

    optionBtn.addEventListener("click", () => {
      if (quizState.answers[quizState.currentIndex]?.isSubmitted) return;

      quizState.answers[quizState.currentIndex] = {
        selectedIndex: optionIndex,
        selectedAnswer: option,
        isSubmitted: false,
      };

      renderQuizLayout(getCanvas());
    });

    optionList.appendChild(optionBtn);
  });
}

function bindQuestionEvents(isSubmitted) {
  document
    .getElementById("ngQuizBookmarkBtn")
    ?.addEventListener("click", toggleBookmark);

  document
    .getElementById("ngQuizPrevBtn")
    ?.addEventListener("click", goPrev);

  document
    .getElementById("ngQuizNextBtn")
    ?.addEventListener("click", goNext);

  document
    .getElementById("ngQuizSubmitBtn")
    ?.addEventListener("click", submitQuestion);

  document
    .getElementById("ngQuizResultBtn")
    ?.addEventListener("click", showResult);

  document.getElementById("ngQuizPrevBtn").disabled = quizState.currentIndex === 0;
  document.getElementById("ngQuizNextBtn").disabled =
    quizState.currentIndex === quizState.list.length - 1;
  document.getElementById("ngQuizSubmitBtn").disabled = isSubmitted;

  renderIndexList();
  updateProgress();
}

function submitQuestion() {
  const quiz = quizState.list[quizState.currentIndex];
  const answerData = quizState.answers[quizState.currentIndex];

  if (!answerData || answerData.selectedIndex === undefined) {
    alert("답을 선택해주세요.");
    return;
  }

  const isCorrect = answerData.selectedIndex === quiz.answerIndex;

  quizState.answers[quizState.currentIndex] = {
    selectedIndex: answerData.selectedIndex,
    selectedAnswer: quiz.options[answerData.selectedIndex],
    correctAnswer: quiz.answer,
    explanation: quiz.explanation,
    isCorrect,
    isSubmitted: true,
  };

  renderQuizLayout(getCanvas());
}

function updateProgress() {
  const submittedCount = quizState.answers.filter((answer) => answer?.isSubmitted).length;
  const totalCount = quizState.list.length;
  const percent = Math.round((submittedCount / totalCount) * 100);

  const text = document.getElementById("ngQuizProgressText");
  const percentText = document.getElementById("ngQuizProgressPercent");
  const fill = document.getElementById("ngQuizProgressFill");

  if (text) text.textContent = `${submittedCount} / ${totalCount} 제출`;
  if (percentText) percentText.textContent = `${percent}%`;
  if (fill) fill.style.width = `${percent}%`;
}

function goPrev() {
  if (quizState.currentIndex <= 0) return;

  quizState.currentIndex -= 1;
  quizState.showResult = false;
  renderQuizLayout(getCanvas());
}

function goNext() {
  if (quizState.currentIndex >= quizState.list.length - 1) return;

  quizState.currentIndex += 1;
  quizState.showResult = false;
  renderQuizLayout(getCanvas());
}

function toggleBookmark() {
  quizState.bookmarks[quizState.currentIndex] =
    !quizState.bookmarks[quizState.currentIndex];

  renderQuizLayout(getCanvas());
}

function showResult() {
  const submittedCount = quizState.answers.filter((answer) => answer?.isSubmitted).length;

  if (submittedCount < quizState.list.length) {
    const move = confirm("아직 제출하지 않은 문제가 있습니다. 그래도 결과를 보시겠습니까?");
    if (!move) return;
  }

  quizState.showResult = true;
  renderQuizLayout(getCanvas());
}

function renderResult() {
  const correctCount = quizState.answers.filter(
    (answer) => answer?.isSubmitted && answer.isCorrect
  ).length;

  const totalCount = quizState.list.length;
  const score = Math.round((correctCount / totalCount) * 100);

  document.getElementById("ngQuizScore").textContent = `${score}점`;
  document.getElementById("ngQuizScoreDesc").textContent =
    `총 ${totalCount}문제 중 ${correctCount}문제를 맞혔습니다.`;

  const reviewList = document.getElementById("ngQuizReviewList");
  reviewList.innerHTML = `<p class="ng-quiz-review-title">오답 복습</p>`;

  const wrongAnswers = [];

  quizState.list.forEach((quiz, index) => {
    const answer = quizState.answers[index];

    if (!answer || !answer.isSubmitted) {
      wrongAnswers.push({
        question: quiz.question,
        selectedAnswer: "미제출",
        correctAnswer: quiz.answer,
        explanation: quiz.explanation,
      });
      return;
    }

    if (!answer.isCorrect) {
      wrongAnswers.push({
        question: quiz.question,
        selectedAnswer: answer.selectedAnswer,
        correctAnswer: answer.correctAnswer,
        explanation: answer.explanation,
      });
    }
  });

  if (wrongAnswers.length === 0) {
    reviewList.innerHTML += `
      <div class="ng-quiz-review-item">
        <p class="ng-quiz-review-question">틀린 문제가 없습니다.</p>
        <p class="ng-quiz-review-answer">모든 문제를 정확하게 이해했습니다.</p>
      </div>
    `;
    return;
  }

  wrongAnswers.forEach((item) => {
    const reviewItem = document.createElement("div");
    reviewItem.className = "ng-quiz-review-item";
    reviewItem.innerHTML = `
      <p class="ng-quiz-review-question">${escapeHtml(item.question)}</p>
      <p class="ng-quiz-review-answer"><strong>내 답:</strong> ${escapeHtml(item.selectedAnswer)}</p>
      <p class="ng-quiz-review-answer"><strong>정답:</strong> ${escapeHtml(item.correctAnswer)}</p>
      <p class="ng-quiz-review-answer"><strong>해설:</strong> ${escapeHtml(item.explanation)}</p>
    `;
    reviewList.appendChild(reviewItem);
  });
}

function restartQuiz() {
  quizState.currentIndex = 0;
  quizState.answers = Array(quizState.list.length).fill(null);
  quizState.bookmarks = Array(quizState.list.length).fill(false);
  quizState.showResult = false;

  renderQuizLayout(getCanvas());
}

function toggleFullscreen() {
  quizState.fullscreen = !quizState.fullscreen;
  document.body.classList.toggle("quiz-fullscreen-mode", quizState.fullscreen);

  renderQuizLayout(getCanvas());
}

function showOriginalDocument() {
  document.body.classList.remove("quiz-fullscreen-mode");
  document.body.classList.remove("quiz-inline-mode");

  quizState.fullscreen = false;

  if (window._pdfDoc && typeof window.reRenderPdf === "function") {
    window.reRenderPdf();
    return;
  }

  if (window._pdfUrl && typeof window.renderPdf === "function") {
    window.renderPdf(window._pdfUrl);
    return;
  }

  const container = getCanvas();
  container.innerHTML = `
    <div class="pdf-no-content">
      문서를 불러올 수 없습니다.
    </div>
  `;
}

function injectQuizStyle() {
  if (document.getElementById("ngQuizStyle")) return;

  const style = document.createElement("style");
  style.id = "ngQuizStyle";
  style.textContent = `
    body.quiz-inline-mode {
      --quiz-top: 90px;
      --quiz-right: 32px;
      --quiz-bottom: 14px;
      --quiz-left-gap: 6px;
      --quiz-height: calc(100vh - var(--quiz-top) - var(--quiz-bottom));
    }

    .ng-quiz {
      width: 100%;
      min-height: var(--quiz-height);
      display: flex;
    }

    .ng-quiz-shell {
      width: 100%;
      min-height: var(--quiz-height);
      display: grid;
      grid-template-columns: 1fr;
      gap: 0;
    }

    .ng-quiz-shell.fullscreen {
      grid-template-columns: 180px 1fr;
      gap: 16px;
    }

    .ng-quiz-index-panel {
      display: none;
    }

    .ng-quiz-shell.fullscreen .ng-quiz-index-panel {
      display: block;
    }

    .ng-quiz-index-card {
      position: sticky;
      top: 20px;
      padding: 14px;
      border: 1px solid #e5ecf5;
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.92);
      box-shadow: 0 10px 24px rgba(47, 75, 116, 0.06);
    }

    .ng-quiz-index-title {
      margin-bottom: 10px;
      font-size: 12px;
      font-weight: 600;
      color: #334155;
    }

    .ng-quiz-index-list {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 7px;
    }

    .ng-quiz-number-btn {
      height: 30px;
      border: 1px solid #e5ecf5;
      border-radius: 10px;
      background: #fff;
      color: #64748b;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
    }

    .ng-quiz-number-btn.current {
      background: #eaf2ff;
      border-color: #cfe0ff;
      color: #3f6fbf;
    }

    .ng-quiz-number-btn.done {
      background: #f0fdf4;
      border-color: #bbf7d0;
      color: #15803d;
    }

    .ng-quiz-number-btn.bookmarked::after {
      content: "";
      display: block;
      width: 4px;
      height: 4px;
      margin: -2px auto 0;
      border-radius: 50%;
      background: #f59e0b;
    }

    .ng-quiz-main {
      width: 100%;
      min-width: 0;
      display: flex;
    }

    .ng-quiz-panel {
      width: 100%;
      min-height: var(--quiz-height);
      padding: 25px 25px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid #e5ecf5;
      border-radius: 15px;
      background: #ffffff;
      box-shadow: 0 10px 34px rgba(15, 23, 42, 0.04);
    }

    .ng-quiz-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
      flex-shrink: 0;
    }

    .ng-quiz-badge {
      display: inline-flex;
      padding: 5px 10px;
      margin-bottom: 10px;
      border-radius: 999px;
      background: #eaf2ff;
      color: #4f7fd6;
      font-size: 11.5px;
      font-weight: 600;
    }

    .ng-quiz-title {
      margin-bottom: 4px;
      font-size: 21px;
      font-weight: 650;
      color: #1e293b;
    }

    .ng-quiz-desc {
      font-size: 12.5px;
      color: #7b8ca3;
    }

    .ng-quiz-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .ng-quiz-icon-btn,
    .ng-quiz-soft-btn,
    .ng-quiz-primary-btn,
    .ng-quiz-bookmark-btn {
      border: none;
      cursor: pointer;
      font-family: inherit;
    }

    .ng-quiz-icon-btn {
      width: 36px;
      height: 36px;
      border-radius: 13px;
      background: #f4f7fb;
      color: #64748b;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .ng-quiz-icon-btn:hover,
    .ng-quiz-icon-btn.active {
      background: #eaf2ff;
      color: #4f7fd6;
    }

    .ng-quiz-icon-btn svg {
      width: 18px;
      height: 18px;
    }

    .ng-quiz-progress-card {
      flex-shrink: 0;
      margin-bottom: 16px;
      padding: 13px 14px;
      border: 1px solid #e5ecf5;
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.86);
    }

    .ng-quiz-progress-info {
      display: flex;
      justify-content: space-between;
      margin-bottom: 9px;
    }

    .ng-quiz-progress-text {
      font-size: 12.5px;
      font-weight: 600;
      color: #334155;
    }

    .ng-quiz-progress-percent {
      font-size: 12px;
      color: #94a3b8;
    }

    .ng-quiz-progress-bar {
      height: 7px;
      overflow: hidden;
      border-radius: 999px;
      background: #edf2f7;
    }

    .ng-quiz-progress-fill {
      width: 0%;
      height: 100%;
      border-radius: 999px;
      background: linear-gradient(90deg, #78a3ea, #9abaf4);
      transition: width 0.2s ease;
    }

    .ng-quiz-question-card,
    .ng-quiz-result-card {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 22px;
      border: 1px solid #e5ecf5;
      border-radius: 24px;
      background: #ffffff;
      box-shadow: 0 14px 34px rgba(47, 75, 116, 0.08);
    }

    .ng-quiz-question-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }

    .ng-quiz-question-meta {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .ng-quiz-question-number {
      min-width: 44px;
      height: 28px;
      padding: 0 10px;
      border-radius: 999px;
      background: #f3f7ff;
      color: #4f7fd6;
      font-size: 12px;
      font-weight: 650;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .ng-quiz-question-type {
      font-size: 11.5px;
      color: #94a3b8;
    }

    .ng-quiz-bookmark-btn {
      width: 34px;
      height: 34px;
      border-radius: 12px;
      background: #f8fafc;
      color: #94a3b8;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .ng-quiz-bookmark-btn.active {
      background: #fff7ed;
      color: #f59e0b;
    }

    .ng-quiz-question-text {
      margin-bottom: 18px;
      font-size: 18px;
      line-height: 1.55;
      font-weight: 600;
      color: #1e293b;
    }

    .ng-quiz-option-list {
      display: flex;
      flex-direction: column;
      gap: 9px;
    }

    .ng-quiz-option-btn {
      width: 100%;
      min-height: 44px;
      padding: 12px 14px;
      border: 1px solid #dbe4f0;
      border-radius: 15px;
      background: #ffffff;
      color: #475569;
      font-size: 13.5px;
      line-height: 1.45;
      text-align: left;
      cursor: pointer;
    }

    .ng-quiz-option-btn:hover {
      background: #f6f9ff;
      border-color: #bfd4fb;
    }

    .ng-quiz-option-btn.selected {
      background: #eaf2ff;
      border-color: #78a3ea;
      color: #315fae;
      font-weight: 600;
    }

    .ng-quiz-option-btn.correct {
      background: #ecfdf3;
      border-color: #86efac;
      color: #166534;
      font-weight: 600;
    }

    .ng-quiz-option-btn.wrong {
      background: #fef2f2;
      border-color: #fca5a5;
      color: #991b1b;
      font-weight: 600;
    }

    .ng-quiz-answer-box {
      margin-top: 16px;
      padding: 16px;
      border: 1px solid #e5ecf5;
      border-radius: 18px;
      background: #f8fafc;
    }

    .ng-quiz-result-text {
      margin-bottom: 12px;
      font-size: 14px;
      font-weight: 650;
    }

    .ng-quiz-result-text.correct-text {
      color: #16a34a;
    }

    .ng-quiz-result-text.wrong-text {
      color: #dc2626;
    }

    .ng-quiz-answer-detail {
      padding-top: 11px;
      margin-top: 11px;
      border-top: 1px solid #e5ecf5;
    }

    .ng-quiz-answer-title {
      margin-bottom: 5px;
      font-size: 12px;
      font-weight: 650;
      color: #334155;
    }

    .ng-quiz-answer-content {
      font-size: 12.5px;
      line-height: 1.65;
      color: #64748b;
    }

    .ng-quiz-card-actions {
      margin-top: 18px;
      display: flex;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }

    .ng-quiz-nav-actions,
    .ng-quiz-submit-actions,
    .ng-quiz-result-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .ng-quiz-soft-btn,
    .ng-quiz-primary-btn {
      min-height: 36px;
      padding: 0 14px;
      border-radius: 13px;
      font-size: 12.5px;
      font-weight: 600;
    }

    .ng-quiz-soft-btn {
      background: #f4f7fb;
      color: #64748b;
    }

    .ng-quiz-primary-btn {
      background: #78a3ea;
      color: #ffffff;
      box-shadow: 0 8px 18px rgba(120, 163, 234, 0.22);
    }

    .ng-quiz-soft-btn:disabled,
    .ng-quiz-primary-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      box-shadow: none;
    }

    .ng-quiz-result-card {
      text-align: center;
    }

    .ng-quiz-score {
      margin: 8px 0 6px;
      font-size: 38px;
      font-weight: 700;
      color: #4f7fd6;
    }

    .ng-quiz-score-desc {
      margin-bottom: 16px;
      font-size: 13px;
      color: #64748b;
    }

    .ng-quiz-review-list {
      margin-top: 22px;
      text-align: left;
    }

    .ng-quiz-review-title {
      margin-bottom: 10px;
      font-size: 14px;
      font-weight: 650;
      color: #334155;
    }

    .ng-quiz-review-item {
      margin-bottom: 10px;
      padding: 14px;
      border: 1px solid #e5ecf5;
      border-radius: 16px;
      background: #f8fafc;
    }

    .ng-quiz-review-question {
      margin-bottom: 7px;
      font-size: 13px;
      line-height: 1.55;
      font-weight: 600;
      color: #1e293b;
    }

    .ng-quiz-review-answer {
      font-size: 12.5px;
      line-height: 1.55;
      color: #64748b;
    }

    .ng-quiz-empty {
      min-height: 360px;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      color: #94a3b8;
      font-size: 13px;
      line-height: 1.7;
    }

    .hidden {
      display: none !important;
    }

    body.quiz-inline-mode:not(.quiz-fullscreen-mode) .content-container {
      margin-top: var(--quiz-top) !important;
      padding: 0 var(--quiz-right) var(--quiz-bottom) var(--quiz-left-gap) !important;
      align-items: stretch !important;
    }

    body.quiz-inline-mode:not(.quiz-fullscreen-mode) .center-area {
      width: 100% !important;
      max-width: none !important;
      flex: 1 1 auto !important;
      justify-content: stretch !important;
      align-items: stretch !important;
      display: flex !important;
    }

    body.quiz-inline-mode:not(.quiz-fullscreen-mode) #pdfContainer {
      width: 100% !important;
      flex: 1 1 auto !important;
      max-width: none !important;
      min-height: var(--quiz-height) !important;
      padding: 0 !important;
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
      border-radius: 0 !important;
    }

    body.quiz-inline-mode:not(.quiz-fullscreen-mode) .ng-quiz-index-panel {
      display: none !important;
    }

    body.quiz-fullscreen-mode .sidebar,
    body.quiz-fullscreen-mode .toolbar-wrapper,
    body.quiz-fullscreen-mode .side-area,
    body.quiz-fullscreen-mode #etP,
    body.quiz-fullscreen-mode #trail-canvas,
    body.quiz-fullscreen-mode #gaze-dot {
      display: none !important;
    }

    body.quiz-fullscreen-mode .main-wrapper {
      width: 100% !important;
      margin-left: 0 !important;
      padding-left: 0 !important;
    }

    body.quiz-fullscreen-mode .content-container {
      margin-top: 0 !important;
      padding: 18px 24px !important;
    }

    body.quiz-fullscreen-mode .center-area {
      width: 100% !important;
      max-width: 1180px !important;
      margin: 0 auto !important;
    }

    body.quiz-fullscreen-mode #pdfContainer {
      width: 100% !important;
      max-width: none !important;
      min-height: calc(100vh - 36px) !important;
      padding: 0 !important;
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
    }

    body.quiz-fullscreen-mode .ng-quiz {
      min-height: calc(100vh - 36px);
    }

    body.quiz-fullscreen-mode .ng-quiz-shell {
      min-height: calc(100vh - 36px);
    }

    body.quiz-fullscreen-mode .ng-quiz-panel {
      min-height: calc(100vh - 36px);
      padding: 0;
      background: transparent;
      border: none;
      border-radius: 0;
      box-shadow: none;
    }
  `;

  document.head.appendChild(style);
}
