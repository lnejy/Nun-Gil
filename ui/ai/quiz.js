// 퀴즈 전체 흐름 
import {
  loadQuizAssetsFromDb,
  saveQuizAssetToDb,
  saveAttemptToDb,
  saveBookmarkedIndexes,
  getLocalQuizBookmarks,
  setLocalQuizBookmarks,
} from "./quizApi.js";

import {
  renderQuizHome,
  getLatestAttempt,
  getDifficultyLabel,
} from "./quizHome.js";

import {
  AI_STATE,
  askClaudeJson,
  buildContext,
  escapeHtml,
  getCanvas,
  getChunks,
  showAiLoading,
  showAiError,
  setCanvasMode,
  enqueueAiTask,
} from "./common.js";

import { createQuizPrompt } from "./prompt.js";


// 현재 열려 있는 퀴즈 상태를 저장
let quizState = {
  assetId: null,
  attemptId: null,
  meta: null,
  list: [],
  currentIndex: 0,
  answers: [],
  bookmarks: [],
  fullscreen: false,
  sidebarWasCollapsed: null,
  showResult: false,
};

let isQuizGenerating = false;

// 퀴즈 버튼 클릭 시 퀴즈 홈 화면을 표시
export async function loadQuiz({ shouldRender = () => true } = {}) {
  if (!shouldRender()) return;

  const container = setCanvasMode("quiz");

  document.body.classList.remove("ai-view-mode");
  document.body.classList.remove("quiz-focus-mode");
  document.body.classList.add("quiz-inline-mode");

  showAiLoading("퀴즈 목록 불러오는 중");

  const quizAssets = await loadQuizAssetsFromDb();

  renderQuizHome(container, quizAssets, {
    getQuizTitle,
    onCreateQuiz: (options) => {
      enqueueAiTask(
        "quiz",
        () =>
          createNewQuizFromOptions(options, {
            shouldRender,
          }),
        {
          type: "QUIZ",
          title: window._docTitle || AI_STATE.docTitle || document.title || "문서",
          docId: AI_STATE.docId || window._currentDocId,
        }
      );
    },
    onOpenSolvedQuiz: openSolvedQuiz,
    onOpenUnsolvedQuiz: openUnsolvedQuiz,
  });
}

// 사용자가 선택한 유형만 남긴다.
function filterQuizBySelectedTypes(questions, selectedTypes) {
  const allowedTypes = Array.isArray(selectedTypes) && selectedTypes.length
    ? selectedTypes.map((type) => String(type).toUpperCase())
    : ["MULTIPLE"];

  return (questions || []).filter((question) => {
    const rawType = String(question?.type || "MULTIPLE").toUpperCase();

    const type =
      rawType === "OX" || rawType === "SHORT" || rawType === "MULTIPLE"
        ? rawType
        : "MULTIPLE";

    return allowedTypes.includes(type);
  });
}

function normalizeQuiz(quiz) {
  return (quiz || []).map((q) => {
    const rawType = String(q.type || "MULTIPLE").toUpperCase();

    const type =
      rawType === "OX" || rawType === "SHORT" || rawType === "MULTIPLE"
        ? rawType
        : "MULTIPLE";

    if (type === "SHORT") {
  const answerText = String(
    q.answerText ||
    q.answer ||
    q.correctAnswer ||
    q.correct_answer ||
    ""
  ).trim();

  const acceptableAnswers = Array.isArray(q.acceptableAnswers)
    ? q.acceptableAnswers.filter((answer) => String(answer || "").trim())
    : [];

  return {
    type: "SHORT",
    question: String(q.question || "").trim(),
    options: [],
    answerIndexes: [],
    answerText,
    acceptableAnswers,
    answerLanguage: q.answerLanguage || "문제에서 지정한 언어",
    answerFormatHint:
      q.answerFormatHint ||
      "정답은 한 단어로 작성하세요. 여러 단어가 필요한 경우 단어 사이를 한 칸만 띄우세요.",
    explanation: q.explanation || "",
    optionExplanations: [],
    source_chunks: q.source_chunks || [],
  };
}

    const options =
      type === "OX"
        ? ["O", "X"]
        : q.options || q.choices || [];

    let answerIndexes = [];

    if (Array.isArray(q.answerIndexes)) {
      answerIndexes = q.answerIndexes;
    } else if (typeof q.answerIndex === "number") {
      answerIndexes = [q.answerIndex];
    } else if (q.answer) {
      const index = options.findIndex(
        (option) => String(option).trim() === String(q.answer).trim()
      );
      if (index >= 0) answerIndexes = [index];
    }

    if (!answerIndexes.length) answerIndexes = [0];

    answerIndexes = [...new Set(answerIndexes)]
      .filter((index) => index >= 0 && index < options.length);

    return {
      type,
      question: String(q.question || "").trim(),
      options,
      answerIndexes,
      answer: answerIndexes.map((index) => options[index]).join(", "),
      explanation: q.explanation || "",
      optionExplanations: q.optionExplanations || [],
      source_chunks: q.source_chunks || [],
    };
  });
}

