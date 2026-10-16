/* PNTT Audio Player - Tối ưu mượt mà và đầy đủ tính năng */
const PLAYLIST_URLS = {
  P1: "playlists/playlist_P1.json",
  P2: "playlists/playlist_P2.json"
};

const $ = (s) => document.querySelector(s);
const audio = $("#audioPlayer");

const state = {
  part: "P1",
  playlists: { P1: [], P2: [] },
  current: null,
  autoNext: true,
  rates: [0.8, 1.0, 1.25, 1.5, 1.75, 2.0],
  currentRate: 1.0,
  timerMode: null,
  timerIntervalId: null,
  timerRemainingSec: 0,
  activeDockTab: "timer",
  playbackToken: 0,
  metadataHandler: null,
  lastSavedSecond: -1,
  lastSaveAt: 0,
  isLoadingPart: false
};

const STORAGE_KEY = "pntt-player-state";

const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
})();

/* ============================================================
   THÔNG BÁO TRẠNG THÁI
============================================================ */
function showStatus(message) {
  let el = $("#playerStatus");

  if (!el) {
    el = document.createElement("div");
    el.id = "playerStatus";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");

    Object.assign(el.style, {
      position: "fixed",
      left: "50%",
      bottom: "100px",
      transform: "translateX(-50%)",
      zIndex: "9999",
      maxWidth: "90vw",
      padding: "10px 16px",
      borderRadius: "10px",
      background: "rgba(25,25,25,.94)",
      color: "#fff",
      fontSize: "14px",
      textAlign: "center",
      display: "none"
    });

    document.body.appendChild(el);
  }

  el.textContent = message || "";
  el.style.display = message ? "block" : "none";

  if (message) {
    clearTimeout(showStatus._timer);
    showStatus._timer = setTimeout(() => {
      el.style.display = "none";
    }, 3500);
  }
}

/* ============================================================
   ĐỊNH DẠNG THỜI GIAN & LƯU TRẠNG THÁI
============================================================ */
function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";

  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);

  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

let saveDebounceTimer = null;

function scheduleSaveState(force = false) {
  if (force) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = null;
    saveState(true);
    return;
  }

  if (saveDebounceTimer !== null) return;

  saveDebounceTimer = setTimeout(() => {
    saveDebounceTimer = null;
    saveState(false);
  }, 1000);
}

function saveState(force = false) {
  if (!state.current) return;

  const second = Number.isFinite(audio.currentTime)
    ? Math.floor(audio.currentTime)
    : 0;

  const now = Date.now();

  // Hạn chế ghi localStorage quá thường xuyên.
  if (!force && second === state.lastSavedSecond) return;
  if (!force && now - state.lastSaveAt < 5000) return;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      part: state.current.part,
      id: state.current.id,
      time: second,
      rate: state.currentRate,
      autoNext: state.autoNext
    }));

    state.lastSavedSecond = second;
    state.lastSaveAt = now;
  } catch (_) {
    // Không để lỗi bộ nhớ trình duyệt làm hỏng trình phát.
  }
}

/* ============================================================
   TẢI PLAYLIST
============================================================ */
function normalizeEpisode(item, index, part) {
  return {
    id: Number(item.id ?? index + 1),
    title: String(item.title ?? `Tập ${index + 1}`),
    src: String(item.src ?? ""),
    part: String(item.part ?? part),
    chapter_start: Number(item.chapter_start ?? 0),
    chapter_end: Number(
      item.chapter_end ?? item.chapter_start ?? 0
    )
  };
}

