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

    return {
      type: answerIndexes.length >= 2 ? "두 개 고르시오" : "하나만 고르시오",
      question: q.question || "",
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
    // 앞에 붙은 숫자 제거: "6. 제목", "06_제목", "1-제목" 같은 형태 대응
    .replace(/^\s*\d+\s*[._-]\s*/g, "")
    .trim();

  return `${cleanTitle} 퀴즈`;
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

            <article
              id="ngQuizQuestionCard"
              class="ng-quiz-question-card ${quizState.showResult ? "hidden" : ""}"
            ></article>

            <section
  id="ngQuizResultView"
  class="ng-quiz-result-card ${quizState.showResult ? "" : "hidden"}"
>
  <div class="ng-quiz-result-summary">
    <div class="ng-quiz-result-score-box">
      <p id="ngQuizScore" class="ng-quiz-score"></p>
      <p id="ngQuizScoreDesc" class="ng-quiz-score-desc"></p>
    </div>
  </div>

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
  `;

  bindBaseEvents();
  renderIndexList();

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

    const isDone =
      quizState.answers[index]?.selectedIndexes?.length ||
      quizState.answers[index]?.isRevealed;

    if (index === quizState.currentIndex) button.classList.add("current");
    if (isDone) button.classList.add("done");
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
  const isSubmitted = answerData?.isRevealed;

  card.innerHTML = `
  <div class="ng-quiz-question-top">
    <div class="ng-quiz-question-head">
      <span class="ng-quiz-question-number">Q${quizState.currentIndex + 1}</span>

      <div class="ng-quiz-question-copy">
        <h2 class="ng-quiz-question-text">${escapeHtml(quiz.question)}</h2>
        <p class="ng-quiz-question-type">${escapeHtml(quiz.type)}</p>
      </div>
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

  <div id="ngQuizOptionList" class="ng-quiz-option-list"></div>

  <div class="ng-quiz-answer-box ${isSubmitted ? "" : "hidden"}">
    <p class="ng-quiz-result-text ${answerData?.isCorrect ? "correct-text" : "wrong-text"}">
      ${isSubmitted ? (answerData.isCorrect ? "정답입니다!" : "오답입니다.") : ""}
    </p>

    <div class="ng-quiz-answer-detail">
      <p class="ng-quiz-answer-title">정답</p>
      <p class="ng-quiz-answer-content">
        ${isSubmitted ? escapeHtml(getAnswerText(quiz)) : ""}
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
    <div class="ng-quiz-answer-actions">
      <button
        id="ngQuizRevealBtn"
        class="ng-quiz-soft-btn danger"
        type="button"
        ${answerData?.isRevealed ? "disabled" : ""}
      >
        정답 및 해설 보기
      </button>
    </div>

    <div class="ng-quiz-nav-actions right">
      <button id="ngQuizPrevBtn" class="ng-quiz-soft-btn" type="button">이전</button>

      ${
        quizState.currentIndex === quizState.list.length - 1
          ? `<button id="ngQuizFinalSubmitBtn" class="ng-quiz-primary-btn" type="button">
               제출 및 결과보기
             </button>`
          : `<button id="ngQuizNextBtn" class="ng-quiz-primary-btn" type="button">
               다음
             </button>`
      }
    </div>
  </div>
`;

  renderOptions(quiz, answerData, isSubmitted);
  bindQuestionEvents(isSubmitted);
}

function renderOptions(quiz, answerData, isSubmitted) {
  const optionList = document.getElementById("ngQuizOptionList");
  if (!optionList) return;

  const selectedIndexes = answerData?.selectedIndexes || [];
  const isMultiAnswer = quiz.answerIndexes.length >= 2;

  quiz.options.forEach((option, optionIndex) => {
    const optionBtn = document.createElement("button");
    optionBtn.type = "button";
    optionBtn.className = "ng-quiz-option-btn";
    optionBtn.textContent = formatOptionLabel(optionIndex, option);

    const isSelected = selectedIndexes.includes(optionIndex);
    const isCorrectAnswer = quiz.answerIndexes.includes(optionIndex);

    if (isSelected) {
      optionBtn.classList.add("selected");
    }

    if (isSubmitted) {
      optionBtn.disabled = true;

      if (isCorrectAnswer) {
        optionBtn.classList.add("correct");
        optionBtn.textContent = `✓ ${formatOptionLabel(optionIndex, option)}`;
      }

      if (isSelected && !isCorrectAnswer) {
        optionBtn.classList.add("wrong");
        optionBtn.textContent = `✕ ${formatOptionLabel(optionIndex, option)}`;
      }
    }

    optionBtn.addEventListener("click", () => {
      if (quizState.answers[quizState.currentIndex]?.isRevealed) return;

      const currentAnswer = quizState.answers[quizState.currentIndex] || {
        selectedIndexes: [],
        isRevealed: false,
      };

      let nextSelectedIndexes = [...currentAnswer.selectedIndexes];

      if (isMultiAnswer) {
        if (nextSelectedIndexes.includes(optionIndex)) {
          nextSelectedIndexes = nextSelectedIndexes.filter(
            (index) => index !== optionIndex
          );
        } else {
          if (nextSelectedIndexes.length >= quiz.answerIndexes.length) {
            nextSelectedIndexes.shift();
          }

          nextSelectedIndexes.push(optionIndex);
        }
      } else {
        nextSelectedIndexes = [optionIndex];
      }

      quizState.answers[quizState.currentIndex] = {
        selectedIndexes: nextSelectedIndexes,
        selectedAnswer: nextSelectedIndexes
          .map((index) => formatOptionLabel(index, quiz.options[index]))
          .join(", "),
        isRevealed: false,
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
    .getElementById("ngQuizRevealBtn")
    ?.addEventListener("click", revealAnswerAsWrong);

  document
    .getElementById("ngQuizPrevBtn")
    ?.addEventListener("click", goPrev);

  document
    .getElementById("ngQuizNextBtn")
    ?.addEventListener("click", goNext);

  document
    .getElementById("ngQuizFinalSubmitBtn")
    ?.addEventListener("click", finalSubmitAndShowResult);

  document.getElementById("ngQuizPrevBtn").disabled = quizState.currentIndex === 0;

  renderIndexList();
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

function renderResult() {
  const correctCount = quizState.answers.filter(
    (answer) => answer?.isCorrect
  ).length;

  const totalCount = quizState.list.length;
  const score = Math.round((correctCount / totalCount) * 100);

  document.getElementById("ngQuizScore").textContent = `${score}점`;
  document.getElementById("ngQuizScoreDesc").textContent =
    `총 ${totalCount}문제 중 ${correctCount}문제를 맞혔습니다.`;

  const reviewList = document.getElementById("ngQuizReviewList");
  reviewList.innerHTML = "";

  quizState.list.forEach((quiz, quizIndex) => {
    const answer = quizState.answers[quizIndex] || {};
    const selectedIndexes = answer.selectedIndexes || [];
    const isCorrectQuestion = !!answer.isCorrect;

    const reviewItem = document.createElement("div");
    reviewItem.className = `ng-quiz-review-item ${
      isCorrectQuestion ? "correct" : "wrong"
    }`;

    const optionsHtml = quiz.options
      .map((option, optionIndex) => {

        const isSelected = selectedIndexes.includes(optionIndex);
const isCorrectAnswer = quiz.answerIndexes.includes(optionIndex);

const optionClass = [
  "ng-result-option",
  isCorrectAnswer ? "correct" : "",
  isSelected && !isCorrectAnswer ? "wrong" : "",
].join(" ");

return `
  <div class="${optionClass}">
        <p class="ng-result-option-title">
              ${escapeHtml(formatOptionLabel(optionIndex, option))}
            </p>

            <div class="ng-result-explain-divider"></div>

            <p class="ng-result-option-explain">
              ${escapeHtml(getOptionExplanation(quiz, optionIndex))}
            </p>
          </div>
        `;
      })
      .join("");

      reviewItem.innerHTML = `
  <div class="ng-result-question-head">
    <div class="ng-result-question-status">
      <span class="ng-result-question-number">Q${quizIndex + 1}</span>
    </div>

    <div class="ng-result-question-copy">
      <div class="ng-result-question-title-row">
        <h3 class="ng-result-question-text">${escapeHtml(quiz.question)}</h3>

        <span class="ng-result-question-mark ${
          isCorrectQuestion ? "correct" : "wrong"
        }">
          ${isCorrectQuestion ? "O" : "X"}
        </span>
      </div>

      <p class="ng-result-question-type">${escapeHtml(quiz.type)}</p>
    </div>
  </div>

      <div class="ng-result-answer-line">
        정답: ${escapeHtml(getAnswerNumberText(quiz))}
      </div>

      <div class="ng-result-option-list">
        ${optionsHtml}
      </div>
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

