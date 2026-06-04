// ui/ai/index.js
// viewer.html과 AI 기능을 연결하는 진입점.
// viewer.html은 버튼과 PDF URL만 제공하고, 실제 기능은 각 파일로 분리한다.

// ui/ai/index.js
console.log("AI index.js loaded");
import {
  clearAiMode,
  initAiState,
  showAiError,
  showAiStatusScreen,
  enqueueAiTask,
  getAiCache,
  loadAssetFromDb,
  getAiAssetJob,
} from "./common.js";

import { loadSummary } from "./summary.js";
import { loadMindmap } from "./mindmap.js";
import { loadQuiz } from "./quiz.js";
import "./help.js";

let initialized = false;
let currentTool = null;  // 현재 사용자가 보고 있는 도구

window.addEventListener("viewer-init", () => {
  console.log("AI viewer-init received");
  if (initialized) return;
  initialized = true;

  initAiState();
bindAiButtons();
restoreToolFromUrl();
});

// 문서 in-place 전환 시 AI state 재초기화 + 원본 버튼으로 초기화
window.addEventListener("doc-changed", async (e) => {
  initAiState();

  currentTool = "original";
  updateAiUrl("original");

  document.querySelectorAll(".sb-tool-item").forEach(btn =>
    btn.classList.remove("active")
  );

  const origBtn = document.querySelector('.sb-tool-item[data-ai-tool="original"]');
  if (origBtn) origBtn.classList.add("active");

  // loadDocInViewer에서 이미 PDF를 렌더한 경우 중복 렌더 방지
  if (e.detail?.skipRender) {
    clearAiMode();
    document.body.classList.remove(
      "quiz-inline-mode",
      "quiz-fullscreen-mode",
      "summary-mode",
      "mindmap-mode",
      "quiz-mode",
      "ai-view-mode"
    );
    const container = document.getElementById("pdfContainer");
    if (container) {
      container.classList.remove(
        "summary-mode",
        "quiz-mode",
        "mindmap-mode",
        "ai-loading-mode"
      );
    }
    return;
  }

  await renderOriginalDocument();
});

async function hasExistingSummary() {
  const cache = getAiCache();

  if (cache.summary) {
    return true;
  }

  const saved = await loadAssetFromDb("SUMMARY");
  return !!saved;
}

async function hasExistingMindmap() {
  const cache = getAiCache();

  if (cache.mindmap) {
    return true;
  }

  const saved = await loadAssetFromDb("MINDMAP");
  return !!saved;
}

function getCurrentDocId() {
  return window._currentDocId || new URLSearchParams(location.search).get("doc_id") || "demo";
}

function renderAiJobStatusIfNeeded(type, label) {
  const job = getAiAssetJob(type, getCurrentDocId());

  if (!job) return false;

  if (job.status === "PENDING" || job.status === "RUNNING" || job.status === "ERROR") {
    showAiStatusScreen({
      toolLabel: label,
      status: job.status,
    });

    return true;
  }

  return false;
}

window.addEventListener("ai-asset-status-changed", async () => {
  if (currentTool === "summary") {
    const job = getAiAssetJob("SUMMARY", getCurrentDocId());

    if (!job) return;

    if (job.status === "PENDING" || job.status === "RUNNING" || job.status === "ERROR") {
      showAiStatusScreen({
        toolLabel: "요약",
        status: job.status,
      });
      return;
    }

    if (job.status === "DONE") {
      await loadSummary({
        shouldRender: () => currentTool === "summary",
      });
    }
  }

  if (currentTool === "mindmap") {
    const job = getAiAssetJob("MINDMAP", getCurrentDocId());

    if (!job) return;

    if (job.status === "PENDING" || job.status === "RUNNING" || job.status === "ERROR") {
      showAiStatusScreen({
        toolLabel: "마인드맵",
        status: job.status,
      });
      return;
    }

    if (job.status === "DONE") {
      await loadMindmap({
        shouldRender: () => currentTool === "mindmap",
      });
    }
  }
});