async function loadPart(part) {
  if (state.playlists[part].length) {
    return state.playlists[part];
  }

  if (state.isLoadingPart) {
    while (state.isLoadingPart) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    if (state.playlists[part].length) {
      return state.playlists[part];
    }
  }

  state.isLoadingPart = true;

  try {
    const res = await fetch(PLAYLIST_URLS[part], {
      cache: "force-cache"
    });

    if (!res.ok) {
      throw new Error(
        `Không tải được playlist ${part} (HTTP ${res.status}).`
      );
    }

    const data = await res.json();

    if (!Array.isArray(data)) {
      throw new Error(
        `Playlist ${part} không đúng định dạng mảng JSON.`
      );
    }

    state.playlists[part] = data
      .map((item, i) => normalizeEpisode(item, i, part))
      .filter(item => item.src);

    return state.playlists[part];
  } catch (error) {
    showStatus(
      error?.message ||
      "Không tải được danh sách tập. Kiểm tra kết nối mạng."
    );

    throw error;
  } finally {
    state.isLoadingPart = false;
  }
}

/* ============================================================
   PHÁT AUDIO
============================================================ */
async function playEpisode(ep, seekTo = 0, autoPlay = true) {
  if (!ep || !ep.src) {
    showStatus("Tập này chưa có đường dẫn audio hợp lệ.");
    return;
  }

  // Lưu vị trí tập trước khi chuyển tập.
  scheduleSaveState(true);

  const token = ++state.playbackToken;

  if (state.metadataHandler) {
    audio.removeEventListener(
      "loadedmetadata",
      state.metadataHandler
    );

    state.metadataHandler = null;
  }

  state.current = ep;
  state.part = ep.part;

  showStatus("");

  $("#trackTitle").textContent = ep.title;

  $("#trackAuthor").textContent =
    `Haron Audio · Chương ${ep.chapter_start}–${ep.chapter_end}`;

  // Thông tin hiển thị trên màn hình khóa nếu trình duyệt hỗ trợ.
  if ("mediaSession" in navigator && "MediaMetadata" in window) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: ep.title,
      artist: "Haron Audio",
      album: `PNTT (${ep.part})`
    });
  }

  audio.pause();
  audio.playbackRate = state.currentRate;

  // Giải phóng nguồn cũ trước khi tải nguồn mới.
  audio.removeAttribute("src");
  audio.load();

  // Chỉ ưu tiên tải metadata, tránh tải trước quá nhiều audio.
  audio.preload = "metadata";
  audio.src = ep.src;

  state.metadataHandler = async () => {
    if (token !== state.playbackToken) return;

    if (
      seekTo > 0 &&
      Number.isFinite(audio.duration) &&
      audio.duration > 0
    ) {
      applySeek(Math.min(seekTo, audio.duration));
    }

    updateProgressUI(audio.currentTime || 0, audio.duration);

    if (autoPlay) {
      try {
        await audio.play();
        showStatus("");
      } catch (error) {
        if (
          token === state.playbackToken &&
          error?.name !== "AbortError"
        ) {
          showStatus("Chạm nút phát để bắt đầu nghe.");
        }
      }
    }

    scheduleSaveState(true);
  };

  audio.addEventListener(
    "loadedmetadata",
    state.metadataHandler,
    { once: true }
  );

  audio.load();

  renderEpisodeList();
}

function onAudioError() {
  if (!state.current) return;

  showStatus(
    "Không tải được audio. Kiểm tra mạng hoặc đường dẫn file trên máy chủ."
  );

  scheduleSaveState(true);
}

function togglePlay() {
  if (!state.current) {
    const curList = state.playlists[state.part];

    if (curList?.length) {
      playEpisode(curList[0], 0, true);
    }

    return;
  }

  if (audio.paused) {
    audio.play().catch(() => {
      showStatus("Không thể phát lúc này. Hãy chạm Play để thử lại.");
    });
  } else {
    audio.pause();
  }
}

function stepEpisode(delta) {
  const list = state.playlists[state.part] || [];

  const idx = list.findIndex(
    x => state.current && x.id === state.current.id
  );

  const target = list[idx + delta];

  if (target) {
    playEpisode(target, 0, true);
  }
}

