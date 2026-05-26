// ── 전역 상태 ─────────────────────────────────────────────
let isBookmarkMode = false;
let bookmarkCount  = 0;
let bookmarksData  = {};

// 문서 전환 시 북마크 상태 초기화 (viewer.html에서 호출)
window._resetBookmarks = function() {
    bookmarkCount = 0;
    bookmarksData = {};
};

// ── 문서 ID (localStorage 키 구분용) ──────────────────────
function getDocId() {
    return new URLSearchParams(location.search).get('doc_id') || 'default';
}

// 퀴즈 북마크 localStorage key를 만든다.
function getQuizBookmarkStorageKey(docId = getDocId()) {
    return `ng_bookmarks_quiz_${docId || 'demo'}`;
}

// 현재 문서의 퀴즈 북마크를 localStorage에서 불러온다.
function getLocalQuizBookmarksForModal() {
    const docId = window._currentDocId || getDocId() || 'demo';

    try {
        return JSON.parse(localStorage.getItem(getQuizBookmarkStorageKey(docId)) || '[]');
    } catch {
        return [];
    }
}

// 퀴즈 북마크를 localStorage에서 삭제한다.
function removeLocalQuizBookmark(bookmarkId, docId) {
    const targetDocId = docId || window._currentDocId || getDocId() || 'demo';

    // 1. 북마크함 localStorage에서 삭제
    const bookmarkKey = getQuizBookmarkStorageKey(targetDocId);

    try {
        const items = JSON.parse(localStorage.getItem(bookmarkKey) || '[]');
        localStorage.setItem(
            bookmarkKey,
            JSON.stringify(items.filter((item) => item.id !== bookmarkId))
        );
    } catch {
        localStorage.setItem(bookmarkKey, '[]');
    }

    // 2. 퀴즈 풀이 기록 localStorage의 bookmarked_indexes에서도 삭제
    try {
        const parts = String(bookmarkId).split('_');
        const quizIndex = Number(parts[parts.length - 1]);

        if (Number.isNaN(quizIndex)) return;

        const assetKey = `ng_quiz_assets_${targetDocId}`;
        const assets = JSON.parse(localStorage.getItem(assetKey) || '[]');

        const nextAssets = assets.map((asset) => ({
            ...asset,
            quiz_attempts: (asset.quiz_attempts || []).map((attempt) => ({
                ...attempt,
                bookmarked_indexes: (attempt.bookmarked_indexes || []).filter(
                    (index) => index !== quizIndex
                ),
            })),
        }));

        localStorage.setItem(assetKey, JSON.stringify(nextAssets));
    } catch (e) {
        console.warn('퀴즈 풀이 기록 북마크 삭제 실패:', e.message);
    }
}

// ── DOMContentLoaded ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    // 사이드바 토글
    const sidebar   = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const isCollapsed = sidebar.classList.toggle('collapsed');
            toggleBtn.textContent = isCollapsed ? '⟩' : '⟨';
        });
    }

    // 메모장 복원 & 자동저장 등록
    initMemoStorage();

    // 북마크는 viewer.html 모듈에서 pdf-rendered 이벤트 시 loadBookmarks() 호출
});

/* ══════════════════════════════════════════════════════════
   메모장  (Supabase document_notes 연동 + localStorage 캐시)
══════════════════════════════════════════════════════════ */
let _noteDebounceTimer = null;

function togNote() {
    const s   = document.getElementById('noteSb');
    const btn = document.getElementById('noteBtn');
    const et  = document.getElementById('etP');

    s.classList.toggle('open');
    const isOpen = s.classList.contains('open');
    if (btn) btn.classList.toggle('active', isOpen);

    if (isOpen) {
        if (et && et.classList.contains('min')) et.style.right = '370px';
        setTimeout(() => { document.querySelector('.note-ta')?.focus({ preventScroll: true }); }, 300);
    } else {
        if (et && et.classList.contains('min')) et.style.right = '24px';
    }
}

