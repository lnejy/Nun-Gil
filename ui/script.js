// ── 전역 상태 ─────────────────────────────────────────────
let isBookmarkMode = false;
let bookmarkCount  = 0;
let bookmarksData  = {};

// ── 문서 ID ──────────────────────────────────────────────
function getDocId() {
    return new URLSearchParams(location.search).get('doc_id') || 'default';
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

    // 기존 localStorage 북마크 데이터 정리 (DB 전용 전환)
    localStorage.removeItem(`nungil_bm_${getDocId()}`);

    // 북마크는 viewer.html 모듈에서 syncBookmarksFromDb() 호출 시 DB에서 로드
});

/* ══════════════════════════════════════════════════════════
   메모장
══════════════════════════════════════════════════════════ */
function togNote() {
    const s   = document.getElementById('noteSb');
    const btn = document.getElementById('noteBtn');
    s.classList.toggle('open');
    if (btn) btn.classList.toggle('active', s.classList.contains('open'));
    if (s.classList.contains('open')) {
        setTimeout(() => { document.querySelector('.note-ta')?.focus(); }, 400);
    }
}

function initMemoStorage() {
    const ta = document.querySelector('.note-ta');
    if (!ta) return;
    const key   = `nungil_note_${getDocId()}`;
    const saved = localStorage.getItem(key);
    if (saved) ta.value = saved;
    ta.addEventListener('input', () => localStorage.setItem(key, ta.value));
}

/* ══════════════════════════════════════════════════════════
   북마크 저장/복원 (Supabase DB 전용)
══════════════════════════════════════════════════════════ */

// ── 저장: Supabase DB에만 저장 ──
function saveBookmarks() {
    saveBookmarksToDb();
}

async function saveBookmarksToDb() {
    const sb     = window._sb;
    const userId = window._userId;
    const docId  = getDocId();
    if (!sb || !userId || !docId || docId === 'default') return;

    try {
        for (const [id, data] of Object.entries(bookmarksData)) {
            const tag  = document.getElementById(data.tagElementId);
            const posY = tag ? parseFloat(tag.style.top) : 0;

            const row = {
                title:            data.title || null,
                memo:             data.content || null,
                color:            data.color || 'blue',
                position_y:       posY,
                highlighted_text: data.highlightedText || null,
            };

            if (data._dbId) {
                await sb.from('bookmarks').update(row).eq('id', data._dbId);
            } else {
                const { data: inserted, error } = await sb
                    .from('bookmarks')
                    .insert({
                        ...row,
                        user_id:      userId,
                        document_id:  docId,
                        workspace_id: window._workspaceId || null,
                    })
                    .select('id')
                    .single();

                if (!error && inserted) {
                    data._dbId = inserted.id;
                }
            }
        }
    } catch (e) {
        console.warn('북마크 DB 저장 실패:', e.message);
    }
}

// ── DB에서 북마크 로드 (viewer.html 모듈에서 호출) ──
async function syncBookmarksFromDb() {
    const sb    = window._sb;
    const docId = getDocId();
    if (!sb || !docId || docId === 'default') return;

    try {
        const { data, error } = await sb
            .from('bookmarks')
            .select('*')
            .eq('document_id', docId)
            .order('created_at', { ascending: true });

        if (error) throw error;
        if (!data || data.length === 0) return;

        const canvas = document.querySelector('.paper-canvas');
        if (!canvas) return;

        // 기존 DOM 태그 제거
        canvas.querySelectorAll('.bookmark-tag').forEach(t => t.remove());
        bookmarksData = {};
        bookmarkCount = 0;

        data.forEach((row, idx) => {
            const num   = idx + 1;
            bookmarkCount = Math.max(bookmarkCount, num);
            const tagId = `tag-id-${num}`;

            bookmarksData[num] = {
                title:           row.title || '',
                content:         row.memo || '',
                color:           row.color || 'blue',
                tagElementId:    tagId,
                highlightedText: row.highlighted_text || '',
                _dbId:           row.id,
            };

            const tag = document.createElement('div');
            tag.id          = tagId;
            tag.className   = `bookmark-tag tag-${row.color || 'blue'}`;
            tag.style.top   = `${row.position_y || 0}px`;
            tag.innerText   = row.title || `[${num}]`;
            tag.dataset.id  = num;
            tag.dataset.color = row.color || 'blue';
            tag.onclick = (e) => {
                e.stopPropagation();
                const existing = tag.querySelector('.bookmark-popup');
                if (existing) existing.remove();
                else showBookmarkPopup(tag);
            };
            canvas.appendChild(tag);
        });

        console.log('DB 북마크 로드 완료:', data.length, '개');
    } catch (e) {
        console.warn('DB 북마크 로드 실패:', e.message);
    }
}

