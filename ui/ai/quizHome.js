// 퀴즈 목록, 퀴즈 생성 화면

import { escapeHtml } from "./common.js";


// 퀴즈 생성 옵션과 기존 퀴즈 목록을 화면에 그림
export function renderQuizHome(container, quizAssets = [], handlers = {}) {
  const { getQuizTitle, onCreateQuiz, onOpenSolvedQuiz, onOpenUnsolvedQuiz } = handlers;

  const sortedQuizAssets = [...quizAssets].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at)
  );

  const itemsHtml = sortedQuizAssets.length
    ? sortedQuizAssets
        .map((asset, index) => renderQuizAssetItem(asset, getQuizTitle, index))
        .join("")
    : `<div class="ng-quiz-home-empty">아직 생성된 퀴즈가 없습니다.</div>`;

  container.innerHTML = `
    <section class="ng-quiz-home">
      <div class="ng-quiz-home-panel">
        <div class="ng-quiz-home-header">
          <div>
            <div class="ng-quiz-badge">퀴즈</div>
            <h1 class="ng-quiz-title">${escapeHtml(getQuizTitle?.() || "문서")}</h1>
            <p class="ng-quiz-desc">원하는 조건으로 새 퀴즈를 만들거나 이전 퀴즈를 다시 확인하세요.</p>
          </div>
        </div>

        <div class="ng-quiz-create-card">
          <h2 class="ng-quiz-home-subtitle">새 퀴즈 만들기</h2>

          <div class="ng-quiz-form-grid">
            <div class="ng-quiz-form-group">
              <label>문제 수</label>
              <div class="ng-quiz-chip-row" data-quiz-field="questionCount">
                <button class="ng-quiz-chip active" type="button" data-value="5">5문제</button>
                <button class="ng-quiz-chip" type="button" data-value="10">10문제</button>
              </div>
            </div>

            <div class="ng-quiz-form-group">
              <label>난이도</label>
              <div class="ng-quiz-chip-row" data-quiz-field="difficulty">
                <button class="ng-quiz-chip active" type="button" data-value="easy">낮음</button>
                <button class="ng-quiz-chip" type="button" data-value="normal">보통</button>
                <button class="ng-quiz-chip" type="button" data-value="hard">높음</button>
              </div>
            </div>

            <div class="ng-quiz-form-group full">
              <label>문제 유형 (복수 선택 가능)</label>
              <div class="ng-quiz-chip-row multi" data-quiz-field="types">
                <button class="ng-quiz-chip active" type="button" data-value="MULTIPLE">객관식</button>
                <button class="ng-quiz-chip" type="button" data-value="OX">O/X</button>
                <button class="ng-quiz-chip" type="button" data-value="SHORT">단답형</button>
              </div>
            </div>
          </div>

          <button id="ngQuizCreateBtn" class="ng-quiz-primary-btn" type="button">
            퀴즈 생성하기
          </button>
        </div>

        <div class="ng-quiz-list-card">
          <h2 class="ng-quiz-home-subtitle">이전에 생성한 퀴즈</h2>
          <div class="ng-quiz-asset-list">
            ${itemsHtml}
          </div>
        </div>
      </div>
    </section>
  `;

  bindQuizHomeEvents(sortedQuizAssets, {
    onCreateQuiz,
    onOpenSolvedQuiz,
    onOpenUnsolvedQuiz,
  });
}