/* ============================================================
   SỰ KIỆN AUDIO
============================================================ */
audio.addEventListener("error", onAudioError);

audio.addEventListener("play", () => {
  $("#playIcon").classList.add("hidden");
  $("#pauseIcon").classList.remove("hidden");
});

audio.addEventListener("pause", () => {
  $("#pauseIcon").classList.add("hidden");
  $("#playIcon").classList.remove("hidden");

  scheduleSaveState(true);
});

audio.addEventListener("ended", () => {
  scheduleSaveState(true);

  if (state.timerMode === "end") {
    clearTimer();
    return;
  }

  if (state.autoNext) {
    stepEpisode(1);
  }
});

/* ============================================================
   THANH TIẾN TRÌNH & TUA AUDIO
============================================================ */
let isDraggingSeek = false;
let seekTargetRatio = 0;

const progressBar = $("#progressBar");

function updateProgressUI(currentSec, totalSec) {
  if (!Number.isFinite(totalSec) || totalSec <= 0) return;

  const percent = Math.min(
    100,
    Math.max(0, (currentSec / totalSec) * 100)
  );

  $("#progressFill").style.width = `${percent}%`;
  $("#progressThumb").style.left = `${percent}%`;

  $("#curTimeLabel").textContent = formatTime(currentSec);

  const remSec = totalSec - currentSec;

  $("#remTimeLabel").textContent = `-${formatTime(remSec)}`;
}

audio.addEventListener("timeupdate", () => {
  if (isDraggingSeek) return;

  updateProgressUI(audio.currentTime, audio.duration);
  scheduleSaveState(false);
});

audio.addEventListener("durationchange", () => {
  updateProgressUI(audio.currentTime || 0, audio.duration);
});

function applySeek(targetSec) {
  if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
    return;
  }

  const clamped = Math.max(
    0,
    Math.min(audio.duration, targetSec)
  );

  try {
    audio.currentTime = clamped;
  } catch (_) {}

  updateProgressUI(clamped, audio.duration);
  scheduleSaveState(false);
}

function getRatioFromEvent(e) {
  const rect = progressBar.getBoundingClientRect();

  const clientX = e.touches
    ? e.touches[0].clientX
    : e.clientX;

  if (!rect.width) return 0;

  return Math.max(
    0,
    Math.min(1, (clientX - rect.left) / rect.width)
  );
}

function onSeekStart(e) {
  if (!audio.duration) return;

  isDraggingSeek = true;
  seekTargetRatio = getRatioFromEvent(e);

  updateProgressUI(
    seekTargetRatio * audio.duration,
    audio.duration
  );

  window.addEventListener("mousemove", onSeekMove);
  window.addEventListener("touchmove", onSeekMove, {
    passive: false
  });

  window.addEventListener("mouseup", onSeekEnd);
  window.addEventListener("touchend", onSeekEnd);
  window.addEventListener("touchcancel", onSeekEnd);
}

function onSeekMove(e) {
  if (!isDraggingSeek || !audio.duration) return;

  if (e.cancelable) {
    e.preventDefault();
  }

  seekTargetRatio = getRatioFromEvent(e);

  updateProgressUI(
    seekTargetRatio * audio.duration,
    audio.duration
  );
}

function onSeekEnd() {
  if (!isDraggingSeek) return;

  isDraggingSeek = false;

  window.removeEventListener("mousemove", onSeekMove);
  window.removeEventListener("touchmove", onSeekMove);
  window.removeEventListener("mouseup", onSeekEnd);
  window.removeEventListener("touchend", onSeekEnd);
  window.removeEventListener("touchcancel", onSeekEnd);

  if (Number.isFinite(audio.duration)) {
    applySeek(seekTargetRatio * audio.duration);
  }
}

progressBar.addEventListener("mousedown", onSeekStart);

progressBar.addEventListener(
  "touchstart",
  onSeekStart,
  { passive: true }
);