// 북마크 배열을 복원
function restoreBookmarks(indexes, length) {
  const bookmarks = Array(length).fill(false);

  if (Array.isArray(indexes)) {
    indexes.forEach((index) => {
      if (index >= 0 && index < length) bookmarks[index] = true;
    });
  }

  return bookmarks;
}

// 저장된 답안 배열을 복원
function restoreAnswers(answers) {
  return Array.isArray(answers) ? answers : [];
}
  
function getQuizTitle() {
  const rawTitle = AI_STATE.docTitle || window._docTitle || document.title || "문서";

  const cleanTitle = String(rawTitle)
    // 앞에 붙은 눈길 제거: 눈길 --, 눈길 —, 눈길 -, 눈길: 모두 처리
    .replace(/^눈길\s*[-–—:]*\s*/i, "")
    // 확장자 제거
    .replace(/\.(pdf|ppt|pptx)$/i, "")
    // 끝에 붙은 퀴즈 제거
    .replace(/\s*퀴즈\s*$/i, "")
    .trim();

  return cleanTitle || "문서";
}

// 퀴즈 생성 옵션과 시간을 포함한 제목을 만든다.
function createQuizDisplayTitle({ questionCount, difficulty }) {
  const now = new Date();

  const dateText = `${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  return `${getQuizTitle()} 퀴즈 (${questionCount}문제_${getDifficultyLabel(difficulty)}_${dateText})`;
}

function formatOptionLabel(index, option, type = "MULTIPLE") {
  if (type === "OX") return option;
  return `${index + 1}. ${option}`;
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

// 문제 유형에 맞는 정답 표시 문구를 만든다.
function getCorrectAnswerText(quiz) {
  if (quiz.type === "SHORT") {
    return quiz.answerText || "정답 없음";
  }

  if (quiz.type === "OX") {
    const answerIndex = quiz.answerIndexes?.[0];
    return quiz.options?.[answerIndex] || "정답 없음";
  }

  return getAnswerNumberText(quiz);
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
      <div class="ng-quiz-shell ${quizState.fullscreen ? "focus" : ""}">
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
                <div class="ng-quiz-badge">퀴즈 - ${total}문제</div>
                <h1 class="ng-quiz-title">${escapeHtml(quizState.meta?.title || getQuizTitle())}</h1>
                <p class="ng-quiz-desc">
                  문서 내용을 바탕으로 생성된 문제를 한 문제씩 풀어보세요.
                </p>
              </div>

              <div class="ng-quiz-actions">
                <button
                  id="ngQuizFullscreenBtn"
                  class="ng-quiz-icon-btn ${quizState.fullscreen ? "active" : ""}"
                  type="button"
                  title="문제 번호 패널 보기"
                >
                  ${getFullscreenIcon()}
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
                  <button id="ngQuizBackToListBtn" class="ng-quiz-primary-btn" type="button">
                    ← 퀴즈 목록으로 돌아가기
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
    .getElementById("ngQuizBackToListBtn")
    ?.addEventListener("click", backToQuizHome);

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

    const answer = quizState.answers[index];
    const isDone =
      answer?.selectedIndexes?.length ||
      answer?.textAnswer ||
      answer?.isRevealed;

    if (index === quizState.currentIndex && !quizState.showResult) {
      button.classList.add("current");
    }

    if (quizState.showResult && answer) {
      if (answer.isCorrect) {
        button.classList.add("correct");
      } else {
        button.classList.add("wrong");
      }
    } else if (isDone) {
      button.classList.add("done");
    }

    if (quizState.bookmarks[index]) {
      button.classList.add("bookmarked");
    }

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

    ${renderAnswerArea(quiz, answerData, isSubmitted)}

    <div class="ng-quiz-answer-box ${isSubmitted ? "" : "hidden"}">
  <div class="ng-quiz-answer-detail first">
    <p class="ng-quiz-answer-title">
      정답 : ${isSubmitted ? escapeHtml(getCorrectAnswerText(quiz)) : ""}
    </p>
  </div>

  <div class="ng-quiz-answer-detail">
    <p class="ng-quiz-answer-title">해설</p>
    <p class="ng-quiz-answer-content">
      ${isSubmitted ? escapeHtml(quiz.explanation) : ""}
    </p>
  </div>
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

  if (quiz.type === "SHORT") {
    bindShortAnswerEvent();
  } else {
    renderOptions(quiz, answerData, isSubmitted);
  }

  bindQuestionEvents();
}

function renderAnswerArea(quiz, answerData, isSubmitted) {
  if (quiz.type === "SHORT") {
    return `
      <div class="ng-quiz-short-answer">
        <p class="ng-quiz-short-guide">
          ${escapeHtml(quiz.answerFormatHint || "정답은 한 단어로 작성하세요. 여러 단어가 필요한 경우 단어 사이를 한 칸만 띄우세요.")}
        </p>

        <input
          id="ngQuizShortInput"
          class="ng-quiz-short-input"
          type="text"
          placeholder="정답 입력"
          value="${escapeHtml(answerData?.textAnswer || "")}"
          ${isSubmitted ? "disabled" : ""}
        />
      </div>
    `;
  }

  return `<div id="ngQuizOptionList" class="ng-quiz-option-list"></div>`;
}

function bindShortAnswerEvent() {
  const input = document.getElementById("ngQuizShortInput");
  if (!input) return;

  input.addEventListener("input", () => {
    const currentAnswer = quizState.answers[quizState.currentIndex] || {};
    quizState.answers[quizState.currentIndex] = {
      ...currentAnswer,
      textAnswer: input.value,
      isRevealed: false,
    };
  });
}

function normalizeTextAnswer(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

function isShortAnswerCorrect(userAnswer, quiz) {
  const user = normalizeTextAnswer(userAnswer);

  // 사용자가 아무것도 입력하지 않으면 무조건 오답
  if (!user) return false;

  const answers = [
    quiz.answerText,
    ...(quiz.acceptableAnswers || []),
  ]
    .map(normalizeTextAnswer)
    .filter(Boolean); // 빈 정답 후보 제거

  // 정답 데이터 자체가 없으면 맞출 수 없으므로 오답
  if (!answers.length) return false;

  return answers.includes(user);
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
    optionBtn.textContent = formatOptionLabel(optionIndex, option, quiz.type)

    const isSelected = selectedIndexes.includes(optionIndex);
    const isCorrectAnswer = quiz.answerIndexes.includes(optionIndex);

    if (isSelected) {
      optionBtn.classList.add("selected");
    }

    if (isSubmitted) {
      optionBtn.disabled = true;

      if (isCorrectAnswer) {
        optionBtn.classList.add("correct");
        optionBtn.textContent = `✓ ${formatOptionLabel(optionIndex, option, quiz.type)}`;
      }

      if (isSelected && !isCorrectAnswer) {
        optionBtn.classList.add("wrong");
        optionBtn.textContent = `✕ ${formatOptionLabel(optionIndex, option, quiz.type)}`;
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
  ...currentAnswer,
  selectedIndexes: nextSelectedIndexes,
  selectedAnswer: nextSelectedIndexes
  .map((index) => formatOptionLabel(index, quiz.options[index], quiz.type))
  .join(", "),
  isRevealed: false,
};

      renderQuizLayout(getCanvas());
    });

    optionList.appendChild(optionBtn);
  });
}

function bindQuestionEvents() {
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


// 퀴즈 문제를 북마크함에 저장한다.
function saveQuizBookmarkToBox(index) {
  const quiz = quizState.list[index];
  if (!quiz) return;

  const docId = AI_STATE.docId || window._currentDocId || "demo";

  const bookmark = {
    id: `${docId}_${quizState.assetId}_${index}`,
    type: "QUIZ",
    document_id: docId,
    asset_id: quizState.assetId,
    attempt_id: quizState.attemptId || null,
    quiz_index: index,
    title: `Q${index + 1}. ${quiz.question}`,
    quiz_title: quizState.meta?.title || getQuizTitle(),
    created_at: new Date().toISOString(),
    content: {
      question: quiz.question,
      options: quiz.options || [],
      answerIndexes: quiz.answerIndexes || [],
      answerText: quiz.answerText || "",
      explanation: quiz.explanation || "",
    },
  };

  // 프로젝트에 북마크 저장 함수가 있으면 그쪽으로 넘김
  if (typeof window.saveBookmark === "function") {
    window.saveBookmark(bookmark);
    return;
  }

  // DB 연결 전 테스트용 localStorage 저장
  const bookmarks = getLocalQuizBookmarks();
  const nextBookmarks = [
    bookmark,
    ...bookmarks.filter((item) => item.id !== bookmark.id),
  ];

  setLocalQuizBookmarks(nextBookmarks);

  // 북마크함 화면이 이 이벤트를 듣고 있으면 새로고침 가능
  window.dispatchEvent(
    new CustomEvent("quiz-bookmark-added", {
      detail: bookmark,
    })
  );
}

// 퀴즈 문제를 북마크함에서 제거한다.
function removeQuizBookmarkFromBox(index) {
  const docId = AI_STATE.docId || window._currentDocId || "demo";
  const bookmarkId = `${docId}_${quizState.assetId}_${index}`;

  if (typeof window.removeBookmark === "function") {
    window.removeBookmark({
      type: "QUIZ",
      document_id: docId,
      asset_id: quizState.assetId,
      quiz_index: index,
      id: bookmarkId,
    });
    return;
  }

  const bookmarks = getLocalQuizBookmarks();
  setLocalQuizBookmarks(bookmarks.filter((item) => item.id !== bookmarkId));

  window.dispatchEvent(
    new CustomEvent("quiz-bookmark-removed", {
      detail: { id: bookmarkId },
    })
  );
}

function toggleBookmark() {
  const index = quizState.currentIndex;

  quizState.bookmarks[index] = !quizState.bookmarks[index];

  if (quizState.bookmarks[index]) {
    saveQuizBookmarkToBox(index);
  } else {
    removeQuizBookmarkFromBox(index);
  }

  saveBookmarkedIndexes(quizState);
  renderQuizLayout(getCanvas());
}

// 정답 및 해설을 먼저 본 문제는 오답 처리
function revealAnswerAsWrong() {
  const quiz = quizState.list[quizState.currentIndex];
  const answerData = quizState.answers[quizState.currentIndex] || {};

  if (quiz.type === "SHORT") {
    quizState.answers[quizState.currentIndex] = {
      textAnswer: answerData.textAnswer || "",
      selectedAnswer: answerData.textAnswer || "해설 확인",
      explanation: quiz.explanation,
      isCorrect: false,
      isRevealed: true,
    };

    renderQuizLayout(getCanvas());
    return;
  }

  const selectedIndexes = answerData.selectedIndexes || [];

  quizState.answers[quizState.currentIndex] = {
    selectedIndexes,
    selectedAnswer: selectedIndexes.length
      ? selectedIndexes
          .map((index) => formatOptionLabel(index, quiz.options[index], quiz.type))
          .join(", ")
      : "해설 확인",
    explanation: quiz.explanation,
    isCorrect: false,
    isRevealed: true,
  };

  renderQuizLayout(getCanvas());
}

function renderShortResult(quiz, answer) {
  return `
    <div class="ng-result-short-box">
      <p><strong>내 답안</strong> : ${escapeHtml(answer.textAnswer || "미제출")}</p>
      <p><strong>정답</strong> : ${escapeHtml(quiz.answerText || "정답 정보 없음")}</p>
      <p><strong>해설</strong> : ${escapeHtml(quiz.explanation || "")}</p>
    </div>
  `;
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
    reviewItem.id = `ngQuizReviewItem-${quizIndex}`;
    reviewItem.dataset.quizIndex = quizIndex;
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
                      ${formatOptionLabel(optionIndex, option, quiz.type)}
                    </p>

                    <div class="ng-result-explain-divider"></div>

                    <p class="ng-result-option-explain">
                      ${escapeHtml(getOptionExplanation(quiz, optionIndex))}
                    </p>
                  </div>
                `;
              })
              .join("");

      const bodyHtml = quiz.type === "SHORT"
        ? renderShortResult(quiz, answer)
        : `
          <div class="ng-result-option-list">
            ${optionsHtml}
          </div>

          <div class="ng-result-answer-line">
            정답 : ${escapeHtml(getCorrectAnswerText(quiz))}
          </div>
        `;

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
    </div>

    <button
      class="ng-result-bookmark-btn ${quizState.bookmarks[quizIndex] ? "active" : ""}"
      type="button"
      data-bookmark-index="${quizIndex}"
      title="북마크"
    >
      <svg
        viewBox="0 0 24 24"
        width="17"
        height="17"
        fill="${quizState.bookmarks[quizIndex] ? "currentColor" : "none"}"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  </div>

  ${bodyHtml}