// ── DB에서 북마크 삭제 ──
async function deleteBookmarkFromDb(dbId) {
    const sb = window._sb;
    if (!sb || !dbId) return;
    try {
        await sb.from('bookmarks').delete().eq('id', dbId);
    } catch (e) {
        console.warn('북마크 DB 삭제 실패:', e.message);
    }
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

    createBookmarkIndexTag(yPos, targetSpan, selectedText);
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

function createBookmarkIndexTag(topPosition, targetSpan, highlightedText) {
    bookmarkCount++;
    const canvas       = document.querySelector('.paper-canvas');
    const initialColor = 'blue';
    const tagId        = `tag-id-${bookmarkCount}`;

    const tag         = document.createElement('div');
    tag.id            = tagId;
    tag.className     = `bookmark-tag tag-${initialColor}`;
    tag.dataset.id    = bookmarkCount;
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
    tag.innerText = `[${bookmarkCount}]`;

    bookmarksData[bookmarkCount] = {
        title: '', content: '', color: initialColor, tagElementId: tagId,
        highlightedText: highlightedText || '',
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
            <span>북마크 #${id} 설정</span>
            <button class="popup-close-btn" id="closePopup">&times;</button>
        </div>
        <div class="popup-color-selector">${paletteHTML}</div>
        <input type="text" class="popup-input" id="btitle" placeholder="제목" value="${savedData.title}">
        <textarea class="popup-textarea" id="bcontent" placeholder="메모 내용">${savedData.content}</textarea>
        <button class="popup-save-btn">설정 저장하기</button>
        <button class="popup-delete-btn" style="margin-top:6px;width:100%;padding:8px;border:none;border-radius:6px;background:#fee2e2;color:#dc2626;font-size:13px;cursor:pointer;">북마크 삭제</button>
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

        popup.remove();
        tag.innerText = title || `[${id}]`;

        tag.onclick = (e) => {
            e.stopPropagation();
            const existing = tag.querySelector('.bookmark-popup');
            if (existing) existing.remove(); else showBookmarkPopup(tag);
        };

        saveBookmarks();
    };

    // 삭제 버튼
    popup.querySelector('.popup-delete-btn').onclick = () => {
        const dbId = bookmarksData[id]?._dbId;
        delete bookmarksData[id];
        popup.remove();
        tag.remove();
        if (dbId) deleteBookmarkFromDb(dbId);
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
function togBookmarkList() {
    const overlay = document.getElementById('bookmarkOverlay');
    const grid    = document.querySelector('.bm-modal-grid');
    const isActive = overlay.classList.toggle('show');

    if (isActive) {
        grid.innerHTML = '';
        const keys = Object.keys(bookmarksData);

        if (keys.length === 0) {
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#a0a6b0;padding:40px;">저장된 북마크가 없습니다.</div>';
        } else {
            keys.forEach(id => {
                const data = bookmarksData[id];
                const card = document.createElement('div');
                card.className = 'bm-card';
                card.innerHTML = `
                    <div class="bm-card-top">
                        <span class="bm-num">No.${String(id).padStart(2, '0')}</span>
                        <span class="bm-dot" style="background:${colorPalette.find(c => c.name === data.color)?.code || '#ddd'};"></span>
                    </div>
                    <div class="bm-body">
                        <h3 class="bm-title">${data.title || '제목 없음'}</h3>
                        <p class="bm-content">${data.content || '내용이 비어있습니다.'}</p>
                        ${data.highlightedText ? `<p class="bm-highlight" style="font-size:12px;color:#6b7280;margin-top:6px;font-style:italic;">"${data.highlightedText.slice(0, 80)}${data.highlightedText.length > 80 ? '...' : ''}"</p>` : ''}
                    </div>
                `;
                card.onclick = () => {
                    const target = document.getElementById(bookmarksData[id].tagElementId);
                    if (target) {
                        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        togBookmarkList();
                    } else {
                        alert('삭제되었거나 찾을 수 없는 북마크입니다.');
                    }
                };
                grid.appendChild(card);
            });
        }
        document.body.style.overflow = 'hidden';
    } else {
        document.body.style.overflow = '';
    }
}

document.getElementById('bookmarkOverlay').addEventListener('click', function (e) {
    if (e.target === this) togBookmarkList();
});
