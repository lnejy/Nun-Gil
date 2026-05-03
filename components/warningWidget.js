let warningSecondCount = 0;
let warningTimer = null;
var onCloseWarning = null; // viewer에서 주입하는 닫기 콜백

function formatWarningTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(remainSeconds).padStart(2, "0");

  return `${mm}:${ss}`;
}

function createWarningWidget() {
  // 이미 있으면 또 만들지 않음
  if (document.getElementById("warningOverlay")) return;

  const style = document.createElement("style");
style.innerHTML = `
  .warning-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;

    background: rgba(15, 23, 42, 0.18);
    backdrop-filter: blur(1px);

    display: none;
    align-items: flex-start;
    justify-content: center;

    padding-top: 120px;
    z-index: 9999;
  }

  .warning-widget {
    position: relative;
    width: 300px;
    padding: 26px 22px 22px;

    background: #ffffff;
    border-radius: 20px;
    box-shadow: 0 14px 40px rgba(38, 82, 145, 0.18);

    text-align: center;
    animation: warningPop 0.25s ease;
  }

  .warning-icon {
    width: 54px;
    height: 54px;
    margin: 0 auto 14px;

    display: flex;
    align-items: center;
    justify-content: center;

    background: #eef5ff;
    border-radius: 50%;

    font-size: 28px;
  }

  .warning-widget h2 {
    margin: 0 0 10px;
    font-size: 19px;
    font-weight: 800;
    color: #1f2937;
  }

  .warning-widget p {
    margin: 0 0 15px;
    font-size: 13px;
    line-height: 1.55;
    color: #6b7280;
  }

  .warning-timer {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 400;
  color: #ef4444;
}

  .warning-check-btn {
  width: 100%;
  height: 42px;

  border: none;
  border-radius: 13px;

  background: linear-gradient(180deg, #8bb5f6 0%, #73a2f0 100%);
  color: white;

  font-size: 14px;
  font-weight: 500;
  cursor: pointer;

  transition: 0.2s ease;
}

.warning-check-btn:hover {
  background: linear-gradient(180deg, #7faaf3 0%, #6597e8 100%);
  box-shadow: 0 8px 18px rgba(111, 163, 239, 0.3);
}



  .warning-close {
    position: absolute;
    top: 12px;
    right: 15px;

    border: none;
    background: transparent;

    font-size: 22px;
    color: #9ca3af;
    cursor: pointer;
  }

  .warning-close:hover {
    color: #4b5563;
  }

  @keyframes warningPop {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.96);
    }

    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
`;


  document.head.appendChild(style);

  const warningHTML = `
    <div id="warningOverlay" class="warning-overlay">
      <div class="warning-widget">
        <button class="warning-close" id="warningCloseBtn">×</button>

        <div class="warning-icon">⚠️</div>

        <h2>집중이 흐트러졌어요</h2>
        <p>
          화면 밖을 오래 바라보거나 얼굴이 감지되지 않았어요.<br>
          다시 화면을 바라봐 주세요.
        </p>

        <div class="warning-timer">
        <span id="warningSeconds">00:00</span>초
      </div>

        <button class="warning-check-btn" id="warningCheckBtn">
          확인
        </button>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", warningHTML);

  document
    .getElementById("warningCloseBtn")
    .addEventListener("click", closeWarning);

  document
    .getElementById("warningCheckBtn")
    .addEventListener("click", closeWarning);
}

function showWarning() {
  createWarningWidget();

  const warningOverlay = document.getElementById("warningOverlay");
  const warningSeconds = document.getElementById("warningSeconds");

  warningOverlay.style.display = "flex";

  warningSecondCount = 0;
  warningSeconds.textContent = formatWarningTime(warningSecondCount);

  clearInterval(warningTimer);

  warningTimer = setInterval(() => {
    warningSecondCount++;
    warningSeconds.textContent = formatWarningTime(warningSecondCount);
  }, 1000);
}

function closeWarning() {
  const warningOverlay = document.getElementById("warningOverlay");

  if (warningOverlay) {
    warningOverlay.style.display = "none";
  }

  clearInterval(warningTimer);

  if (typeof onCloseWarning === "function") onCloseWarning();
}