// 기존 퀴즈 목록 아이템 HTML을 만듦.
function renderQuizAssetItem(asset, getQuizTitle, index) {
  const content = asset.content || {};
  const questions = content.questions || content || [];
  const questionCount = content.questionCount || questions.length || 0;
  const difficulty = getDifficultyLabel(content.difficulty);
  const types = getTypeLabels(content.types || []);

  const latestAttempt = getLatestAttempt(asset);
  const scoreText = latestAttempt
    ? `${latestAttempt.score ?? 0}점`
    : "미풀이";

  const createdText = formatQuizDate(asset.created_at);

  return `
    <button class="ng-quiz-asset-item" type="button" data-asset-id="${asset.id}">
      <div>
        <div class="ng-quiz-asset-title">
          ${escapeHtml(`${index + 1}. ${getQuizTitle?.() || "문서"} 퀴즈`)}
        </div>
        <div class="ng-quiz-asset-meta">
          ${questionCount}문제 · ${difficulty} · ${types}
        </div>
      </div>
      <div class="ng-quiz-asset-side">
        <span>${escapeHtml(scoreText)}</span>
        <small>${escapeHtml(createdText)}</small>
      </div>
    </button>
  `;
}

// 퀴즈 홈 화면 버튼 이벤트를 연결
function bindQuizHomeEvents(quizAssets, handlers = {}) {
  const { onCreateQuiz, onOpenSolvedQuiz, onOpenUnsolvedQuiz } = handlers;

  document.querySelectorAll(".ng-quiz-chip-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      const button = e.target.closest(".ng-quiz-chip");
      if (!button) return;

      const isMulti = row.classList.contains("multi");

      if (isMulti) {
        button.classList.toggle("active");

        if (!row.querySelector(".ng-quiz-chip.active")) {
          button.classList.add("active");
        }

        return;
      }

      row.querySelectorAll(".ng-quiz-chip").forEach((btn) => {
        btn.classList.remove("active");
      });

      button.classList.add("active");
    });
  });

  document
    .getElementById("ngQuizCreateBtn")
    ?.addEventListener("click", () => {
      onCreateQuiz?.(getSelectedQuizOptions());
    });

  document.querySelectorAll(".ng-quiz-asset-item").forEach((button) => {
    button.addEventListener("click", () => {
      const asset = quizAssets.find((item) => item.id === button.dataset.assetId);
      if (!asset) return;

      const latestAttempt = getLatestAttempt(asset);

      if (latestAttempt) {
        onOpenSolvedQuiz?.(asset, latestAttempt);
      } else {
        onOpenUnsolvedQuiz?.(asset);
      }
    });
  });
}

// 사용자가 선택한 퀴즈 생성 옵션을 가져옴.
function getSelectedQuizOptions() {
  const selectedQuestionCount = Number(
    document.querySelector('[data-quiz-field="questionCount"] .active')?.dataset.value || 5
  );

  const questionCount = [5, 10].includes(selectedQuestionCount)
    ? selectedQuestionCount
    : 5;

  const difficulty =
    document.querySelector('[data-quiz-field="difficulty"] .active')?.dataset.value || "normal";

  const types = Array.from(
    document.querySelectorAll('[data-quiz-field="types"] .active')
  ).map((button) => button.dataset.value);

  return {
    questionCount,
    difficulty,
    types: types.length ? types : ["MULTIPLE"],
  };
}

// 난이도 값을 화면 표시용 한글로 바꿈.
export function getDifficultyLabel(value) {
  return {
    easy: "낮음",
    normal: "보통",
    hard: "높음",
  }[value] || "보통";
}

// 문제 유형 값을 화면 표시용 한글로 바꿈.
function getTypeLabels(types) {
  const labelMap = {
    MULTIPLE: "객관식",
    OX: "O/X",
    SHORT: "단답형",
  };

  if (!Array.isArray(types) || !types.length) return "객관식";

  return types.map((type) => labelMap[type] || type).join(", ");
}

// 퀴즈 생성일을 짧게 표시
function formatQuizDate(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

// 퀴즈에 연결된 가장 최근 풀이 기록을 가져옴.
export function getLatestAttempt(asset) {
  const attempts = asset.quiz_attempts || [];
  if (!attempts.length) return null;

  return [...attempts].sort(
    (a, b) => new Date(b.attempted_at) - new Date(a.attempted_at)
  )[0];
}