function revealAnswerAsWrong() {
  const quiz = quizState.list[quizState.currentIndex];
  const answerData = quizState.answers[quizState.currentIndex] || {
    selectedIndexes: [],
  };

  const selectedIndexes = answerData.selectedIndexes || [];

  quizState.answers[quizState.currentIndex] = {
    selectedIndexes,
    selectedAnswer: selectedIndexes.length
      ? selectedIndexes
          .map((index) => formatOptionLabel(index, quiz.options[index]))
          .join(", ")
      : "해설 확인",
    explanation: quiz.explanation,
    isCorrect: false,
    isRevealed: true,
  };

  renderQuizLayout(getCanvas());
}

function finalSubmitAndShowResult() {
  quizState.answers = quizState.list.map((quiz, index) => {
    const answerData = quizState.answers[index];

    if (answerData?.isRevealed) {
      return {
        ...answerData,
        selectedIndexes: answerData.selectedIndexes || [],
        selectedAnswer: answerData.selectedAnswer || "해설 확인",
        explanation: quiz.explanation,
        isCorrect: false,
        isRevealed: true,
      };
    }

    const selectedIndexes = answerData?.selectedIndexes || [];
    const isCorrect = isSameIndexes(selectedIndexes, quiz.answerIndexes);

    return {
      selectedIndexes,
      selectedAnswer: selectedIndexes.length
        ? selectedIndexes
            .map((selectedIndex) =>
              formatOptionLabel(selectedIndex, quiz.options[selectedIndex])
            )
            .join(", ")
        : "미제출",
      explanation: quiz.explanation,
      isCorrect,
      isRevealed: false,
    };
  });

  quizState.showResult = true;
  renderQuizLayout(getCanvas());
}

