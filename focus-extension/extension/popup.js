// popup.js
// Handles popup UI + starts a desktop (entire screen) capture session

// -------------------- State --------------------
let currentView = "setup";
let sessionGoal = "";
let sessionDuration = 25; // minutes
let timeRemaining = 0; // seconds
let timerInterval = null;

let debugPoll = null;

// -------------------- DOM --------------------
// (popup script is loaded with `defer`, so these elements exist)
const setupView = document.getElementById("setupView");
const activeView = document.getElementById("activeView");
const summaryView = document.getElementById("summaryView");

const goalInput = document.getElementById("goalInput");
const allowedInput = document.getElementById("allowedInput");

const durationSlider = document.getElementById("durationSlider");
const durationValue = document.getElementById("durationValue");

const startBtn = document.getElementById("startBtn");
const presetBtns = document.querySelectorAll(".preset-btn");

// -------------------- Init --------------------
document.addEventListener("DOMContentLoaded", () => {
  loadState();
  setupEventListeners();

  // If user already typed something (or browser restores input), enable button
  startBtn.disabled = !goalInput.value.trim();
});

function setupEventListeners() {
  // Goal input
  goalInput.addEventListener("input", () => {
    startBtn.disabled = !goalInput.value.trim();
  });

  // Duration slider
  durationSlider.addEventListener("input", () => {
    const value = durationSlider.value;
    durationValue.textContent = `${value} minutes`;
    sessionDuration = parseInt(value, 10);
    updatePresetButtons();
  });

  // Preset buttons
  presetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const duration = parseInt(btn.dataset.duration, 10);
      durationSlider.value = duration;
      sessionDuration = duration;
      durationValue.textContent = `${duration} minutes`;
      updatePresetButtons();
    });
  });

  // Start
  startBtn.addEventListener("click", () => startSession());

  // Pause / End
  const pauseBtn = document.getElementById("pauseBtn");
  if (pauseBtn) pauseBtn.addEventListener("click", pauseSession);

  // New session
  const newSessionBtn = document.getElementById("newSessionBtn");
  if (newSessionBtn) newSessionBtn.addEventListener("click", resetToSetup);
}

function updatePresetButtons() {
  presetBtns.forEach((btn) => {
    const duration = parseInt(btn.dataset.duration, 10);
    btn.classList.toggle("active", duration === sessionDuration);
  });
}

// -------------------- Allowed hosts parsing --------------------
function normalizeAllowedEntry(entry) {
  let s = (entry || "").trim();
  if (!s) return null;

  // allow "*.domain.com"
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  s = s.split("/")[0]; // drop path
  s = s.split("?")[0]; // drop query

  if (s.startsWith("*.")) s = s.slice(2); // store wildcard as base domain
  return s || null;
}

function parseAllowedHosts(text) {
  return (text || "")
    .split(/\n|,|;/g)
    .map(normalizeAllowedEntry)
    .filter(Boolean);
}

// -------------------- Debug preview --------------------
function startDebugPreview() {
  stopDebugPreview();

  const img = document.getElementById("debugFrame");
  if (!img) return;

  debugPoll = setInterval(() => {
    chrome.runtime.sendMessage({ action: "getLatestFrame" }, (res) => {
      const frame = res?.frame;
      if (frame?.dataUrl) {
        img.src = frame.dataUrl;
        img.style.display = "block";
      }
    });
  }, 1000);
}

function stopDebugPreview() {
  if (debugPoll) {
    clearInterval(debugPoll);
    debugPoll = null;
  }
}

// -------------------- Session start/stop --------------------
function sendMessageAsync(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      // If service worker is asleep or any runtime error occurs
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(res ?? { ok: true });
    });
  });
}

function chooseEntireScreenOnce() {
  // NOTE: Must be called from a user gesture (your Start button click)
  return new Promise((resolve) => {
    // Desktop-only capture: avoid window selection (DevTools window errors)
    chrome.desktopCapture.chooseDesktopMedia(["screen"], (streamId) => {
      resolve(streamId || null);
    });
  });
}