// Tua lùi 15 giây.
$("#rewind15Btn").addEventListener("click", () => {
  if (!audio.duration) return;

  applySeek(audio.currentTime - 15);
});

// Tua tiến 15 giây.
$("#forward15Btn").addEventListener("click", () => {
  if (!audio.duration) return;

  applySeek(audio.currentTime + 15);
});

// Chuyển tập và phát/dừng.
$("#prevEpBtn").addEventListener("click", () => {
  stepEpisode(-1);
});

$("#nextEpBtn").addEventListener("click", () => {
  stepEpisode(1);
});

$("#playPauseBtn").addEventListener("click", togglePlay);

/* ============================================================
   TỰ ĐỘNG PHÁT TẬP TIẾP THEO
============================================================ */
const autoNextToggle = $("#autoNextToggle");

autoNextToggle.addEventListener("change", (e) => {
  state.autoNext = e.target.checked;
  scheduleSaveState(true);
});

/* ============================================================
   DOCK: HẸN GIỜ & TỐC ĐỘ PHÁT
============================================================ */
const dockBackdrop = $("#dockBackdrop");
const pillBar = $("#pillOptionsBar");

function openDock(tab = "timer") {
  state.activeDockTab = tab;
  renderDock();
  dockBackdrop.classList.add("open");
}

function closeDock() {
  dockBackdrop.classList.remove("open");
}

function renderDock() {
  const isTimer = state.activeDockTab === "timer";

  $("#dockTabTimer").classList.toggle("active", isTimer);
  $("#dockTabSpeed").classList.toggle("active", !isTimer);

  pillBar.replaceChildren();

  if (isTimer) {
    const options = [
      { id: "off", label: "Tắt", isRed: true },
      { id: "15", label: "15p" },
      { id: "30", label: "30p" },
      { id: "45", label: "45p" },
      { id: "60", label: "60p" },
      { id: "end", label: "Hết tập" }
    ];

    options.forEach(opt => {
      const btn = document.createElement("button");

      btn.className = `pill-opt ${opt.isRed ? "red" : ""}`;

      const isActive =
        (opt.id === "off" && !state.timerMode) ||
        state.timerMode === opt.id;

      if (isActive) {
        btn.classList.add("active");
      }

      btn.textContent = opt.label;

      btn.addEventListener("click", () => {
        if (opt.id === "off") {
          clearTimer();
        } else if (opt.id === "end") {
          setTimerEndEpisode();
        } else {
          setTimerMinutes(parseInt(opt.id, 10));
        }

        renderDock();
      });

      pillBar.appendChild(btn);
    });
  } else {
    state.rates.forEach(rate => {
      const btn = document.createElement("button");

      btn.className = "pill-opt";

      if (state.currentRate === rate) {
        btn.classList.add("active");
      }

      btn.textContent = `${rate}x`;

      btn.addEventListener("click", () => {
        setSpeed(rate);
        renderDock();
      });

      pillBar.appendChild(btn);
    });
  }
}

function setSpeed(rate) {
  state.currentRate = rate;
  audio.playbackRate = rate;

  $("#speedLabel").textContent = `${rate}x`;
  $("#dockSpeedText").textContent = `${rate}x`;

  scheduleSaveState(true);
}

function clearTimer() {
  clearInterval(state.timerIntervalId);

  state.timerMode = null;
  state.timerIntervalId = null;
  state.timerRemainingSec = 0;

  $("#timerStatusLabel").textContent = "Hẹn giờ";
}

function setTimerMinutes(min) {
  clearTimer();

  state.timerMode = String(min);
  state.timerRemainingSec = min * 60;

  $("#timerStatusLabel").textContent = `${min}p`;

  state.timerIntervalId = setInterval(() => {
    state.timerRemainingSec -= 1;

    if (state.timerRemainingSec <= 0) {
      audio.pause();
      clearTimer();
    } else {
      const m = Math.ceil(state.timerRemainingSec / 60);

      $("#timerStatusLabel").textContent = `${m}p`;
    }
  }, 1000);
}