function isSameIndexes(a, b) {
  if (a.length !== b.length) return false;

  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);

  return sortedA.every((value, index) => value === sortedB[index]);
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
      grid-template-columns: 164px 1fr;
      gap: 14px;
    }

    .ng-quiz-index-panel {
      display: none;
    }

    .ng-quiz-shell.fullscreen .ng-quiz-index-panel {
      display: block;
    }

    .ng-quiz-index-card {
      position: sticky;
      top: 18px;
      padding: 12px;
      border: 1px solid #e7edf5;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.94);
      box-shadow: 0 8px 20px rgba(47, 75, 116, 0.045);
    }

    .ng-quiz-index-title {
      margin-bottom: 9px;
      font-size: 11.5px;
      font-weight: 500;
      color: #64748b;
    }

    .ng-quiz-index-list {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
    }

    .ng-quiz-number-btn {
      height: 28px;
      border: 1px solid #e5ecf5;
      border-radius: 8px;
      background: #fff;
      color: #64748b;
      font-size: 11.5px;
      font-weight: 400;
      cursor: pointer;
    }

    .ng-quiz-number-btn.current {
      background: #eaf2ff;
      border-color: #cfe0ff;
      color: #3f6fbf;
      font-weight: 500;
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
      padding: 21px 22px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid #e6edf5;
      border-radius: 14px;
      background: #ffffff;
      box-shadow: 0 8px 26px rgba(15, 23, 42, 0.035);
    }

    .ng-quiz-topbar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      flex-shrink: 0;
    }

    .ng-quiz-badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 9px;
      margin-bottom: 10px;
      border-radius: 999px;
      background: #eef4ff;
      color: #5b84d6;
      font-size: 10.5px;
      font-weight: 500;
      line-height: 1.2;
    }

    .ng-quiz-title {
      margin-bottom: 6px;
      font-size: 17px;
      font-weight: 600;
      line-height: 1.35;
      color: #1f2a44;
      letter-spacing: -0.2px;
    }

    .ng-quiz-desc {
      font-size: 11.5px;
      font-weight: 400;
      line-height: 1.5;
      color: #8a97ab;
    }

    .ng-quiz-actions {
      display: flex;
      align-items: center;
      gap: 7px;
      flex-shrink: 0;
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
      width: 30px;
      height: 30px;
      border-radius: 10px;
      background: #f5f7fb;
      color: #6d7b8d;
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
      width: 16px;
      height: 16px;
    }

    .ng-quiz-question-card {
  --question-indent: 48px;

  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 18px;
  border: 1px solid #e6edf6;
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 8px 20px rgba(47, 75, 116, 0.045);
}