function initMemoStorage() {
    const ta = document.querySelector('.note-ta');
    if (!ta) return;
    _loadMemoContent(ta);
    ta.addEventListener('input', () => {
        // 즉시 localStorage 캐시 → 타이핑 끊김 없음
        localStorage.setItem(`nungil_note_${getDocId()}`, ta.value);
        // 1초 debounce 후 DB 저장
        clearTimeout(_noteDebounceTimer);
        _noteDebounceTimer = setTimeout(() => { _saveNoteToDB(getDocId(), ta.value); }, 1000);
    });
}

async function _loadMemoContent(ta) {
    const docId = getDocId();
    const userId = window._userId;
    // localStorage로 먼저 표시 (빠른 렌더)
    ta.value = localStorage.getItem(`nungil_note_${docId}`) || '';
    // DB에서 실제 값 덮어씌우기
    if (userId && docId && docId !== 'default' && window._getNote) {
        try {
            const content = await window._getNote(userId, docId);
            ta.value = content;
            localStorage.setItem(`nungil_note_${docId}`, content);
        } catch (e) {
            console.warn('[메모] DB 로드 실패, localStorage 사용:', e.message);
        }
    }
}

async function _saveNoteToDB(docId, content) {
    const userId = window._userId;
    if (!userId || !docId || docId === 'default' || !window._upsertNote) return;
    try {
        await window._upsertNote(userId, docId, content);
    } catch (e) {
        console.warn('[메모] DB 저장 실패:', e.message);
    }
}

window.reloadMemoForDoc = function () {
    const ta = document.querySelector('.note-ta');
    if (ta) _loadMemoContent(ta);
};

// 메모 저장 버튼 핸들러
async function saveNote() {
    const ta  = document.querySelector('.note-ta');
    const msg = document.getElementById('noteSaveMsg');
    if (!ta || !msg) return;
    const docId = getDocId();
    localStorage.setItem(`nungil_note_${docId}`, ta.value);
    await _saveNoteToDB(docId, ta.value);
    msg.style.display = 'block';
    setTimeout(() => { msg.style.display = 'none'; }, 2000);
}

/* ══════════════════════════════════════════════════════════
   북마크 저장/복원 (Supabase + localStorage 병행)
══════════════════════════════════════════════════════════ */
async function saveBookmarkToDb(bmId, data, positionY) {
    const sb = window.sb;
    if (!sb || !window._currentDocId) return;
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;

    await sb.from('bookmarks').upsert({
        id:               data.dbId ?? undefined,
        user_id:          user.id,
        document_id:      window._currentDocId,
        workspace_id:     window._workspaceId ?? null,
        position_y:       positionY,
        title:            data.title || `북마크 ${bmId}`,
        memo:             data.content || '',
        color:            data.color || 'blue',
        highlighted_text: data.highlighted_text || '',
    }, { onConflict: 'id' }).select('id').single().then(({ data: row }) => {
        if (row?.id) bookmarksData[bmId].dbId = row.id;
    });
}

async function deleteBookmarkFromDb(dbId) {
    const sb = window.sb;
    if (!sb || !dbId) return;
    await sb.from('bookmarks').delete().eq('id', dbId);
}

function saveBookmarks() {
    // localStorage 로컬 캐시
    const key   = `nungil_bm_${getDocId()}`;
    const items = Object.entries(bookmarksData).map(([id, data]) => {
        const tag = document.getElementById(data.tagElementId);
        return { id, top: tag ? parseFloat(tag.style.top) : 0, ...data };
    });
    localStorage.setItem(key, JSON.stringify({ count: bookmarkCount, items }));
}


window.loadBookmarks = loadBookmarks;
async function loadBookmarks() {
    const docId = getDocId();
    if (!docId || docId === 'default') return;
    const sb = window.sb;

    // Supabase에서 먼저 불러오기 시도
    if (sb) {
        try {
            const { data: rows } = await sb
                .from('bookmarks')
                .select('*')
                .eq('document_id', docId)
                .order('created_at', { ascending: true });

            if (rows && rows.length > 0) {
                _renderBookmarks(rows.map(r => ({
                    id:           bookmarkCount + 1,
                    dbId:         r.id,
                    top:          r.position_y,
                    title:        r.title,
                    content:      r.memo,
                    color:        r.color,
                    tagElementId: `bm-tag-${r.id}`,
                    highlighted_text: r.highlighted_text,
                })));
                return;
            }
        } catch (e) { console.warn('북마크 DB 로드 실패:', e.message); }
    }

    // fallback: localStorage
    const key = `nungil_bm_${docId}`;
    const raw = localStorage.getItem(key);
    if (!raw) return;
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return; }
    _renderBookmarks(parsed.items || []);
}