function bindAiButtons() {
  document.querySelectorAll(".sb-tool-item[data-ai-tool]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const tool = btn.dataset.aiTool;

      // 사용자 의도를 즉시 기록
      currentTool = tool;
      setActiveButton(btn);
      updateAiUrl(tool);

      if (tool === "original") {
        await renderOriginalDocument();
        return;
      }

      // 클릭 시점의 도구를 캡처
      const requestedTool = tool;

      // 요약은 API 생성 가능성이 있으므로 queue에 넣음
      if (tool === "summary") {
        try {
          // 1. 이미 생성 중/대기 중이면 본문 상태 화면 즉시 표시
          if (renderAiJobStatusIfNeeded("SUMMARY", "요약")) {
            return;
          }

          // 2. queue 상태가 없을 때만 기존 생성물 확인
          if (await hasExistingSummary()) {
            await loadSummary({
              shouldRender: () => currentTool === requestedTool,
            });
            return;
          }

          // 3. 없을 때만 새 작업을 queue에 추가
          const added = enqueueAiTask(
            "summary",
            async () => {
              try {
                await loadSummary({
                  shouldRender: () => currentTool === requestedTool,
                });
              } catch (err) {
                if (currentTool === requestedTool) {
                  console.error(err);
                  showAiError(err.message);
                }
                throw err;
              }
            },
            {
              type: "SUMMARY",
              title: window._docTitle || document.title || "문서",
              docId: getCurrentDocId(),
            }
          );

          if (added && currentTool === requestedTool) {
            showAiStatusScreen({
              toolLabel: "요약",
              status: "PENDING",
            });
          }
        } catch (err) {
          if (currentTool !== requestedTool) return;
          console.error(err);
          showAiError(err.message);
        }

        return;
      }

      // 마인드맵도 API 생성 가능성이 있으므로 queue에 넣음
      if (tool === "mindmap") {
        try {
          // 1. 이미 생성 중/대기 중이면 본문 상태 화면 즉시 표시
          if (renderAiJobStatusIfNeeded("MINDMAP", "마인드맵")) {
            return;
          }

          // 2. queue 상태가 없을 때만 기존 생성물 확인
          if (await hasExistingMindmap()) {
            await loadMindmap({
              shouldRender: () => currentTool === requestedTool,
            });
            return;
          }

          // 3. 없을 때만 새 작업을 queue에 추가
          const added = enqueueAiTask(
            "mindmap",
            async () => {
              try {
                await loadMindmap({
                  shouldRender: () => currentTool === requestedTool,
                });
              } catch (err) {
                if (currentTool === requestedTool) {
                  console.error(err);
                  showAiError(err.message);
                }
                throw err;
              }
            },
            {
              type: "MINDMAP",
              title: window._docTitle || document.title || "문서",
              docId: getCurrentDocId(),
            }
          );

          if (added && currentTool === requestedTool) {
            showAiStatusScreen({
              toolLabel: "마인드맵",
              status: "PENDING",
            });
          }
        } catch (err) {
          if (currentTool !== requestedTool) return;
          console.error(err);
          showAiError(err.message);
        }

        return;
      }

      // quiz 버튼은 "퀴즈 목록 화면"을 여는 기능
      // 실제 퀴즈 생성 API는 quiz.js의 "퀴즈 생성하기" 버튼에서 queue 처리
      if (tool === "quiz") {
        try {
          await loadQuiz({
            shouldRender: () => currentTool === requestedTool,
          });
        } catch (err) {
          if (currentTool !== requestedTool) return;
          console.error(err);
          showAiError(err.message);
        }

        return;
      }
    });
  });
}

async function renderOriginalDocument() {
  clearAiMode();

  document.body.classList.remove(
    "quiz-inline-mode",
    "quiz-fullscreen-mode",
    "summary-mode",
    "mindmap-mode",
    "quiz-mode",
    "ai-view-mode"
  );

  const container = document.getElementById("pdfContainer");

  if (container) {
    container.classList.remove(
      "summary-mode",
      "quiz-mode",
      "mindmap-mode",
      "ai-loading-mode"
    );

    container.innerHTML = `<div class="pdf-loading">문서 로딩 중...</div>`;
    container.scrollTop = 0;
  }

  // 북마크 상태 초기화 (AI 모드에서 DOM이 비워졌으므로)
  document.querySelectorAll('.bookmark-tag').forEach(el => el.remove());
  if (typeof window._resetBookmarks === 'function') window._resetBookmarks();

  if (window._layoutJsonUrl && typeof window.renderLayoutViewer === "function") {
    await window.renderLayoutViewer(window._layoutJsonUrl, {
      containerId: "pdfContainer",
      pdfUrl: window._pdfUrl,
    });
  } else if (window._pdfUrl && typeof window.renderPdf === "function") {
    await window.renderPdf(window._pdfUrl);
  } else if (container) {
    container.innerHTML = `<div class="pdf-no-content">문서를 불러올 수 없습니다.</div>`;
  }

  // 렌더 완료 후 북마크 복원
  if (typeof window.loadBookmarks === 'function') {
    window.loadBookmarks();
  }
}

function setActiveButton(activeBtn) {
  document.querySelectorAll(".sb-tool-item").forEach((btn) => {
    btn.classList.remove("active");
  });
  activeBtn.classList.add("active");
}

function updateAiUrl(tool) {
  const url = new URL(location.href)

  if (tool === "original") {
    url.searchParams.delete("ai")
  } else {
    url.searchParams.set("ai", tool)
  }

  history.replaceState({}, "", url)
}

function restoreToolFromUrl() {
  const params = new URLSearchParams(location.search)
  const tool = params.get("ai")

  if (!tool) {
    currentTool = "original"

    const btn = document.querySelector(`.sb-tool-item[data-ai-tool="original"]`)
    if (btn) setActiveButton(btn)

    return
  }

  const btn = document.querySelector(`.sb-tool-item[data-ai-tool="${tool}"]`)
  if (btn) btn.click()
}