function setTimerEndEpisode() {
  clearTimer();

  state.timerMode = "end";

  $("#timerStatusLabel").textContent = "Hết tập";
}

$("#openTimerModalBtn").addEventListener("click", () => {
  openDock("timer");
});

$("#openSpeedModalBtn").addEventListener("click", () => {
  openDock("speed");
});

$("#dockTabTimer").addEventListener("click", () => {
  state.activeDockTab = "timer";
  renderDock();
});

$("#dockTabSpeed").addEventListener("click", () => {
  state.activeDockTab = "speed";
  renderDock();
});

$("#dockCloseBtn").addEventListener("click", closeDock);

dockBackdrop.addEventListener("click", (e) => {
  if (e.target === dockBackdrop) {
    closeDock();
  }
});

/* ============================================================
   DANH SÁCH TẬP
============================================================ */
function renderEpisodeList() {
  const container = $("#epListContainer");

  if (!container) return;

  const searchInput = $("#sheetSearchInput");

  const query = searchInput
    ? searchInput.value.trim().toLocaleLowerCase("vi")
    : "";

  const list = (state.playlists[state.part] || []).filter(item =>
    `${item.title} ${item.id} ${item.chapter_start} ${item.chapter_end}`
      .toLocaleLowerCase("vi")
      .includes(query)
  );

  const fragment = document.createDocumentFragment();

  for (const ep of list) {
    const isCur =
      state.current &&
      state.current.id === ep.id &&
      state.current.part === ep.part;

    const row = document.createElement("button");

    row.type = "button";
    row.className = `sheet-ep-item${isCur ? " active" : ""}`;
    row.dataset.id = String(ep.id);
    row.setAttribute("aria-current", isCur ? "true" : "false");

    const info = document.createElement("span");

    const title = document.createElement("span");
    title.className = "sheet-ep-title";
    title.textContent = ep.title;

    const sub = document.createElement("span");
    sub.className = "sheet-ep-sub";
    sub.textContent =
      `Chương ${ep.chapter_start} - ${ep.chapter_end}`;

    info.append(title, sub);
    row.appendChild(info);

    if (isCur) {
      const marker = document.createElement("span");

      marker.className = "sheet-ep-playing";
      marker.textContent = "▶";
      marker.setAttribute("aria-label", "Đang phát");

      row.appendChild(marker);
    }

    fragment.appendChild(row);
  }

  container.replaceChildren(fragment);
}

// Chỉ sử dụng một listener cho toàn bộ danh sách tập.
const episodeListContainer = $("#epListContainer");

episodeListContainer?.addEventListener("click", event => {
  const row = event.target.closest(".sheet-ep-item");

  if (!row || !episodeListContainer.contains(row)) {
    return;
  }

  const ep = (state.playlists[state.part] || []).find(
    x => x.id === Number(row.dataset.id)
  );

  if (ep) {
    playEpisode(ep, 0, true);
    closeSheet();
  }
});

/* ============================================================
   CHUYỂN PHẦN PLAYLIST
============================================================ */
async function switchPart(part) {
  if (!PLAYLIST_URLS[part]) return;

  state.part = part;

  document.querySelectorAll(".part-tab-btn").forEach(btn => {
    btn.classList.toggle(
      "active",
      btn.dataset.part === part
    );
  });

  try {
    await loadPart(part);
    showStatus("");
  } catch (_) {
    renderEpisodeList();
    return;
  }

  renderEpisodeList();

  if ($("#bottomSheet").classList.contains("open")) {
    scrollToActiveEpisode(false);
  }
}

/* ============================================================
   MỞ / ĐÓNG DANH SÁCH TẬP
============================================================ */
$("#drawerOpenBtn").addEventListener("click", openSheet);