function _renderBookmarks(items) {
    const bmCanvas = document.querySelector('.paper-canvas');
    if (!bmCanvas) return;

    items.forEach((item, idx) => {
        // DB에서 복원 시 고유 ID 보장
        const localId = item.id || (bookmarkCount + idx + 1);
        const tagElemId = item.tagElementId || `bm-tag-${item.dbId || localId}`;

        bookmarkCount = Math.max(bookmarkCount, Number(localId));
        bookmarksData[localId] = {
            dbId: item.dbId, title: item.title, content: item.content,
            color: item.color, tagElementId: tagElemId,
            highlighted_text: item.highlighted_text,
        };

        const tag = document.createElement('div');
        tag.id             = tagElemId;
        tag.className      = `bookmark-tag tag-${item.color || 'blue'}`;
        tag.style.top      = `${item.top}px`;
        tag.innerText      = item.title || `[${localId}]`;
        tag.dataset.id     = localId;
        tag.dataset.color  = item.color || 'blue';
        if (item.dbId) tag.dataset.dbId = item.dbId;   // 북마크함 이동에 사용
        tag.onclick = (e) => {
            e.stopPropagation();
            const existing = tag.querySelector('.bookmark-popup');
            if (existing) existing.remove(); else showBookmarkPopup(tag);
        };
        bmCanvas.appendChild(tag);
    });
}

/* ══════════════════════════════════════════════════════════
   북마크 생성
══════════════════════════════════════════════════════════ */
document.querySelector('.paper-canvas').addEventListener('mouseup', function (e) {
    if (!isBookmarkMode) return;

    const selection    = window.getSelection();
    const selectedText = selection.toString().trim();
    const canvasRect   = this.getBoundingClientRect();
    let yPos, targetSpan = null;

    if (selectedText !== '') {
        const range  = selection.getRangeAt(0);
        targetSpan   = document.createElement('span');
        targetSpan.className = 'highlight-blue';
        try {
            range.surroundContents(targetSpan);
            yPos = targetSpan.getBoundingClientRect().top - canvasRect.top;
        } catch (err) { return; }
    } else {
        yPos = e.clientY - canvasRect.top;
    }

    createBookmarkIndexTag(yPos, targetSpan);
    selection.removeAllRanges();
    toggleBookmarkMode();
});

const colorPalette = [
    { name: 'blue',   code: '#78a3ea' },
    { name: 'yellow', code: '#ffd43b' },
    { name: 'green',  code: '#82c91e' },
    { name: 'pink',   code: '#ff92ad' },
    { name: 'purple', code: '#be4bdb' },
];

function getNextBookmarkId() {
    // 1부터 시작해서 빈 번호를 찾아 반환
    let id = 1;
    while (bookmarksData[id]) id++;
    return id;
}

function createBookmarkIndexTag(topPosition, targetSpan) {
    const newId = getNextBookmarkId();
    bookmarkCount = Math.max(bookmarkCount, newId);
    const canvas       = document.querySelector('.paper-canvas');
    const initialColor = 'blue';
    const tagId        = `tag-id-${newId}`;

    const tag         = document.createElement('div');
    tag.id            = tagId;
    tag.className     = `bookmark-tag tag-${initialColor}`;
    tag.dataset.id    = newId;
    tag.dataset.color = initialColor;

    // 중첩 방지
    let finalTop       = topPosition;
    const existingTags = document.querySelectorAll('.bookmark-tag');
    const step         = 18;
    let collision      = true;
    while (collision) {
        collision = false;
        for (let t of existingTags) {
            if (Math.abs(finalTop - parseFloat(t.style.top)) < 18) {
                finalTop += step; collision = true; break;
            }
        }
    }
    tag.style.top = `${finalTop}px`;
    tag.innerText = `[${newId}]`;

    bookmarksData[newId] = {
        title: '', content: '', color: initialColor, tagElementId: tagId,
    };

    if (targetSpan) tag.targetSpan = targetSpan;

    tag.onclick = (e) => {
        e.stopPropagation();
        const existing = tag.querySelector('.bookmark-popup');
        if (existing) existing.remove(); else showBookmarkPopup(tag);
    };

    canvas.appendChild(tag);
    showBookmarkPopup(tag);
    saveBookmarks();
    // Supabase에도 저장
    saveBookmarkToDb(newId, bookmarksData[newId], finalTop);
}