.ng-quiz-result-card {
  --question-indent: 48px;

  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0 0;
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  text-align: left;
}

    .ng-quiz-question-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }

    .ng-quiz-question-head {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      min-width: 0;
      flex: 1;
    }

    .ng-quiz-question-copy {
      min-width: 0;
      flex: 1;
    }

    .ng-quiz-question-number {
      flex-shrink: 0;
      min-width: 38px;
      height: 24px;
      padding: 0 8px;
      border-radius: 999px;
      background: #eef4ff;
      color: #5b84d6;
      font-size: 11px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .ng-quiz-question-text {
      margin: 0 0 6px 0;
      font-size: 16px;
      line-height: 1.55;
      font-weight: 500;
      color: #24324a;
      letter-spacing: -0.1px;
      word-break: keep-all;
    }

    .ng-quiz-question-type {
      margin: 0;
      font-size: 11.5px;
      font-weight: 400;
      color: #94a3b8;
      line-height: 1.4;
    }

    .ng-quiz-bookmark-btn {
      width: 30px;
      height: 30px;
      border-radius: 10px;
      background: #f8fafc;
      color: #9aa7ba;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .ng-quiz-bookmark-btn svg {
      width: 15px;
      height: 15px;
    }

    .ng-quiz-bookmark-btn.active {
      background: #fff7ed;
      color: #f59e0b;
    }

    .ng-quiz-option-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-left: var(--question-indent);
    }

    .ng-quiz-option-btn {
      width: 100%;
      min-height: 38px;
      padding: 10px 12px;
      border: 1px solid #dfe7f2;
      border-radius: 11px;
      background: #ffffff;
      color: #526174;
      font-size: 12.5px;
      font-weight: 400;
      line-height: 1.45;
      text-align: left;
      cursor: pointer;
      transition: all 0.16s ease;
    }

    .ng-quiz-option-btn:hover {
      background: #f8fbff;
      border-color: #c9daf7;
    }

    .ng-quiz-option-btn.selected {
      background: #edf4ff;
      border-color: #7ea8ef;
      color: #315fae;
      font-weight: 500;
    }

    .ng-quiz-option-btn.correct {
      background: #eefcf3;
      border-color: #9fe2b4;
      color: #166534;
      font-weight: 500;
    }

    .ng-quiz-option-btn.wrong {
      background: #fff3f3;
      border-color: #f3b3b3;
      color: #9a2a2a;
      font-weight: 500;
    }

    .ng-quiz-answer-box {
      margin-top: 13px;
      margin-left: var(--question-indent);
      padding: 13px;
      border: 1px solid #e5ecf5;
      border-radius: 14px;
      background: #f8fafc;
    }

    .ng-quiz-result-text {
      margin-bottom: 10px;
      font-size: 13px;
      font-weight: 550;
    }

    .ng-quiz-result-text.correct-text {
      color: #16a34a;
    }

    .ng-quiz-result-text.wrong-text {
      color: #dc2626;
    }

    .ng-quiz-answer-detail {
      padding-top: 9px;
      margin-top: 9px;
      border-top: 1px solid #e5ecf5;
    }

    .ng-quiz-answer-title {
      margin-bottom: 4px;
      font-size: 11.5px;
      font-weight: 550;
      color: #334155;
    }

    .ng-quiz-answer-content {
      font-size: 12px;
      font-weight: 400;
      line-height: 1.6;
      color: #64748b;
    }

    .ng-quiz-card-actions {
      margin-top: 16px;
      margin-left: var(--question-indent);
      padding-top: 14px;
      border-top: 1px solid #eef2f7;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .ng-quiz-answer-actions,
    .ng-quiz-nav-actions,
    .ng-quiz-submit-actions,
    .ng-quiz-result-actions,
    .ng-quiz-nav-actions.right {
      display: flex;
      gap: 7px;
      flex-wrap: wrap;
    }

    .ng-quiz-nav-actions.right {
      margin-left: auto;
      justify-content: flex-end;
    }

    .ng-quiz-soft-btn,
    .ng-quiz-primary-btn {
      min-height: 32px;
      padding: 0 12px;
      border-radius: 10px;
      font-size: 12px;
      font-weight: 500;
      line-height: 1;
    }

    .ng-quiz-soft-btn {
      background: #f5f7fb;
      color: #6b7788;
    }

    .ng-quiz-soft-btn:hover {
      background: #edf2f7;
    }

    .ng-quiz-soft-btn.danger {
      background: #fff6eb;
      color: #c96a1a;
    }

    .ng-quiz-soft-btn.danger:hover {
      background: #ffeed6;
    }

    .ng-quiz-primary-btn {
      background: #79a4ec;
      color: #ffffff;
      box-shadow: 0 5px 12px rgba(120, 163, 234, 0.18);
    }

    .ng-quiz-primary-btn:hover {
      background: #6b98e8;
    }

    .ng-quiz-soft-btn:disabled,
    .ng-quiz-primary-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      box-shadow: none;
    }

    .ng-quiz-result-summary {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 12px;
  padding: 8px 0 10px;
  border: none;
  border-radius: 0;
  background: transparent;
}

