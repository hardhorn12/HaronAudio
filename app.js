/* ============================================================
   HARON AUDIO PLAYER - KIẾN TRÚC MỞ RỘNG & HIỆU NĂNG CAO
============================================================ */
(() => {
  "use strict";

  const PLAYLISTS = [
    {
      id: "P1",
      tabLabel: "Phần 1",
      title: "PNTT · Phần 1",
      url: "playlists/playlist_P1.json"
    },
    {
      id: "P2",
      tabLabel: "Phần 2",
      title: "PNTT · Phần 2",
      url: "playlists/playlist_P2.json"
    },
    {
      id: "KL",
      tabLabel: "Kiếm Lai",
      title: "Kiếm Lai",
      url: "playlists/playlist_KL.json"
    }
  ];

  const PLAYLIST_MAP = new Map(PLAYLISTS.map(p => [p.id, p]));
  const DEFAULT_PART = PLAYLISTS[0].id;
  const DEFAULT_RATE = 1.25;
  const RATES = [0.8, 1.0, 1.25, 1.5, 1.75, 2.0];
  const TIMER_OPTIONS = [
    { id: "off", label: "Tắt", isRed: true },
    { id: "15", label: "15p" },
    { id: "30", label: "30p" },
    { id: "45", label: "45p" },
    { id: "60", label: "60p" },
    { id: "end", label: "Hết tập" }
  ];
  const STORAGE_KEY = "pntt-player-state";
  const BACKGROUND_MANIFEST_URL = "background/manifest.json";
  const DEFAULT_BACKGROUNDS = ["background/tn.jpg"];

  /* ============================================================
     DOM CACHE
  ============================================================ */
  const $ = (selector) => document.querySelector(selector);

  const dom = {
    container: $("#playerContainer"),
    audio: $("#audioPlayer"),
    bgBackdropImg: $("#bgBackdropImg"),
    navChannelBtn: $("#navChannelBtn"),
    navChannelTitle: $("#navChannelTitle"),
    trackTitle: $("#trackTitle"),
    trackAuthor: $("#trackAuthor"),
    autoNextToggle: $("#autoNextToggle"),
    progressBar: $("#progressBar"),
    progressFill: $("#progressFill"),
    progressThumb: $("#progressThumb"),
    seekTooltip: $("#seekTooltip"),
    curTimeLabel: $("#curTimeLabel"),
    remTimeLabel: $("#remTimeLabel"),
    prevEpBtn: $("#prevEpBtn"),
    rewind15Btn: $("#rewind15Btn"),
    playPauseBtn: $("#playPauseBtn"),
    playIcon: $("#playIcon"),
    pauseIcon: $("#pauseIcon"),
    loadingSpinner: $("#loadingSpinner"),
    forward15Btn: $("#forward15Btn"),
    nextEpBtn: $("#nextEpBtn"),
    openSpeedModalBtn: $("#openSpeedModalBtn"),
    speedLabel: $("#speedLabel"),
    timerInlineBadge: $("#timerInlineBadge"),
    drawerOpenBtn: $("#drawerOpenBtn"),
    dockBackdrop: $("#dockBackdrop"),
    pillOptionsBar: $("#pillOptionsBar"),
    dockTabSpeed: $("#dockTabSpeed"),
    dockSpeedText: $("#dockSpeedText"),
    dockTabTimer: $("#dockTabTimer"),
    dockTimerText: $("#dockTimerText"),
    dockCloseBtn: $("#dockCloseBtn"),
    bottomSheet: $("#bottomSheet"),
    sheetScrim: $("#sheetScrim"),
    sheetTabs: $("#sheetTabs"),
    sheetSearchInput: $("#sheetSearchInput"),
    searchClearBtn: $("#searchClearBtn"),
    scrollToActiveBtn: $("#scrollToActiveBtn"),
    epListContainer: $("#epListContainer"),
    playerStatus: $("#playerStatus")
  };

  /* ============================================================
     STATE & STORAGE
  ============================================================ */
  const state = {
    part: DEFAULT_PART,
    playlists: new Map(),      // part -> Episode[]
    episodeIndex: new Map(),   // part -> Map<id, index>
    loadingPromises: new Map(),
    current: null,
    autoNext: true,
    currentRate: DEFAULT_RATE,
    timerMode: null,
    timerIntervalId: null,
    timerRemainingSec: 0,
    activeDockTab: "timer",
    playbackToken: 0,
    isLoadingAudio: false,
    lastSavedSecond: -1,
    lastSaveAt: 0,
    renderedPart: null,
    renderedQuery: null,
    history: {},
    backgrounds: [...DEFAULT_BACKGROUNDS],
    currentBackground: DEFAULT_BACKGROUNDS[0]
  };

  function readSavedState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
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

    const second = Number.isFinite(dom.audio.currentTime)
      ? Math.floor(dom.audio.currentTime)
      : 0;
    const now = Date.now();

    if (!force && second === state.lastSavedSecond) return;
    if (!force && now - state.lastSaveAt < 5000) return;

    state.history[state.current.part] = {
      id: state.current.id,
      time: second
    };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        part: state.current.part,
        id: state.current.id,
        time: second,
        rate: state.currentRate,
        autoNext: state.autoNext,
        history: state.history
      }));
      state.lastSavedSecond = second;
      state.lastSaveAt = now;
    } catch {
      // Bỏ qua nếu bộ nhớ trình duyệt bị khóa hoặc đầy.
    }
  }

  /* ============================================================
     TIỆN ÍCH HIỂN THỊ & FORMAT
  ============================================================ */
  let statusTimer = null;

  function showStatus(message) {
    const el = dom.playerStatus;
    if (!el) return;

    clearTimeout(statusTimer);
    if (!message) {
      el.classList.remove("visible");
      return;
    }

    el.textContent = message;
    el.classList.add("visible");
    statusTimer = setTimeout(() => {
      el.classList.remove("visible");
    }, 3200);
  }

  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const total = Math.floor(sec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;

    if (h > 0) {
      return `${h}:${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
    }
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }

  function setLoadingState(loading) {
    state.isLoadingAudio = loading;
    dom.loadingSpinner.classList.toggle("hidden", !loading);
    if (loading) {
      dom.playIcon.classList.add("hidden");
      dom.pauseIcon.classList.add("hidden");
    } else {
      const isPlaying = !dom.audio.paused;
      dom.playIcon.classList.toggle("hidden", isPlaying);
      dom.pauseIcon.classList.toggle("hidden", !isPlaying);
    }
  }

  function updatePlayingVisuals(isPlaying) {
    dom.container.classList.toggle("is-playing", isPlaying);
    if (!state.isLoadingAudio) {
      dom.playIcon.classList.toggle("hidden", isPlaying);
      dom.pauseIcon.classList.toggle("hidden", !isPlaying);
    }
  }

  function updateStepButtons() {
    if (!state.current) {
      dom.prevEpBtn.disabled = true;
      dom.nextEpBtn.disabled = true;
      return;
    }
    const list = state.playlists.get(state.current.part) || [];
    const idx = state.episodeIndex.get(state.current.part)?.get(state.current.id) ?? -1;
    dom.prevEpBtn.disabled = idx <= 0;
    dom.nextEpBtn.disabled = idx < 0 || idx >= list.length - 1;
  }

  function updateHeaderMeta(part) {
    const meta = PLAYLIST_MAP.get(part);
    if (!meta) return;
    dom.navChannelTitle.textContent = meta.title;
    document.title = `${meta.title} - Haron Audio`;
  }

  /* ============================================================
     ẢNH NỀN NGẪU NHIÊN FULL MÀN HÌNH
  ============================================================ */
  function normalizeBgPath(file) {
    const trimmed = String(file || "").trim();
    if (!trimmed) return "";
    if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith("background/")) {
      return trimmed;
    }
    return `background/${trimmed.replace(/^\.?\//, "")}`;
  }

  async function loadBackgroundManifest() {
    try {
      const res = await fetch(BACKGROUND_MANIFEST_URL, { cache: "no-cache" });
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data)) return;

      const list = data.map(normalizeBgPath).filter(Boolean);
      if (list.length) {
        state.backgrounds = list;
      }
    } catch {
      // Dùng danh sách mặc định nếu chưa có manifest hoặc chạy offline.
    }
  }

  function pickRandomBackground() {
    const pool = state.backgrounds.length ? state.backgrounds : DEFAULT_BACKGROUNDS;
    let nextSrc = pool[0];

    if (pool.length > 1) {
      const candidates = pool.filter(src => src !== state.currentBackground);
      const sourcePool = candidates.length ? candidates : pool;
      nextSrc = sourcePool[Math.floor(Math.random() * sourcePool.length)];
    }

    state.currentBackground = nextSrc;

    if (dom.bgBackdropImg && dom.bgBackdropImg.getAttribute("src") !== nextSrc) {
      dom.bgBackdropImg.style.opacity = "0.2";
      dom.bgBackdropImg.onload = () => {
        dom.bgBackdropImg.style.opacity = "1";
      };
      dom.bgBackdropImg.src = nextSrc;
    }
  }

  /* ============================================================
     TẢI PLAYLIST (CÓ CACHE & CHỐNG GỌI TRÙNG)
  ============================================================ */
  function normalizeEpisode(item, index, part) {
    const id = Number(item.id ?? index + 1);
    const title = String(item.title ?? `Tập ${index + 1}`);
    const chapterStart = Number(item.chapter_start ?? 0);
    const chapterEnd = Number(item.chapter_end ?? chapterStart);

    return {
      id,
      title,
      src: String(item.src ?? ""),
      part: String(item.part ?? part),
      chapter_start: chapterStart,
      chapter_end: chapterEnd,
      _searchKey: `${title} ${id} ${chapterStart} ${chapterEnd}`.toLocaleLowerCase("vi")
    };
  }

  async function loadPart(part) {
    if (state.playlists.has(part)) {
      return state.playlists.get(part);
    }

    if (state.loadingPromises.has(part)) {
      return state.loadingPromises.get(part);
    }

    const meta = PLAYLIST_MAP.get(part);
    if (!meta) {
      throw new Error(`Playlist không tồn tại: ${part}`);
    }

    const promise = (async () => {
      try {
        const res = await fetch(meta.url, { cache: "force-cache" });
        if (!res.ok) {
          throw new Error(`Không tải được ${meta.title} (HTTP ${res.status}).`);
        }

        const data = await res.json();
        if (!Array.isArray(data)) {
          throw new Error(`Playlist ${meta.title} không đúng định dạng mảng JSON.`);
        }

        const list = data
          .map((item, i) => normalizeEpisode(item, i, part))
          .filter(item => item.src);

        const idxMap = new Map();
        list.forEach((ep, idx) => idxMap.set(ep.id, idx));

        state.playlists.set(part, list);
        state.episodeIndex.set(part, idxMap);
        return list;
      } catch (error) {
        showStatus(error?.message || "Không tải được danh sách tập. Kiểm tra kết nối mạng.");
        throw error;
      } finally {
        state.loadingPromises.delete(part);
      }
    })();

    state.loadingPromises.set(part, promise);
    return promise;
  }

  /* ============================================================
     PHÁT AUDIO
  ============================================================ */
  let activeMetadataHandler = null;

  async function playEpisode(ep, seekTo = 0, autoPlay = true) {
    if (!ep || !ep.src) {
      showStatus("Tập này chưa có đường dẫn audio hợp lệ.");
      return;
    }

    scheduleSaveState(true);

    const token = ++state.playbackToken;
    const prevPart = state.current?.part;
    const isSwitchingEpisode = state.current && (state.current.id !== ep.id || state.current.part !== ep.part);

    if (activeMetadataHandler) {
      dom.audio.removeEventListener("loadedmetadata", activeMetadataHandler);
      activeMetadataHandler = null;
    }

    state.current = ep;
    state.part = ep.part;

    if (isSwitchingEpisode) {
      pickRandomBackground();
    }

    showStatus("");
    updateHeaderMeta(ep.part);
    dom.trackTitle.textContent = ep.title;
    dom.trackAuthor.textContent = `Haron Audio · Chương ${ep.chapter_start}–${ep.chapter_end}`;

    updateMediaSessionMetadata(ep);
    updateStepButtons();

    // Reset thanh tiến trình ngay khi chuyển tập.
    updateProgressUI(0, 0);

    dom.audio.pause();
    dom.audio.playbackRate = state.currentRate;
    dom.audio.preload = "metadata";
    dom.audio.src = ep.src;

    if (autoPlay) {
      setLoadingState(true);
    }

    activeMetadataHandler = async () => {
      if (token !== state.playbackToken) return;

      // Khẳng định lại tốc độ phát vì một số trình duyệt reset về 1.0 khi đổi src.
      dom.audio.playbackRate = state.currentRate;

      if (seekTo > 0 && Number.isFinite(dom.audio.duration) && dom.audio.duration > 0) {
        applySeek(Math.min(seekTo, dom.audio.duration));
      } else {
        updateProgressUI(dom.audio.currentTime || 0, dom.audio.duration);
      }

      if (autoPlay) {
        try {
          await dom.audio.play();
          showStatus("");
        } catch (error) {
          setLoadingState(false);
          if (token === state.playbackToken && error?.name !== "AbortError") {
            showStatus("Chạm nút phát để bắt đầu nghe.");
          }
        }
      } else {
        setLoadingState(false);
      }

      syncMediaPositionState();
      scheduleSaveState(true);
    };

    dom.audio.addEventListener("loadedmetadata", activeMetadataHandler, { once: true });
    dom.audio.load();

    // Cập nhật danh sách tập ở chế độ O(1) nếu đang hiển thị cùng phần.
    if (state.renderedPart === ep.part && prevPart === ep.part) {
      updateActiveEpisodeRow();
    } else if (state.renderedPart === ep.part) {
      renderEpisodeList(true);
    }
  }

  function togglePlay() {
    if (!state.current) {
      const curList = state.playlists.get(state.part);
      if (curList?.length) {
        playEpisode(curList[0], 0, true);
      }
      return;
    }

    if (dom.audio.paused) {
      dom.audio.playbackRate = state.currentRate;
      dom.audio.play().catch(() => {
        setLoadingState(false);
        showStatus("Không thể phát lúc này. Hãy chạm Play để thử lại.");
      });
    } else {
      dom.audio.pause();
    }
  }

  function stepEpisode(delta) {
    if (!state.current) return;
    const part = state.current.part;
    const list = state.playlists.get(part) || [];
    const idx = state.episodeIndex.get(part)?.get(state.current.id) ?? -1;
    const target = list[idx + delta];
    if (target) {
      playEpisode(target, 0, true);
    }
  }

  /* ============================================================
     SỰ KIỆN AUDIO
  ============================================================ */
  dom.audio.addEventListener("waiting", () => {
    if (state.current && !dom.audio.paused) {
      setLoadingState(true);
    }
  });

  dom.audio.addEventListener("canplay", () => {
    setLoadingState(false);
  });

  dom.audio.addEventListener("playing", () => {
    setLoadingState(false);
    dom.audio.playbackRate = state.currentRate;
    updatePlayingVisuals(true);
    syncMediaPositionState();
  });

  dom.audio.addEventListener("play", () => {
    updatePlayingVisuals(true);
  });

  dom.audio.addEventListener("pause", () => {
    setLoadingState(false);
    updatePlayingVisuals(false);
    scheduleSaveState(true);
  });

  dom.audio.addEventListener("error", () => {
    setLoadingState(false);
    if (!state.current) return;
    showStatus("Không tải được audio. Kiểm tra mạng hoặc thử lại sau.");
    scheduleSaveState(true);
  });

  dom.audio.addEventListener("ended", () => {
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
     THANH TIẾN TRÌNH & TUA AUDIO (POINTER EVENTS + RAF)
  ============================================================ */
  let isDraggingSeek = false;
  let seekTargetRatio = 0;
  let seekRafId = null;

  function updateProgressUI(currentSec, totalSec) {
    const valid = Number.isFinite(totalSec) && totalSec > 0;
    const ratio = valid ? Math.min(1, Math.max(0, currentSec / totalSec)) : 0;
    const percent = ratio * 100;

    dom.progressFill.style.transform = `scaleX(${ratio})`;
    dom.progressThumb.style.left = `${percent}%`;
    dom.progressBar.setAttribute("aria-valuenow", String(Math.round(percent)));

    if (valid) {
      dom.curTimeLabel.textContent = formatTime(currentSec);
      dom.remTimeLabel.textContent = `-${formatTime(Math.max(0, totalSec - currentSec))}`;
      if (isDraggingSeek) {
        dom.seekTooltip.textContent = formatTime(currentSec);
        dom.seekTooltip.style.left = `${percent}%`;
      }
    } else {
      dom.curTimeLabel.textContent = "0:00";
      dom.remTimeLabel.textContent = "-0:00";
    }
  }

  dom.audio.addEventListener("timeupdate", () => {
    if (isDraggingSeek) return;
    updateProgressUI(dom.audio.currentTime, dom.audio.duration);
    scheduleSaveState(false);
  });

  dom.audio.addEventListener("durationchange", () => {
    updateProgressUI(dom.audio.currentTime || 0, dom.audio.duration);
    syncMediaPositionState();
  });

  function applySeek(targetSec) {
    if (!Number.isFinite(dom.audio.duration) || dom.audio.duration <= 0) return;

    const clamped = Math.max(0, Math.min(dom.audio.duration, targetSec));
    try {
      dom.audio.currentTime = clamped;
    } catch {
      // Bỏ qua nếu trình duyệt chưa sẵn sàng seek.
    }

    updateProgressUI(clamped, dom.audio.duration);
    syncMediaPositionState();
    scheduleSaveState(false);
  }

  function getRatioFromPointer(e) {
    const rect = dom.progressBar.getBoundingClientRect();
    if (!rect.width) return 0;
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }

  function scheduleDragRender() {
    if (seekRafId !== null) return;
    seekRafId = requestAnimationFrame(() => {
      seekRafId = null;
      if (Number.isFinite(dom.audio.duration) && dom.audio.duration > 0) {
        updateProgressUI(seekTargetRatio * dom.audio.duration, dom.audio.duration);
      }
    });
  }

  dom.progressBar.addEventListener("pointerdown", (e) => {
    if (!Number.isFinite(dom.audio.duration) || dom.audio.duration <= 0) return;
    isDraggingSeek = true;
    dom.progressBar.classList.add("dragging");
    dom.progressBar.setPointerCapture(e.pointerId);
    seekTargetRatio = getRatioFromPointer(e);
    updateProgressUI(seekTargetRatio * dom.audio.duration, dom.audio.duration);
  });

  dom.progressBar.addEventListener("pointermove", (e) => {
    if (!isDraggingSeek) return;
    seekTargetRatio = getRatioFromPointer(e);
    scheduleDragRender();
  });

  function finishSeekDrag(e) {
    if (!isDraggingSeek) return;
    isDraggingSeek = false;
    dom.progressBar.classList.remove("dragging");
    if (dom.progressBar.hasPointerCapture(e.pointerId)) {
      dom.progressBar.releasePointerCapture(e.pointerId);
    }
    if (seekRafId !== null) {
      cancelAnimationFrame(seekRafId);
      seekRafId = null;
    }
    if (Number.isFinite(dom.audio.duration) && dom.audio.duration > 0) {
      applySeek(seekTargetRatio * dom.audio.duration);
    }
  }

  dom.progressBar.addEventListener("pointerup", finishSeekDrag);
  dom.progressBar.addEventListener("pointercancel", finishSeekDrag);

  dom.progressBar.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      applySeek((dom.audio.currentTime || 0) - 15);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      applySeek((dom.audio.currentTime || 0) + 15);
    }
  });

  /* ============================================================
     ĐIỀU KHIỂN PHÁT & CÁC NÚT CHÍNH
  ============================================================ */
  dom.rewind15Btn.addEventListener("click", () => applySeek((dom.audio.currentTime || 0) - 15));
  dom.forward15Btn.addEventListener("click", () => applySeek((dom.audio.currentTime || 0) + 15));
  dom.prevEpBtn.addEventListener("click", () => stepEpisode(-1));
  dom.nextEpBtn.addEventListener("click", () => stepEpisode(1));
  dom.playPauseBtn.addEventListener("click", togglePlay);

  dom.autoNextToggle.addEventListener("change", (e) => {
    state.autoNext = e.target.checked;
    scheduleSaveState(true);
  });

  /* ============================================================
     DOCK: TỐC ĐỘ PHÁT & HẸN GIỜ TẮT
  ============================================================ */
  function openDock(tab = "speed") {
    state.activeDockTab = tab;
    renderDock();
    dom.dockBackdrop.classList.add("open");
    dom.dockBackdrop.setAttribute("aria-hidden", "false");
  }

  function closeDock() {
    dom.dockBackdrop.classList.remove("open");
    dom.dockBackdrop.setAttribute("aria-hidden", "true");
  }

  function renderDock() {
    const isTimer = state.activeDockTab === "timer";
    dom.dockTabTimer.classList.toggle("active", isTimer);
    dom.dockTabSpeed.classList.toggle("active", !isTimer);

    const fragment = document.createDocumentFragment();

    if (isTimer) {
      for (const opt of TIMER_OPTIONS) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `pill-opt${opt.isRed ? " red" : ""}`;
        btn.dataset.timerId = opt.id;

        const isActive = (opt.id === "off" && !state.timerMode) || state.timerMode === opt.id;
        if (isActive) btn.classList.add("active");

        btn.textContent = opt.label;
        fragment.appendChild(btn);
      }
    } else {
      for (const rate of RATES) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pill-opt";
        btn.dataset.rate = String(rate);
        if (state.currentRate === rate) btn.classList.add("active");
        btn.textContent = `${rate}x`;
        fragment.appendChild(btn);
      }
    }

    dom.pillOptionsBar.replaceChildren(fragment);
  }

  dom.pillOptionsBar.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill-opt");
    if (!btn) return;

    if (btn.dataset.timerId) {
      const id = btn.dataset.timerId;
      if (id === "off") clearTimer();
      else if (id === "end") setTimerEndEpisode();
      else setTimerMinutes(parseInt(id, 10));
      renderDock();
    } else if (btn.dataset.rate) {
      setSpeed(Number(btn.dataset.rate));
      renderDock();
    }
  });

  function updateTimerUI(label) {
    if (label) {
      dom.timerInlineBadge.textContent = label;
      dom.timerInlineBadge.classList.remove("hidden");
      dom.dockTimerText.textContent = label;
    } else {
      dom.timerInlineBadge.textContent = "";
      dom.timerInlineBadge.classList.add("hidden");
      dom.dockTimerText.textContent = "Hẹn giờ";
    }
  }

  function setSpeed(rate) {
    const validRate = RATES.includes(rate) ? rate : DEFAULT_RATE;
    state.currentRate = validRate;
    dom.audio.playbackRate = validRate;

    const label = `${validRate}x`;
    dom.speedLabel.textContent = label;
    dom.dockSpeedText.textContent = label;
    dom.openSpeedModalBtn.classList.toggle("is-active", validRate !== 1 || Boolean(state.timerMode));

    syncMediaPositionState();
    scheduleSaveState(true);
  }

  function clearTimer() {
    clearInterval(state.timerIntervalId);
    state.timerMode = null;
    state.timerIntervalId = null;
    state.timerRemainingSec = 0;
    updateTimerUI("");
    dom.openSpeedModalBtn.classList.toggle("is-active", state.currentRate !== 1);
  }

  function setTimerMinutes(min) {
    clearTimer();
    state.timerMode = String(min);
    state.timerRemainingSec = min * 60;
    updateTimerUI(`${min}p`);
    dom.openSpeedModalBtn.classList.add("is-active");

    state.timerIntervalId = setInterval(() => {
      state.timerRemainingSec -= 1;
      if (state.timerRemainingSec <= 0) {
        dom.audio.pause();
        clearTimer();
        showStatus("Đã hết thời gian hẹn giờ.");
      } else {
        updateTimerUI(`${Math.ceil(state.timerRemainingSec / 60)}p`);
      }
    }, 1000);
  }

  function setTimerEndEpisode() {
    clearTimer();
    state.timerMode = "end";
    updateTimerUI("Hết tập");
    dom.openSpeedModalBtn.classList.add("is-active");
  }

  dom.openSpeedModalBtn.addEventListener("click", () => openDock("speed"));
  dom.dockTabSpeed.addEventListener("click", () => {
    state.activeDockTab = "speed";
    renderDock();
  });
  dom.dockTabTimer.addEventListener("click", () => {
    state.activeDockTab = "timer";
    renderDock();
  });
  dom.dockCloseBtn.addEventListener("click", closeDock);
  dom.dockBackdrop.addEventListener("click", (e) => {
    if (e.target === dom.dockBackdrop) closeDock();
  });

  /* ============================================================
     DANH SÁCH TẬP & CHUYỂN PLAYLIST
  ============================================================ */
  function renderPartTabs() {
    const fragment = document.createDocumentFragment();
    for (const pl of PLAYLISTS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `part-tab-btn${state.part === pl.id ? " active" : ""}`;
      btn.dataset.part = pl.id;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", String(state.part === pl.id));
      btn.textContent = pl.tabLabel;
      fragment.appendChild(btn);
    }
    dom.sheetTabs.replaceChildren(fragment);
  }

  function updateActiveTabHighlight(part) {
    dom.sheetTabs.querySelectorAll(".part-tab-btn").forEach(btn => {
      const isActive = btn.dataset.part === part;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", String(isActive));
    });
  }

  function createPlayingIndicator() {
    const marker = document.createElement("span");
    marker.className = "sheet-ep-playing";
    marker.setAttribute("aria-label", "Đang phát");
    for (let i = 0; i < 3; i += 1) {
      const bar = document.createElement("span");
      bar.className = "eq-bar";
      marker.appendChild(bar);
    }
    return marker;
  }

  function updateActiveEpisodeRow() {
    const prev = dom.epListContainer.querySelector(".sheet-ep-item.active");
    if (prev) {
      prev.classList.remove("active");
      prev.setAttribute("aria-current", "false");
      prev.querySelector(".sheet-ep-playing")?.remove();
    }

    if (!state.current || state.current.part !== state.part) return;

    const next = dom.epListContainer.querySelector(
      `.sheet-ep-item[data-id="${state.current.id}"]`
    );
    if (next) {
      next.classList.add("active");
      next.setAttribute("aria-current", "true");
      next.appendChild(createPlayingIndicator());
    }
  }

  function renderEpisodeList(force = false) {
    const query = dom.sheetSearchInput.value.trim().toLocaleLowerCase("vi");

    if (!force && state.renderedPart === state.part && state.renderedQuery === query) {
      return;
    }

    state.renderedPart = state.part;
    state.renderedQuery = query;

    const fullList = state.playlists.get(state.part) || [];
    const list = query
      ? fullList.filter(item => item._searchKey.includes(query))
      : fullList;

    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "sheet-empty";
      empty.textContent = fullList.length
        ? "Không tìm thấy tập phù hợp."
        : "Đang tải danh sách tập...";
      dom.epListContainer.replaceChildren(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    const curId = state.current?.part === state.part ? state.current.id : null;

    for (const ep of list) {
      const isCur = curId === ep.id;
      const row = document.createElement("button");
      row.type = "button";
      row.className = `sheet-ep-item${isCur ? " active" : ""}`;
      row.dataset.id = String(ep.id);
      row.setAttribute("aria-current", isCur ? "true" : "false");

      const info = document.createElement("span");
      info.className = "sheet-ep-info";

      const title = document.createElement("span");
      title.className = "sheet-ep-title";
      title.textContent = ep.title;

      const sub = document.createElement("span");
      sub.className = "sheet-ep-sub";
      sub.textContent = `Chương ${ep.chapter_start} – ${ep.chapter_end}`;

      info.append(title, sub);
      row.appendChild(info);

      if (isCur) {
        row.appendChild(createPlayingIndicator());
      }

      fragment.appendChild(row);
    }

    dom.epListContainer.replaceChildren(fragment);
  }

  async function switchPart(part) {
    if (!PLAYLIST_MAP.has(part)) return;

    state.part = part;
    updateActiveTabHighlight(part);

    try {
      await loadPart(part);
      showStatus("");
    } catch {
      renderEpisodeList(true);
      return;
    }

    renderEpisodeList(true);

    if (dom.bottomSheet.classList.contains("open")) {
      scrollToActiveEpisode(false);
    }
  }

  function scrollToActiveEpisode(smooth = true) {
    const activeItem = dom.epListContainer.querySelector(".sheet-ep-item.active");
    if (activeItem) {
      activeItem.scrollIntoView({
        block: "center",
        behavior: smooth ? "smooth" : "auto"
      });
    }
  }

  function openSheet() {
    renderEpisodeList();
    dom.bottomSheet.classList.add("open");
    dom.bottomSheet.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => scrollToActiveEpisode(false));
  }

  function closeSheet() {
    dom.bottomSheet.classList.remove("open");
    dom.bottomSheet.setAttribute("aria-hidden", "true");
  }

  dom.epListContainer.addEventListener("click", (event) => {
    const row = event.target.closest(".sheet-ep-item");
    if (!row || !dom.epListContainer.contains(row)) return;

    const list = state.playlists.get(state.part) || [];
    const idx = state.episodeIndex.get(state.part)?.get(Number(row.dataset.id));
    const ep = idx !== undefined ? list[idx] : null;

    if (ep) {
      const savedPartHistory = state.history[ep.part];
      const resumeSec = savedPartHistory && savedPartHistory.id === ep.id
        ? Number(savedPartHistory.time || 0)
        : 0;
      playEpisode(ep, resumeSec, true);
      closeSheet();
    }
  });

  dom.sheetTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".part-tab-btn");
    if (!btn || !btn.dataset.part) return;
    switchPart(btn.dataset.part);
  });

  let searchDebounceTimer = null;
  dom.sheetSearchInput.addEventListener("input", () => {
    dom.searchClearBtn.classList.toggle("hidden", !dom.sheetSearchInput.value);
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => renderEpisodeList(), 150);
  });

  dom.searchClearBtn.addEventListener("click", () => {
    dom.sheetSearchInput.value = "";
    dom.searchClearBtn.classList.add("hidden");
    renderEpisodeList();
    dom.sheetSearchInput.focus();
  });

  dom.scrollToActiveBtn.addEventListener("click", () => scrollToActiveEpisode(true));
  dom.drawerOpenBtn.addEventListener("click", openSheet);
  dom.navChannelBtn.addEventListener("click", openSheet);
  dom.sheetScrim.addEventListener("click", closeSheet);

  /* ============================================================
     MEDIA SESSION & PHÍM TẮT
  ============================================================ */
  function updateMediaSessionMetadata(ep) {
    if (!("mediaSession" in navigator) || !("MediaMetadata" in window)) return;
    const meta = PLAYLIST_MAP.get(ep.part);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: ep.title,
      artist: "Haron Audio",
      album: meta ? meta.title : ep.part
    });
  }

  function syncMediaPositionState() {
    if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
    const duration = dom.audio.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;

    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: state.currentRate,
        position: Math.min(duration, Math.max(0, dom.audio.currentTime || 0))
      });
    } catch {
      // Bỏ qua nếu trình duyệt không hỗ trợ.
    }
  }

  if ("mediaSession" in navigator && navigator.mediaSession.setActionHandler) {
    try {
      navigator.mediaSession.setActionHandler("play", () => dom.audio.play().catch(() => {}));
      navigator.mediaSession.setActionHandler("pause", () => dom.audio.pause());
      navigator.mediaSession.setActionHandler("previoustrack", () => stepEpisode(-1));
      navigator.mediaSession.setActionHandler("nexttrack", () => stepEpisode(1));
      navigator.mediaSession.setActionHandler("seekbackward", (details) => {
        applySeek((dom.audio.currentTime || 0) - (details.seekOffset || 15));
      });
      navigator.mediaSession.setActionHandler("seekforward", (details) => {
        applySeek((dom.audio.currentTime || 0) + (details.seekOffset || 15));
      });
    } catch {
      // Một số action có thể không được hỗ trợ trên thiết bị cụ thể.
    }
  }

  document.addEventListener("keydown", (e) => {
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      if (e.key === "Escape") {
        e.target.blur();
        closeSheet();
      }
      return;
    }

    if (e.key === "Escape") {
      closeDock();
      closeSheet();
      return;
    }

    if (e.code === "Space") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      applySeek((dom.audio.currentTime || 0) - 15);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      applySeek((dom.audio.currentTime || 0) + 15);
    }
  });

  /* ============================================================
     LƯU TRẠNG THÁI KHI RỜI TRANG
  ============================================================ */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") scheduleSaveState(true);
  });
  window.addEventListener("pagehide", () => scheduleSaveState(true));
  window.addEventListener("beforeunload", () => scheduleSaveState(true));

  /* ============================================================
     KHỞI TẠO TRÌNH PHÁT
  ============================================================ */
  (async function init() {
    const saved = readSavedState();
    const initPart = PLAYLIST_MAP.has(saved.part) ? saved.part : DEFAULT_PART;

    if (saved.history && typeof saved.history === "object") {
      state.history = saved.history;
    }

    if (typeof saved.autoNext === "boolean") {
      state.autoNext = saved.autoNext;
      dom.autoNextToggle.checked = saved.autoNext;
    }

    setSpeed(saved.rate ? Number(saved.rate) : DEFAULT_RATE);
    renderPartTabs();
    updateHeaderMeta(initPart);
    updateStepButtons();

    await loadBackgroundManifest();
    pickRandomBackground();

    try {
      await switchPart(initPart);
    } catch {
      showStatus("Không tải được playlist. Kiểm tra kết nối hoặc tệp JSON.");
      return;
    }

    const list = state.playlists.get(initPart) || [];
    const targetId = saved.id ?? state.history[initPart]?.id;
    const target = (targetId && list.find(x => x.id === Number(targetId))) || list[0];

    if (target) {
      const resumeTime = Number(saved.time ?? state.history[initPart]?.time ?? 0);
      await playEpisode(target, resumeTime, false);
    }
  })();
})();
