// DB/API 관련 함수만 분리

import { AI_STATE } from "./common.js";
import { sb } from "/src/lib/supabase.js";


// DB 연결 전 테스트용 저장소
const QUIZ_TEST_MODE = true;

// 문서별 퀴즈 목록 저장 key
function getQuizStorageKey() {
  const docId = AI_STATE.docId || window._currentDocId || "demo";
  return `ng_quiz_assets_${docId}`;
}

// 문서별 퀴즈 북마크함 저장 key
function getQuizBookmarkStorageKey() {
  const docId = AI_STATE.docId || window._currentDocId || "demo";
  return `ng_bookmarks_quiz_${docId}`;
}

export async function saveBookmarkedIndexes(quizState) {
  const indexes = quizState.bookmarks
    .map((v, i) => (v ? i : -1))
    .filter((i) => i >= 0);

  if (QUIZ_TEST_MODE) {
    if (!quizState.assetId) return;

    const assets = getLocalQuizAssets();

    const nextAssets = assets.map((asset) => {
      if (asset.id !== quizState.assetId) return asset;

      const attempts = asset.quiz_attempts || [];

      if (!attempts.length) {
        return asset;
      }

      const nextAttempts = attempts.map((attempt, attemptIndex) => {
        if (quizState.attemptId && attempt.id !== quizState.attemptId) {
          return attempt;
        }

        if (!quizState.attemptId && attemptIndex !== 0) {
          return attempt;
        }

        return {
          ...attempt,
          bookmarked_indexes: indexes,
        };
      });

      return {
        ...asset,
        quiz_attempts: nextAttempts,
      };
    });

    setLocalQuizAssets(nextAssets);
    return;
  }

  try {
    const docId = AI_STATE.docId || window._currentDocId;
    if (!sb || !docId) return;

    const {
      data: { user },
    } = await sb.auth.getUser();

    if (!user) return;

    if (quizState.attemptId) {
      await sb
        .from("quiz_attempts")
        .update({ bookmarked_indexes: indexes })
        .eq("id", quizState.attemptId);

      return;
    }

    if (!quizState.assetId) return;

    const { data: row } = await sb
      .from("quiz_attempts")
      .select("id")
      .eq("document_id", docId)
      .eq("asset_id", quizState.assetId)
      .order("attempted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!row) return;

    quizState.attemptId = row.id;

    await sb
      .from("quiz_attempts")
      .update({ bookmarked_indexes: indexes })
      .eq("id", row.id);
  } catch (e) {
    console.warn("퀴즈 북마크 저장 실패:", e.message);
  }
}

// 임시 id 생성
function createLocalId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// localStorage에서 퀴즈 목록 불러오기
function getLocalQuizAssets() {
  try {
    return JSON.parse(localStorage.getItem(getQuizStorageKey()) || "[]");
  } catch {
    return [];
  }
}

// localStorage에 퀴즈 목록 저장
function setLocalQuizAssets(assets) {
  localStorage.setItem(getQuizStorageKey(), JSON.stringify(assets));
}

// localStorage에서 퀴즈 북마크함 불러오기
export function getLocalQuizBookmarks() {
  try {
    return JSON.parse(localStorage.getItem(getQuizBookmarkStorageKey()) || "[]");
  } catch {
    return [];
  }
}

// localStorage에 퀴즈 북마크함 저장
export function setLocalQuizBookmarks(bookmarks) {
  localStorage.setItem(getQuizBookmarkStorageKey(), JSON.stringify(bookmarks));
}

export async function saveQuizAssetToDb(content) {
  if (QUIZ_TEST_MODE) {
    const assets = getLocalQuizAssets();

    const newAsset = {
      id: createLocalId("quiz_asset"),
      content,
      created_at: new Date().toISOString(),
      quiz_attempts: [],
    };

    setLocalQuizAssets([newAsset, ...assets]);
    return newAsset;
  }

  const docId = AI_STATE.docId || window._currentDocId;
  if (!sb || !docId) throw new Error("문서 정보가 없습니다.");

  const { data, error } = await sb
    .from("learning_assets")
    .insert({
      document_id: docId,
      type: "QUIZ",
      status: "DONE",
      content,
    })
    .select("id, content, created_at")
    .single();

  if (error) throw error;
  return data;
}

// 저장된 퀴즈(자산)와 연결된 풀이 기록을 함께 삭제
export async function deleteQuizAsset(assetId) {
  if (!assetId) return;

  if (QUIZ_TEST_MODE) {
    const assets = getLocalQuizAssets();
    setLocalQuizAssets(assets.filter((asset) => asset.id !== assetId));
    return;
  }

  if (!sb) throw new Error("DB 연결이 없습니다.");

  // FK 제약 대비: 연결된 풀이 기록 먼저 삭제
  await sb.from("quiz_attempts").delete().eq("asset_id", assetId);

  const { error } = await sb
    .from("learning_assets")
    .delete()
    .eq("id", assetId);

  if (error) throw error;
}

export async function loadQuizAssetsFromDb() {
  if (QUIZ_TEST_MODE) {
    return getLocalQuizAssets();
  }

  const docId = AI_STATE.docId || window._currentDocId;
  if (!sb || !docId) return [];

  const { data, error } = await sb
    .from("learning_assets")
    .select(`
      id,
      content,
      created_at,
      quiz_attempts (
        id,
        score,
        correct_count,
        total_questions,
        answers,
        bookmarked_indexes,
        attempted_at
      )
    `)
    .eq("document_id", docId)
    .eq("type", "QUIZ")
    .eq("status", "DONE")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("퀴즈 목록 로드 실패:", error.message);
    return [];
  }

  return data || [];
}

