// ── 전역 상태 ─────────────────────────────────────────────
let isBookmarkMode = false;
let bookmarkCount  = 0;
let bookmarksData  = {};

// ── 문서 ID (localStorage 키 구분용) ──────────────────────
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

    // 북마크 복원
    loadBookmarks();
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
   북마크 localStorage 저장/복원
══════════════════════════════════════════════════════════ */
function saveBookmarks() {
    const key   = `nungil_bm_${getDocId()}`;
    const items = Object.entries(bookmarksData).map(([id, data]) => {
        const tag = document.getElementById(data.tagElementId);
        return { id, top: tag ? parseFloat(tag.style.top) : 0, ...data };
    });
    localStorage.setItem(key, JSON.stringify({ count: bookmarkCount, items }));
}

function loadBookmarks() {
    const key = `nungil_bm_${getDocId()}`;
    const raw = localStorage.getItem(key);
    if (!raw) return;

    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return; }

    bookmarkCount = parsed.count || 0;
    const canvas  = document.querySelector('.paper-canvas');
    if (!canvas) return;

    (parsed.items || []).forEach(item => {
        bookmarksData[item.id] = {
            title: item.title, content: item.content,
            color: item.color, tagElementId: item.tagElementId,
        };

        const tag = document.createElement('div');
        tag.id          = item.tagElementId;
        tag.className   = `bookmark-tag tag-${item.color}`;
        tag.style.top   = `${item.top}px`;
        tag.innerText   = item.title || `[${item.id}]`;
        tag.dataset.id  = item.id;
        tag.dataset.color = item.color;
        tag.onclick = (e) => {
            e.stopPropagation();
            const existing = tag.querySelector('.bookmark-popup');
            if (existing) existing.remove(); else showBookmarkPopup(tag);
        };
        canvas.appendChild(tag);
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

function createBookmarkIndexTag(topPosition, targetSpan) {
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