$("#drawerOpenBtnTop").addEventListener("click", openSheet);

$("#sheetScrim").addEventListener("click", closeSheet);

document.querySelectorAll(".part-tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    switchPart(btn.dataset.part);
  });
});

$("#sheetSearchInput").addEventListener("input", renderEpisodeList);

function scrollToActiveEpisode(smooth = true) {
  const container = $("#epListContainer");

  if (!container) return;

  const activeItem = container.querySelector(
    ".sheet-ep-item.active"
  );

  if (activeItem) {
    activeItem.scrollIntoView({
      block: "center",
      behavior: smooth ? "smooth" : "auto"
    });
  }
}

function openSheet() {
  $("#bottomSheet").classList.add("open");

  requestAnimationFrame(() => {
    scrollToActiveEpisode(false);
  });
}

function closeSheet() {
  $("#bottomSheet").classList.remove("open");
}

/* ============================================================
   CHIA SẺ LIÊN KẾT
============================================================ */
$("#shareBtn").addEventListener("click", async () => {
  const shareData = {
    title: state.current?.title || "PNTT Audio Player",
    text: state.current
      ? `Đang nghe ${state.current.title} trên TCGAudio`
      : "Nghe truyện trên TCGAudio",
    url: window.location.href
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch (_) {
      // Người dùng có thể đã đóng hộp thoại chia sẻ.
    }

    return;
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showStatus("Đã sao chép liên kết trang.");
    } catch (_) {
      showStatus(
        "Không thể sao chép liên kết trên trình duyệt này."
      );
    }

    return;
  }

  showStatus(
    "Trình duyệt không hỗ trợ chia sẻ hoặc sao chép liên kết."
  );
});

/* ============================================================
   KHỞI TẠO TRÌNH PHÁT
============================================================ */
(async function init() {
  const initPart = saved.part === "P2" ? "P2" : "P1";

  if (saved.autoNext !== undefined) {
    state.autoNext = saved.autoNext;
    autoNextToggle.checked = saved.autoNext;
  }

  if (saved.rate) {
    setSpeed(Number(saved.rate));
  }

  try {
    await switchPart(initPart);
  } catch (_) {
    showStatus(
      "Không tải được playlist. Kiểm tra kết nối hoặc tệp JSON."
    );

    return;
  }

  const list = state.playlists[initPart];

  const target =
    (saved.id && list.find(x => x.id === Number(saved.id))) ||
    list[0];

  if (target) {
    await playEpisode(
      target,
      Number(saved.time || 0),
      false
    );
  }
})();

/* ============================================================
   LƯU VỊ TRÍ KHI RỜI TRANG
============================================================ */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    scheduleSaveState(true);
  }
});

window.addEventListener("pagehide", () => {
  scheduleSaveState(true);
});

window.addEventListener("beforeunload", () => {
  scheduleSaveState(true);
});

/* ============================================================
   ĐIỀU KHIỂN TỪ MÀN HÌNH KHÓA / TAI NGHE
============================================================ */
if (
  "mediaSession" in navigator &&
  navigator.mediaSession.setActionHandler
) {
  try {
    navigator.mediaSession.setActionHandler("play", () => {
      audio.play().catch(() => {});
    });

    navigator.mediaSession.setActionHandler("pause", () => {
      audio.pause();
    });

    navigator.mediaSession.setActionHandler(
      "previoustrack",
      () => stepEpisode(-1)
    );

    navigator.mediaSession.setActionHandler(
      "nexttrack",
      () => stepEpisode(1)
    );

    navigator.mediaSession.setActionHandler(
      "seekbackward",
      details => {
        applySeek(
          audio.currentTime - (details.seekOffset || 15)
        );
      }
    );

    navigator.mediaSession.setActionHandler(
      "seekforward",
      details => {
        applySeek(
          audio.currentTime + (details.seekOffset || 15)
        );
      }
    );
  } catch (_) {}
}