.ng-quiz-result-score-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
}

.ng-quiz-score {
  margin: 0;
  font-size: 30px;
  font-weight: 600;
  color: #4f7fd6;
  line-height: 1.2;
  letter-spacing: -0.4px;
}

.ng-quiz-score-desc {
  margin: 0;
  font-size: 13px;
  font-weight: 400;
  color: #64748b;
  line-height: 1.45;
}

.ng-quiz-result-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin: 0 0 12px;
  position: static;
  transform: none;
}

    .ng-quiz-review-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 0;
  text-align: left;
}

.ng-quiz-review-item {
  position: relative;
  padding: 16px 18px 16px 20px;
  border: 1px solid #e5ecf5;
  border-radius: 16px;
  background: #ffffff;
  overflow: hidden;
}

.ng-quiz-review-item::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 5px;
  height: 100%;
  background: #cbd5e1;
}

.ng-quiz-review-item.correct::before {
  background: #22c55e;
}

.ng-quiz-review-item.wrong::before {
  background: #ef4444;
}

.ng-result-question-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding-bottom: 12px;
}

.ng-result-question-status {
  flex-shrink: 0;
}

.ng-result-question-title-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.ng-result-question-title-row .ng-result-question-text {
  flex: 1;
}

.ng-result-question-title-row .ng-result-question-mark {
  flex-shrink: 0;
  margin-top: 1px;
}