`;

    reviewList.appendChild(reviewItem);
  });

  bindResultBookmarkEvents();
  renderIndexList();
}

function toggleResultBookmark(index) {
  quizState.bookmarks[index] = !quizState.bookmarks[index];

  if (quizState.bookmarks[index]) {
    saveQuizBookmarkToBox(index);
  } else {
    removeQuizBookmarkFromBox(index);
  }

  saveBookmarkedIndexes(quizState);
  renderQuizLayout(getCanvas());
}

function bindResultBookmarkEvents() {
  document.querySelectorAll(".ng-result-bookmark-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.bookmarkIndex);
      toggleResultBookmark(index);
    });
  });
}

// 선택한 옵션으로 새 퀴즈를 생성하고 DB에 저장한 뒤 풀이 화면을 염.
async function createNewQuizFromOptions(options, { shouldRender = () => true } = {}) {
  if (isQuizGenerating) return;

  isQuizGenerating = true;

  const createButton = document.getElementById("ngQuizCreateBtn");

  try {
    const { questionCount, difficulty, types } = options;

    if (shouldRender() && createButton) {
      createButton.disabled = true;
      createButton.textContent = "퀴즈 생성 중...";
    }

    if (shouldRender()) showAiLoading("새 퀴즈 생성 중");

    const chunks = await getChunks({ shouldRender });
    let context = buildContext(chunks);

    if (!context || context.trim().length < 50) {
      context = `
    문서 제목: ${AI_STATE.docTitle || window._docTitle || "제목 없는 문서"}

    주의:
    이 문서는 텍스트 추출량이 부족합니다.
    추출 가능한 문서 제목과 최소 정보만을 바탕으로 쉬운 개념 확인 문제를 생성하세요.
    문서에 없는 구체적인 내용은 만들지 말고, 학습자가 문서 내용을 다시 확인하도록 유도하는 기본 문제를 생성하세요.
    `;
    }

    const prompt = createQuizPrompt({
      title: AI_STATE.docTitle,
      context,
      questionCount,
      difficulty,
      types,
    });


    const questions = await askClaudeJson(prompt, "array");

    const filteredQuestions = filterQuizBySelectedTypes(questions, types);
    let normalizedQuestions = normalizeQuiz(filteredQuestions);

    if (normalizedQuestions.length !== questionCount) {
      throw new Error(
        `선택한 유형(${types.join(", ")})으로 ${questionCount}문제를 생성하지 못했습니다.`
      );
    }

    normalizedQuestions = normalizedQuestions.slice(0, questionCount);

    const quizTitle = createQuizDisplayTitle({
      questionCount,
      difficulty,
    });

    quizState = {
      assetId: null,
      attemptId: null,
      meta: {
        title: quizTitle,
        questionCount,
        difficulty,
        types,
        createdAt: new Date().toISOString(),
      },
      list: normalizedQuestions,
      currentIndex: 0,
      answers: Array(normalizedQuestions.length).fill(null),
      bookmarks: Array(normalizedQuestions.length).fill(false),
      fullscreen: false,
      sidebarWasCollapsed: null,
      showResult: false,
    };

    try {
      const asset = await saveQuizAssetToDb({
        title: quizTitle,
        questionCount,
        difficulty,
        types,
        questions: normalizedQuestions,
        createdAt: new Date().toISOString(),
      });

      quizState.assetId = asset.id;

      if (typeof window.loadKnowledgeAssets === "function") {
        window.loadKnowledgeAssets(AI_STATE.docId || window._currentDocId);
      }
    } catch (dbError) {
      console.warn("퀴즈 DB 저장 실패, 화면에는 임시 퀴즈로 표시합니다:", dbError.message);
    }

      if (shouldRender()) {
        renderQuizLayout(getCanvas());
      }
    } catch (e) {
    console.warn("퀴즈 생성 실패:", e);

    const message = String(e.message || "");

    if (
      message.includes("429") ||
      message.includes("rate") ||
      message.includes("Too Many") ||
      message.includes("요청")
    ) {
      if (shouldRender()) {
        showAiError?.("Claude 요청이 너무 많아 잠시 제한되었습니다. 잠시 후 다시 시도해 주세요.");
      }
      throw e;
    }

    if (shouldRender()) {
      showAiError?.(
        e.message || "퀴즈 생성에 실패했습니다. 문서 내용을 다시 확인해 주세요."
      );
    }

    throw e;
  } finally {
    isQuizGenerating = false;

    if (shouldRender() && createButton) {
      createButton.disabled = false;
      createButton.textContent = "퀴즈 생성하기";
    }
  }
}

// 퀴즈 결과 화면에서 퀴즈 목록 화면으로 돌아간다.
async function backToQuizHome() {
  const wasCollapsed = quizState.sidebarWasCollapsed;

  document.body.classList.remove("quiz-focus-mode");

  const sidebar = document.getElementById("sidebar");
  if (sidebar && wasCollapsed === false) {
    sidebar.classList.remove("collapsed");
  }

  quizState = {
    assetId: null,
    attemptId: null,
    meta: null,
    list: [],
    currentIndex: 0,
    answers: [],
    bookmarks: [],
    fullscreen: false,
    sidebarWasCollapsed: null,
    showResult: false,
  };

  document.body.classList.add("quiz-inline-mode");

  const container = setCanvasMode("quiz");

  showAiLoading("퀴즈 목록 불러오는 중");

  const quizAssets = await loadQuizAssetsFromDb();
  
  renderQuizHome(container, quizAssets, {
    getQuizTitle,
    onCreateQuiz: (options) => {
      enqueueAiTask(
        "quiz",
        () =>
          createNewQuizFromOptions(options, {
            shouldRender: () => true,
          }),
        {
          type: "QUIZ",
          title: window._docTitle || AI_STATE.docTitle || document.title || "문서",
          docId: AI_STATE.docId || window._currentDocId,
        }
      );
    },
    onOpenSolvedQuiz: openSolvedQuiz,
    onOpenUnsolvedQuiz: openUnsolvedQuiz,
  });
}

function toggleFullscreen() {
  const sidebar = document.getElementById("sidebar");

  // 처음 켤 때만 사이드바 원래 상태 저장
  if (!quizState.fullscreen) {
    quizState.sidebarWasCollapsed = sidebar?.classList.contains("collapsed") ?? false;
  }

  quizState.fullscreen = !quizState.fullscreen;

  document.body.classList.toggle("quiz-focus-mode", quizState.fullscreen);

  if (sidebar) {
    if (quizState.fullscreen) {
      // 퀴즈 풀이 중 집중 모드: 사이드바를 숨기는 게 아니라 접기
      sidebar.classList.add("collapsed");
    } else if (quizState.sidebarWasCollapsed === false) {
      // 원래 펼쳐져 있었다면 다시 펼치기
      sidebar.classList.remove("collapsed");
    }
  }

  renderQuizLayout(getCanvas());
}

function finalSubmitAndShowResult() {
  quizState.answers = quizState.list.map((quiz, index) => {
    const answerData = quizState.answers[index] || {};

    if (quiz.type === "SHORT") {
      const textAnswer = answerData.textAnswer || "";
      const wasRevealed = !!answerData.isRevealed;
      const isCorrect = wasRevealed
        ? false
        : isShortAnswerCorrect(textAnswer, quiz);

      return {
        textAnswer,
        selectedAnswer: textAnswer || "미제출",
        explanation: quiz.explanation,
        isCorrect,
        isRevealed: false,
      };
    }

    const selectedIndexes = answerData.selectedIndexes || [];
    const wasRevealed = !!answerData.isRevealed;
    const isCorrect = wasRevealed
      ? false
      : isSameIndexes(selectedIndexes, quiz.answerIndexes);

    return {
      selectedIndexes,
      selectedAnswer: selectedIndexes.length
        ? selectedIndexes
            .map((selectedIndex) =>
              formatOptionLabel(selectedIndex, quiz.options[selectedIndex], quiz.type)
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
  saveAttemptToDb(quizState).then((attemptId) => {
    if (attemptId) quizState.attemptId = attemptId;
  });
}

function isSameIndexes(a, b) {
  if (a.length !== b.length) return false;

  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);

  return sortedA.every((value, index) => value === sortedB[index]);
}




function openSolvedQuiz(asset, attempt) {
  const questions = asset.content.questions || asset.content;

  quizState = {
    assetId: asset.id,
    attemptId: attempt.id,
    meta: asset.content || null,
    list: normalizeQuiz(questions),
    currentIndex: 0,
    answers: restoreAnswers(attempt.answers),
    bookmarks: restoreBookmarks(attempt.bookmarked_indexes, questions.length),
    fullscreen: false,
    sidebarWasCollapsed: null,
    showResult: true,
  };

  renderQuizLayout(getCanvas());
}

function openUnsolvedQuiz(asset) {
  const questions = asset.content.questions || asset.content;

  quizState = {
    assetId: asset.id,
    attemptId: null,
    meta: asset.content || null,
    list: normalizeQuiz(questions),
    currentIndex: 0,
    answers: Array(questions.length).fill(null),
    bookmarks: Array(questions.length).fill(false),
    fullscreen: false,
    sidebarWasCollapsed: null,
    showResult: false,
  };

  renderQuizLayout(getCanvas());
}

// 결과 화면에서 특정 문제 리뷰 카드로 이동한다.
function scrollToQuizReviewItem(index) {
  requestAnimationFrame(() => {
    setTimeout(() => {
      const target = document.getElementById(`ngQuizReviewItem-${index}`);

      if (target) {
        target.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    }, 80);
  });
}

// 북마크함에서 퀴즈 북마크를 눌렀을 때 해당 퀴즈 문제로 이동한다.
window.openQuizBookmark = async function openQuizBookmark(bookmark) {
  if (!bookmark || bookmark.type !== "QUIZ") return;

  let currentDocId = AI_STATE.docId || window._currentDocId || "demo";

  if (bookmark.document_id && bookmark.document_id !== currentDocId) {
    if (typeof window.loadDocInViewer === "function") {
      await window.loadDocInViewer(bookmark.document_id);
      currentDocId = bookmark.document_id;
    } else {
      console.warn("현재 문서의 퀴즈 북마크가 아닙니다.", bookmark);
      return;
    }
  }

  document.body.classList.remove("ai-view-mode");
  document.body.classList.remove("quiz-focus-mode");
  document.body.classList.add("quiz-inline-mode");

  const container = setCanvasMode("quiz");
  showAiLoading("북마크한 퀴즈로 이동 중");

  const quizAssets = await loadQuizAssetsFromDb();

  const asset = quizAssets.find((item) => item.id === bookmark.asset_id);

  if (!asset) {
    container.innerHTML = `
      <div class="ng-quiz-empty">
        북마크한 퀴즈를 찾을 수 없습니다.<br>
        퀴즈가 삭제되었거나 아직 저장되지 않았을 수 있습니다.
      </div>
    `;
    return;
  }

  const latestAttempt = getLatestAttempt(asset);

  if (latestAttempt) {
    openSolvedQuiz(asset, latestAttempt);
    quizState.showResult = true;
  } else {
    openUnsolvedQuiz(asset);
    quizState.showResult = false;
  }

  const targetIndex = Number(bookmark.quiz_index || 0);
  const maxIndex = quizState.list.length - 1;

  quizState.currentIndex = Math.min(Math.max(targetIndex, 0), maxIndex);

  renderQuizLayout(getCanvas());

  if (quizState.showResult) {
    scrollToQuizReviewItem(quizState.currentIndex);
  }
};
