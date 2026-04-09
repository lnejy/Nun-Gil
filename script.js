document.addEventListener('DOMContentLoaded', () => {
    // 1. 왼쪽 사이드바 토글
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('sidebarToggle');

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const isCollapsed = sidebar.classList.toggle('collapsed');
            toggleBtn.textContent = isCollapsed ? '⟩' : '⟨';
        });
    }
});

// 2. 우측 플로팅 메모장 토글 (사용자 제공 로직 보강)
function togNote() {
    const s = document.getElementById('noteSb');
    const btn = document.getElementById('noteBtn');

    // 클래스 토글
    s.classList.toggle('open');

    // 버튼 활성화 상태 표시
    if (btn) {
        btn.classList.toggle('active', s.classList.contains('open'));
    }

    // 열릴 때 자동 포커스
    if (s.classList.contains('open')) {
        setTimeout(() => {
            document.querySelector('.note-ta').focus();
        }, 400); // 애니메이션 끝난 후 포커스
    }
}

let isBookmarkMode = false;
let bookmarkCount = 0;
let bookmarksData = {}; // 데이터를 저장할 객체

function toggleBookmarkMode() {
    isBookmarkMode = !isBookmarkMode;
    const body = document.body;
    const btn = document.getElementById('bookmarkBtn');
    body.classList.toggle('bookmark-mode', isBookmarkMode);
    btn?.classList.toggle('active', isBookmarkMode);
}

document.querySelector('.paper-canvas').addEventListener('mouseup', function (e) {
    if (!isBookmarkMode) return;

    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    const canvasRect = this.getBoundingClientRect(); // 종이 기준
    let yPos, targetSpan = null;

    if (selectedText !== "") {
        const range = selection.getRangeAt(0);
        targetSpan = document.createElement('span');
        targetSpan.className = 'highlight-blue';

        try {
            range.surroundContents(targetSpan);
            // 종이 상단 기준 좌표 계산
            yPos = targetSpan.getBoundingClientRect().top - canvasRect.top;
        } catch (err) { return; }
    } else {
        // 단순 클릭 시 종이 상단 기준 좌표 계산
        yPos = e.clientY - canvasRect.top;
    }

    createBookmarkIndexTag(yPos, targetSpan);
    selection.removeAllRanges();
    toggleBookmarkMode();
});

// 사용할 색상 리스트
const colorPalette = [
    { name: 'blue', code: '#78a3ea' },
    { name: 'yellow', code: '#ffd43b' },
    { name: 'green', code: '#82c91e' },
    { name: 'pink', code: '#ff92ad' },
    { name: 'purple', code: '#be4bdb' }
];

function createBookmarkIndexTag(topPosition, targetSpan) {
    bookmarkCount++;
    const canvas = document.querySelector('.paper-canvas');

    // 1. 태그 생성
    const tag = document.createElement('div');
    const initialColor = 'blue';
    const tagId = `tag-id-${bookmarkCount}`; // 태그 자체의 ID

    tag.id = tagId;
    tag.className = `bookmark-tag tag-${initialColor}`;
    // 중첩 방지 로직을 거친 최종 topPosition 사용
    let finalTop = topPosition;

    // --- [중첩 방지 로직] ---
    const existingTags = document.querySelectorAll('.bookmark-tag');
    const step = 18;
    let collision = true;
    while (collision) {
        collision = false;
        for (let tag of existingTags) {
            const tagTop = parseFloat(tag.style.top);
            if (Math.abs(finalTop - tagTop) < 18) {
                finalTop = tagTop + step;
                collision = true;
                break;
            }
        }
    }

    tag.style.top = `${finalTop}px`;
    tag.innerText = `[${bookmarkCount}]`;
    tag.dataset.id = bookmarkCount;
    tag.dataset.color = initialColor;

    // 2. 데이터 저장 (무조건 이 태그의 ID를 목적지로 저장)
    bookmarksData[bookmarkCount] = {
        title: '',
        content: '',
        color: initialColor,
        tagElementId: tagId // 이동할 목적지는 바로 이 '번호 태그'
    };

    if (targetSpan) tag.targetSpan = targetSpan;

    tag.onclick = (e) => {
        e.stopPropagation();
        const existing = tag.querySelector('.bookmark-popup');
        if (existing) existing.remove(); else showBookmarkPopup(tag);
    };

    canvas.appendChild(tag);
    showBookmarkPopup(tag);
}

function showBookmarkPopup(tag) {
    document.querySelectorAll('.bookmark-popup').forEach(p => p.remove());

    const id = tag.dataset.id;
    // 저장된 데이터가 있으면 가져오고, 없으면 기본값
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

    // [기존] 저장 버튼 클릭 시: 데이터 객체에 반영 후 제거
    popup.querySelector('.popup-save-btn').onclick = () => {
        // 기존에 저장된 데이터(특히 targetId)를 가져와서 덮어씁니다.
        const existingData = bookmarksData[id] || {};

        bookmarksData[id] = {
            ...existingData, // targetId 등 기존 정보 유지
            title: document.getElementById('btitle').value,
            content: document.getElementById('bcontent').value,
            color: tag.dataset.color
        };
        popup.remove();
    };

    tag.appendChild(popup);
}

function updateBookmarkColor(id, colorName, dotElement) {
    const tag = document.querySelector(`.bookmark-tag[data-id="${id}"]`);
    tag.dataset.color = colorName;
    tag.className = `bookmark-tag tag-${colorName}`;
    if (tag.targetSpan) tag.targetSpan.className = `highlight-${colorName}`;
    dotElement.parentElement.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
    dotElement.classList.add('active');
}

function togBookmarkList() {
    const overlay = document.getElementById('bookmarkOverlay');
    const grid = document.querySelector('.bm-modal-grid');
    const isActive = overlay.classList.toggle('show');

    if (isActive) {
        grid.innerHTML = '';
        const keys = Object.keys(bookmarksData);

        if (keys.length === 0) {
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #a0a6b0; padding: 40px;">저장된 북마크가 없습니다.</div>';
        } else {
            keys.forEach((id) => {
                const data = bookmarksData[id];
                const card = document.createElement('div');
                card.className = 'bm-card';

                card.innerHTML = `
                    <div class="bm-card-top">
                        <span class="bm-num">No.${String(id).padStart(2, '0')}</span>
                        <span class="bm-dot" style="background: ${colorPalette.find(c => c.name === data.color)?.code || '#ddd'};"></span>
                    </div>
                    <div class="bm-body">
                        <h3 class="bm-title">${data.title || '제목 없음'}</h3>
                        <p class="bm-content">${data.content || '내용이 비어있습니다.'}</p>
                    </div>
                `;

                // togBookmarkList 함수 내 카드 클릭 이벤트 부분
                card.onclick = () => {
                    const data = bookmarksData[id];
                    // 생성할 때 저장했던 번호 태그(인덱스)를 찾음
                    const targetTag = document.getElementById(data.tagElementId);

                    if (targetTag) {
                        // 인덱스 태그 위치로 부드럽게 이동
                        targetTag.scrollIntoView({
                            behavior: 'smooth',
                            block: 'center'
                        });

                        // 이동 후 북마크함 닫기
                        togBookmarkList();
                    } else {
                        alert('삭제되었거나 찾을 수 없는 인덱스입니다.');
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

// 오버레이 바깥쪽 배경 클릭 시 닫기
document.getElementById('bookmarkOverlay').addEventListener('click', function (e) {
    if (e.target === this) {
        togBookmarkList();
    }
});