/* ══════════════════════════════════════════════════════════
   북마크 팝업
══════════════════════════════════════════════════════════ */
function showBookmarkPopup(tag) {
    document.querySelectorAll('.bookmark-popup').forEach(p => p.remove());

    const id        = tag.dataset.id;
    const savedData = bookmarksData[id] || { title: '', content: '', color: tag.dataset.color };

    const popup = document.createElement('div');
    popup.className = 'bookmark-popup';

    const paletteHTML = colorPalette.map(c => `
        <div class="color-dot tag-${c.name} ${savedData.color === c.name ? 'active' : ''}"
             onclick="updateBookmarkColor('${id}', '${c.name}', this)"></div>
    `).join('');

    popup.innerHTML = `
        <div class="popup-header">
            <span>북마크 설정</span>
            <button class="popup-close-btn" id="closePopup">&times;</button>
        </div>
        <div class="popup-color-selector">${paletteHTML}</div>
        <input type="text" class="popup-input" id="btitle" placeholder="제목" value="${savedData.title}">
        <textarea class="popup-textarea" id="bcontent" placeholder="메모 내용">${savedData.content}</textarea>
        <button class="popup-save-btn">설정 저장하기</button>
    `;

    popup.onclick = (e) => e.stopPropagation();

    popup.querySelector('#closePopup').onclick = (e) => {
        e.stopPropagation();
        popup.remove();
    };

    popup.querySelector('.popup-save-btn').onclick = () => {
        const title   = document.getElementById('btitle').value.trim();
        const content = document.getElementById('bcontent').value;

        bookmarksData[id] = {
            ...(bookmarksData[id] || {}),
            title, content, color: tag.dataset.color,
        };

        // 팝업 제거 → 태그 텍스트 업데이트
        popup.remove();
        tag.innerText = title || `[${id}]`;

        // innerText 교체 후 onclick 재등록
        tag.onclick = (e) => {
            e.stopPropagation();
            const existing = tag.querySelector('.bookmark-popup');
            if (existing) existing.remove(); else showBookmarkPopup(tag);
        };

        saveBookmarks();
        // Supabase 업데이트
        const posY = parseFloat(tag.style.top) || 0;
        saveBookmarkToDb(id, bookmarksData[id], posY);
    };

    tag.appendChild(popup);
}

function updateBookmarkColor(id, colorName, dotElement) {
    const tag = document.querySelector(`.bookmark-tag[data-id="${id}"]`);
    if (!tag) return;
    tag.dataset.color = colorName;
    tag.className     = `bookmark-tag tag-${colorName}`;
    if (tag.targetSpan) tag.targetSpan.className = `highlight-${colorName}`;
    dotElement.parentElement.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
    dotElement.classList.add('active');
}

function toggleBookmarkMode() {
    isBookmarkMode = !isBookmarkMode;
    const btn = document.getElementById('bookmarkBtn');
    document.body.classList.toggle('bookmark-mode', isBookmarkMode);
    btn?.classList.toggle('active', isBookmarkMode);
}