.ng-result-question-number {
  min-width: 38px;
  height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  background: #eef4ff;
  color: #5b84d6;
  font-size: 11px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ng-result-question-mark {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
}

.ng-result-question-mark.correct {
  color: #15803d;
}

.ng-result-question-mark.wrong {
  color: #dc2626;
}

.ng-result-question-copy {
  min-width: 0;
  flex: 1;
}

.ng-result-question-text {
  margin: 0 0 5px 0;
  font-size: 15px;
  line-height: 1.55;
  font-weight: 550;
  color: #24324a;
  letter-spacing: -0.1px;
  word-break: keep-all;
}

.ng-result-question-type {
  margin: 0;
  font-size: 11.5px;
  font-weight: 400;
  color: #94a3b8;
  line-height: 1.4;
}

.ng-result-answer-line {
  width: fit-content;
  margin: 0 0 10px var(--question-indent);
  padding: 5px 10px;
  border-radius: 999px;
  background: #eef4ff;
  color: #4f7fd6;
  font-size: 12px;
  font-weight: 600;
}

.ng-result-option-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin-left: var(--question-indent);
}

.ng-result-option {
  border: 1px solid #dfe7f2;
  border-radius: 12px;
  background: #ffffff;
  overflow: hidden;
}

.ng-result-option.selected {
  border-color: #7ea8ef;
  background: #edf4ff;
}

.ng-result-option.correct {
  border-color: #9fe2b4;
  background: #eefcf3;
}

.ng-result-option.wrong {
  border-color: #f3b3b3;
  background: #fff3f3;
}

.ng-result-option-title {
  margin: 0;
  padding: 10px 12px;
  font-size: 12.5px;
  font-weight: 450;
  line-height: 1.45;
  color: #526174;
}


.ng-result-option.selected .ng-result-option-title {
  color: #315fae;
  font-weight: 550;
}

.ng-result-explain-divider {
  height: 1px;
  margin: 0 12px;
  background: #eef2f7;
}

.ng-result-option-explain {
  margin: 0;
  padding: 9px 12px 10px;
  font-size: 12px;
  line-height: 1.6;
  color: #7b8798;
  background: transparent;
}


    .ng-quiz-empty {
      min-height: 320px;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      color: #94a3b8;
      font-size: 12.5px;
      line-height: 1.6;
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
      padding: 16px 22px !important;
    }

    body.quiz-fullscreen-mode .center-area {
      width: 100% !important;
      max-width: 1120px !important;
      margin: 0 auto !important;
    }

    body.quiz-fullscreen-mode #pdfContainer {
      width: 100% !important;
      max-width: none !important;
      min-height: calc(100vh - 32px) !important;
      padding: 0 !important;
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
    }

    body.quiz-fullscreen-mode .ng-quiz,
    body.quiz-fullscreen-mode .ng-quiz-shell {
      min-height: calc(100vh - 32px);
    }

    body.quiz-fullscreen-mode .ng-quiz-panel {
      min-height: calc(100vh - 32px);
      padding: 0;
      background: transparent;
      border: none;
      border-radius: 0;
      box-shadow: none;
    }

    @media (max-width: 720px) {
      .ng-quiz-question-card,
      .ng-quiz-result-card {
        --question-indent: 0px;
      }

      .ng-quiz-question-head {
        gap: 8px;
      }

      .ng-quiz-option-list,
      .ng-quiz-answer-box,
      .ng-quiz-card-actions,
      .ng-result-option-list,
      .ng-result-answer-line {
        margin-left: 0;
      }

      .ng-quiz-result-actions {
        margin-left: 0;
      }

      .ng-quiz-result-summary {
  padding: 8px 0 14px;
}

.ng-quiz-score {
  font-size: 28px;
}

.ng-quiz-score-desc {
  font-size: 12.5px;
}

.ng-quiz-result-actions {
  justify-content: flex-end;
  margin: 0 0 12px;
  position: static;
  transform: none;
}

.ng-result-answer-line {
  margin-left: 0;
}

.ng-quiz-review-item {
  padding: 14px 14px 14px 18px;
}

    }
  `;

  document.head.appendChild(style);
}