// ── DB 저장 ────────────────────────────────────────────
export async function saveAttemptToDb(quizState) {
  const docId = AI_STATE.docId || window._currentDocId || "demo";

  try {
    const assetId = quizState.assetId;

    if (!assetId) {
      console.warn("현재 퀴즈 asset_id가 없어 기록을 저장하지 못했습니다.");
      return null;
    }

    const { list, answers } = quizState;
    const total = list.length;
    const correct = answers.filter((a) => a?.isCorrect).length;

    const answerRecords = list.map((q, i) => ({
      type: q.type,
      question: q.question,
      options: q.options || [],
      selectedIndexes: answers[i]?.selectedIndexes || [],
      textAnswer: answers[i]?.textAnswer || "",
      answerIndexes: q.answerIndexes || [],
      answerText: q.answerText || "",
      acceptableAnswers: q.acceptableAnswers || [],
      selectedAnswer: answers[i]?.selectedAnswer || "",
      isCorrect: !!answers[i]?.isCorrect,
      explanation: q.explanation || "",
      optionExplanations: q.optionExplanations || [],
    }));

    const bookmarkedIndexes = quizState.bookmarks
      .map((v, i) => (v ? i : -1))
      .filter((i) => i >= 0);

    if (QUIZ_TEST_MODE) {
      const attempt = {
        id: createLocalId("quiz_attempt"),
        score: Math.round((correct / total) * 100),
        correct_count: correct,
        total_questions: total,
        answers: answerRecords,
        bookmarked_indexes: bookmarkedIndexes,
        attempted_at: new Date().toISOString(),
      };

      const assets = getLocalQuizAssets();

      const nextAssets = assets.map((asset) => {
        if (asset.id !== assetId) return asset;

        return {
          ...asset,
          quiz_attempts: [attempt, ...(asset.quiz_attempts || [])],
        };
      });

      setLocalQuizAssets(nextAssets);

      console.log("테스트 모드: 퀴즈 결과 저장 완료");
      return attempt.id;
    }

    if (!sb || !docId || docId === "demo") return null;

    const {
      data: { user },
    } = await sb.auth.getUser();

    if (!user) return null;

    const { data: attempt, error } = await sb
      .from("quiz_attempts")
      .insert({
        user_id: user.id,
        document_id: docId,
        asset_id: assetId,
        session_id: window._currentSessionId || null,
        total_questions: total,
        correct_count: correct,
        score: Math.round((correct / total) * 100),
        answers: answerRecords,
        bookmarked_indexes: bookmarkedIndexes,
      })
      .select("id")
      .single();

    if (error) throw error;

    console.log("퀴즈 결과 저장 완료");
    return attempt.id;
  } catch (e) {
    console.warn("퀴즈 결과 저장 실패:", e.message);
    return null;
  }
}