/* ══════════════════════════════════════════════════════════
   북마크함 모달
══════════════════════════════════════════════════════════ */
async function togBookmarkList() {
    const overlay = document.getElementById('bookmarkOverlay');
    const grid    = document.querySelector('.bm-modal-grid');
    const isActive = overlay.classList.toggle('show');

    if (!isActive) { document.body.style.overflow = ''; return; }

    document.body.style.overflow = 'hidden';
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#a0a6b0;padding:40px;">불러오는 중...</div>';

    // Supabase에서 워크스페이스 전체 북마크 조회
    const sb = window.sb;
    let allBookmarks = [];

    if (sb) {
        try {
            if (window._workspaceId) {
                // 워크스페이스 내 모든 문서 ID 조회 후 북마크 필터링
                const { data: docs } = await sb
                    .from('documents')
                    .select('id')
                    .eq('workspace_id', window._workspaceId);
                const docIds = (docs || []).map(d => d.id);
                if (docIds.length > 0) {
                    const { data, error } = await sb
                        .from('bookmarks')
                        .select('*, documents(file_name)')
                        .in('document_id', docIds)
                        .order('created_at', { ascending: false });
                    if (error) throw error;
                    allBookmarks = data || [];
                }
            } else if (window._currentDocId) {
                const { data, error } = await sb
                    .from('bookmarks')
                    .select('*, documents(file_name)')
                    .eq('document_id', window._currentDocId)
                    .order('created_at', { ascending: false });
                if (error) throw error;
                allBookmarks = data || [];
            }
        } catch (e) { console.warn('북마크함 로드 실패:', e.message); }
    }

    // Supabase 결과 없으면 현재 문서 로컬 북마크 fallback
    if (!allBookmarks.length) {
        allBookmarks = Object.entries(bookmarksData).map(([id, data]) => ({
            id: data.dbId, title: data.title, memo: data.content,
            color: data.color, position_y: parseFloat(document.getElementById(data.tagElementId)?.style.top) || 0,
            document_id: window._currentDocId,
            documents: { file_name: document.title.replace('눈길 — ', '') },
            _localId: id,
        }));
    }

    // ── 퀴즈 북마크 조회 ─────────────────────────────
    // 1) DB 연결 전 테스트: quiz.js가 저장한 localStorage 북마크 먼저 읽기
    let quizBookmarks = getLocalQuizBookmarksForModal().map((bookmark) => ({
        source: 'local',
        id: bookmark.id,
        type: 'QUIZ',
        document_id: bookmark.document_id,
        asset_id: bookmark.asset_id,
        attempt_id: bookmark.attempt_id || null,
        quiz_index: Number(bookmark.quiz_index || 0),
        title: bookmark.title || `Q${Number(bookmark.quiz_index || 0) + 1}`,
        quiz_title: bookmark.quiz_title || '퀴즈',
        question_text: bookmark.content?.question || bookmark.title || '퀴즈 문제',
    }));

    // 2) 실제 DB 연결 후: quiz_attempts.bookmarked_indexes에서도 읽기
    if (sb) {
        try {
            const { data: { user } } = await sb.auth.getUser();

            if (user) {
                const targetDocIds = [];

                if (window._workspaceId) {
                    const { data: docs } = await sb
                        .from('documents')
                        .select('id')
                        .eq('workspace_id', window._workspaceId);

                    (docs || []).forEach((d) => targetDocIds.push(d.id));
                } else if (window._currentDocId) {
                    targetDocIds.push(window._currentDocId);
                }

                if (targetDocIds.length) {
                    const { data: attempts } = await sb
                        .from('quiz_attempts')
                        .select('id, document_id, asset_id, bookmarked_indexes, answers, documents(file_name)')
                        .eq('user_id', user.id)
                        .in('document_id', targetDocIds)
                        .order('attempted_at', { ascending: false });

                    const seen = new Set();

                    (attempts || []).forEach((attempt) => {
                        if (
                            seen.has(attempt.document_id) ||
                            !Array.isArray(attempt.bookmarked_indexes) ||
                            !attempt.bookmarked_indexes.length
                        ) {
                            return;
                        }

                        seen.add(attempt.document_id);

                        attempt.bookmarked_indexes.forEach((quizIndex) => {
                            const answer = Array.isArray(attempt.answers)
                                ? attempt.answers[quizIndex]
                                : null;

                            quizBookmarks.push({
                                source: 'db',
                                id: `${attempt.id}_${quizIndex}`,
                                type: 'QUIZ',
                                document_id: attempt.document_id,
                                asset_id: attempt.asset_id,
                                attempt_id: attempt.id,
                                quiz_index: quizIndex,
                                title: `Q${quizIndex + 1}. ${answer?.question || '퀴즈 문제'}`,
                                quiz_title: attempt.documents?.file_name || '퀴즈',
                                question_text: answer?.question || '퀴즈 문제',
                            });
                        });
                    });
                }
            }
        } catch (e) {
            console.warn('퀴즈 북마크 로드 실패:', e.message);
        }
    }

    // 같은 퀴즈 문제 북마크 중복 제거
    quizBookmarks = quizBookmarks.filter((bookmark, index, arr) => {
        const key = `${bookmark.document_id}_${bookmark.asset_id}_${bookmark.quiz_index}`;
        return arr.findIndex((item) => `${item.document_id}_${item.asset_id}_${item.quiz_index}` === key) === index;
    });

    grid.innerHTML = '';

    const hasDocBm = allBookmarks.length > 0;
    const hasQuizBm = quizBookmarks.length > 0;

    if (!hasDocBm && !hasQuizBm) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#a0a6b0;padding:40px;">저장된 북마크가 없습니다.</div>';
        return;
    }

    // ── 퀴즈 북마크 섹션 ──
    if (hasQuizBm) {
        const qbHeader = document.createElement('div');
        qbHeader.className = 'bm-section-header';
        qbHeader.innerHTML = `
            <svg class="bm-section-icon" viewBox="0 0 24 24" width="16" height="16">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
            <span>퀴즈 북마크</span>
            <span class="bm-section-count">${quizBookmarks.length}개</span>
        `;
        grid.appendChild(qbHeader);

        quizBookmarks.forEach(qb => {
            const fname = (qb.quiz_title ?? qb.file_name ?? '퀴즈')
                .replace(/^눈길\s*[-–—:]*\s*/i, '')
                .replace(/\.(pdf|ppt|pptx)$/i, '').trim() || '문서';
            const card = document.createElement('div');
            card.className = 'bm-card quiz-bm-card';
            card.innerHTML = `
                <div class="bm-card-top">
                    <span class="bm-asset-badge quiz-badge">
                        <svg class="bm-badge-icon" viewBox="0 0 24 24" width="11" height="11">
                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                        </svg>
                        Q${qb.quiz_index + 1}
                    </span>
                    <button class="bm-delete-btn qb-del" data-attempt-id="${qb.attempt_id}" data-qi="${qb.quiz_index}" title="북마크 해제">×</button>
                </div>
                <div class="bm-body">
                    <h3 class="bm-title bm-quiz-title">${fname}</h3>
                    <p class="bm-content">${qb.question_text || '퀴즈 문제'}</p>
                </div>
            `;

            card.querySelector('.qb-del').addEventListener('click', async (e) => {
                e.stopPropagation();

                const qi = Number(e.currentTarget.dataset.qi);

                // localStorage 퀴즈 북마크 삭제
                if (qb.source === 'local') {
                    removeLocalQuizBookmark(qb.id, qb.document_id);
                }

                // DB 퀴즈 북마크 삭제
                if (qb.source === 'db' && sb && qb.attempt_id) {
                    try {
                        const { data: row } = await sb
                            .from('quiz_attempts')
                            .select('bookmarked_indexes')
                            .eq('id', qb.attempt_id)
                            .maybeSingle();

                        if (row) {
                            const updated = (row.bookmarked_indexes || []).filter((i) => i !== qi);

                            await sb
                                .from('quiz_attempts')
                                .update({ bookmarked_indexes: updated })
                                .eq('id', qb.attempt_id);
                        }
                    } catch (e) {
                        console.warn('퀴즈 북마크 삭제 실패:', e.message);
                    }
                }

                card.remove();

                if (!grid.querySelector('.quiz-bm-card')) qbHeader.remove();

                if (!grid.querySelector('.bm-card')) {
                    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#a0a6b0;padding:40px;">저장된 북마크가 없습니다.</div>';
                }
            });

            card.onclick = async () => {
                overlay.classList.remove('show');
                document.body.style.overflow = '';

                if (qb.document_id !== window._currentDocId && typeof window.loadDocInViewer === 'function') {
                    await window.loadDocInViewer(qb.document_id);
                }

                setTimeout(() => {
                    if (typeof window.openQuizBookmark === 'function') {
                        window.openQuizBookmark({
                            type: 'QUIZ',
                            document_id: qb.document_id,
                            asset_id: qb.asset_id,
                            attempt_id: qb.attempt_id || null,
                            quiz_index: qb.quiz_index,
                            title: qb.title,
                            quiz_title: qb.quiz_title,
                            content: {
                                question: qb.question_text,
                            },
                        });
                        return;
                    }

                    const toolBtn = document.querySelector('.sb-tool-item[data-ai-tool="quiz"]');
                    if (toolBtn) toolBtn.click();
                }, qb.document_id !== window._currentDocId ? 500 : 50);
            };
            grid.appendChild(card);
        });
    }

    // ── 문서 북마크 섹션 ──
    if (hasDocBm) {
        if (hasQuizBm) {
            const docHeader = document.createElement('div');
            docHeader.className = 'bm-section-header';
            docHeader.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
                <span>문서 북마크</span>
                <span style="font-size:11px;font-weight:500;color:#94a3b8;">${allBookmarks.length}개</span>
            `;
            grid.appendChild(docHeader);
        }

        allBookmarks.forEach(bm => {
            const colorCode = colorPalette.find(c => c.name === bm.color)?.code || '#ddd';
            const isOtherDoc = bm.document_id !== window._currentDocId;
            const card = document.createElement('div');
            card.className = 'bm-card';
            card.innerHTML = `
                <div class="bm-card-top">
                    <span class="bm-dot" style="background:${colorCode};"></span>
                    ${isOtherDoc ? `<span style="font-size:10px;color:#94a3b8;margin-left:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px">${bm.documents?.file_name ?? ''}</span>` : ''}
                    <button class="bm-delete-btn" title="삭제">×</button>
                </div>
                <div class="bm-body">
                    <h3 class="bm-title">${bm.title || '제목 없음'}</h3>
                    <p class="bm-content">${bm.memo || '내용이 비어있습니다.'}</p>
                </div>
            `;

            card.querySelector('.bm-delete-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (bm.id) await deleteBookmarkFromDb(bm.id);
                const localEntry = Object.entries(bookmarksData).find(([, d]) => d.dbId === bm.id);
                if (localEntry) {
                    const [localId, data] = localEntry;
                    document.getElementById(data.tagElementId)?.remove();
                    delete bookmarksData[localId];
                    saveBookmarks();
                }
                card.remove();
                if (!grid.querySelector('.bm-card')) {
                    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#a0a6b0;padding:40px;">저장된 북마크가 없습니다.</div>';
                }
            });
            card.onclick = async () => {
                overlay.classList.remove('show');
                document.body.style.overflow = '';

                // AI 모드(퀴즈/요약/마인드맵)면 먼저 원본으로 전환
                const pdfContainer = document.getElementById('pdfContainer');
                const isAiMode = pdfContainer?.classList.contains('ai-mode');
                if (isAiMode) {
                    const origBtn = document.querySelector('.sb-tool-item[data-ai-tool="original"]');
                    if (origBtn) origBtn.click();
                }

                if (isOtherDoc && typeof window.loadDocInViewer === 'function') {
                    await window.loadDocInViewer(bm.document_id);
                }

                const waitAndScroll = (retries = 0) => {
                    const tagEl = document.querySelector(`.bookmark-tag[data-db-id="${bm.id}"]`)
                               || (() => {
                                   const localEntry = Object.values(bookmarksData).find(d => d.dbId === bm.id);
                                   return localEntry ? document.getElementById(localEntry.tagElementId) : null;
                               })();
                    if (tagEl) {
                        tagEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    } else if (retries < 10) {
                        setTimeout(() => waitAndScroll(retries + 1), 300);
                    } else {
                        const wrapper = document.querySelector('.main-wrapper');
                        if (wrapper) wrapper.scrollTo({ top: bm.position_y, behavior: 'smooth' });
                    }
                };
                setTimeout(() => waitAndScroll(), isAiMode || isOtherDoc ? 500 : 50);
            };
            grid.appendChild(card);
        });
    }
}

document.getElementById('bookmarkOverlay').addEventListener('click', function (e) {
    if (e.target === this) togBookmarkList();
});