async function startSession() {
  // Prevent double clicks
  startBtn.disabled = true;

  try {
    sessionGoal = goalInput.value.trim();
    if (!sessionGoal) return;

    timeRemaining = sessionDuration * 60;

    const allowedListText = (allowedInput?.value || "").trim();
    const allowedHosts = parseAllowedHosts(allowedListText);

    // 0) Pre-warm offscreen doc BEFORE requesting streamId,
    // so the streamId doesn't expire while creating the offscreen document.
    const prep = await sendMessageAsync({ action: "prepareOffscreen" });
    if (!prep?.ok) {
      console.warn("prepareOffscreen failed:", prep?.error);
      // We can still attempt capture; but usually this indicates a manifest/setup issue.
    }

    // 1) Ask user to pick "Entire Screen" (only option now)
    const streamId = await chooseEntireScreenOnce();
    if (!streamId) {
      console.warn("User cancelled screen share.");
      return;
    }

    // 2) Persist popup state
    const now = Date.now();
    await new Promise((resolve) => {
      chrome.storage.local.set(
        {
          isActive: true,
          goal: sessionGoal,
          duration: sessionDuration,
          startTime: now,
          endTime: now + sessionDuration * 60 * 1000,
          allowedHosts,
          allowedListText,
          captureMode: "desktop",
        },
        resolve
      );
    });

    // 3) Start background session WITH streamId
    await sendMessageAsync({
      action: "startSession",
      goal: sessionGoal,
      duration: sessionDuration,
      allowedHosts,
      captureMode: "desktop",
      streamId,
    });

    switchView("active");
    startTimer();
    startDebugPreview();
  } catch (e) {
    console.warn("startSession error:", e);
  } finally {
    // Re-enable only if still on setup (if active, Start button isn't visible anyway)
    if (currentView === "setup") {
      startBtn.disabled = !goalInput.value.trim();
    }
  }
}

function pauseSession() {
  clearInterval(timerInterval);
  timerInterval = null;
  completeSession();
}

function completeSession() {
  clearInterval(timerInterval);
  timerInterval = null;

  stopDebugPreview();

  chrome.storage.local.set({ isActive: false });
  chrome.runtime.sendMessage({ action: "endSession" });

  // Show summary
  const summaryGoalEl = document.getElementById("summaryGoal");
  if (summaryGoalEl) summaryGoalEl.textContent = sessionGoal;

  // Placeholder stats (your real stats probably come from backend later)
  const deepWorkEl = document.getElementById("deepWorkTime");
  if (deepWorkEl) deepWorkEl.textContent = `${Math.max(sessionDuration - 3, 0)}m`;

  switchView("summary");
}

// -------------------- Timer --------------------
function startTimer() {
  const goalEl = document.getElementById("activeGoal");
  if (goalEl) goalEl.textContent = sessionGoal;

  updateTimerDisplay();

  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timeRemaining--;
    updateTimerDisplay();

    if (timeRemaining <= 0) {
      completeSession();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const mins = Math.floor(timeRemaining / 60);
  const secs = Math.max(timeRemaining % 60, 0);

  const timeEl = document.getElementById("timeDisplay");
  if (timeEl) {
    timeEl.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  // Progress circle (565 is your circle circumference in CSS/SVG setup)
  const total = sessionDuration * 60;
  const elapsed = Math.min(total - timeRemaining, total);
  const progress = (elapsed / total) * 565;

  const progressEl = document.getElementById("timerProgress");
  if (progressEl) {
    progressEl.style.strokeDashoffset = 565 - progress;
  }
}

// -------------------- Views --------------------
function resetToSetup() {
  goalInput.value = "";
  startBtn.disabled = true;
  timeRemaining = 0;
  switchView("setup");
}

function switchView(view) {
  setupView.style.display = view === "setup" ? "block" : "none";
  activeView.style.display = view === "active" ? "block" : "none";
  summaryView.style.display = view === "summary" ? "block" : "none";
  currentView = view;
}

// -------------------- Restore state --------------------
function loadState() {
  chrome.storage.local.get(
    ["isActive", "goal", "duration", "endTime", "allowedListText"],
    (data) => {
      if (allowedInput) allowedInput.value = data.allowedListText || "";

      if (data.isActive && data.endTime > Date.now()) {
        sessionGoal = data.goal || "";
        sessionDuration = data.duration || 25;

        // Sync slider UI
        if (durationSlider) durationSlider.value = String(sessionDuration);
        if (durationValue) durationValue.textContent = `${sessionDuration} minutes`;
        updatePresetButtons();

        timeRemaining = Math.floor((data.endTime - Date.now()) / 1000);

        switchView("active");
        startTimer();
        startDebugPreview();
      }
    }
  );
}
