// State management
let currentView = 'setup';
let sessionGoal = '';
let sessionDuration = 25;
let timeRemaining = 0;
let timerInterval = null;
let debugPoll = null;

// DOM elements
const setupView = document.getElementById('setupView');
const activeView = document.getElementById('activeView');
const summaryView = document.getElementById('summaryView');
const goalInput = document.getElementById('goalInput');
const durationSlider = document.getElementById('durationSlider');
const durationValue = document.getElementById('durationValue');
const startBtn = document.getElementById('startBtn');
const presetBtns = document.querySelectorAll('.preset-btn');
const allowedInput = document.getElementById('allowedInput');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadState();
  setupEventListeners();
});

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

function setupEventListeners() {
  // Goal input
  goalInput.addEventListener('input', () => {
    startBtn.disabled = !goalInput.value.trim();
  });

  // Duration slider
  durationSlider.addEventListener('input', () => {
    const value = durationSlider.value;
    durationValue.textContent = `${value} minutes`;
    sessionDuration = parseInt(value);
    updatePresetButtons();
  });

  // Preset buttons
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const duration = parseInt(btn.dataset.duration);
      durationSlider.value = duration;
      sessionDuration = duration;
      durationValue.textContent = `${duration} minutes`;
      updatePresetButtons();
    });
  });

  // Start button
  startBtn.addEventListener('click', startSession);

  // Pause button
  document.getElementById('pauseBtn').addEventListener('click', pauseSession);

  // New session button
  document.getElementById('newSessionBtn').addEventListener('click', resetToSetup);
}

function updatePresetButtons() {
  presetBtns.forEach(btn => {
    const duration = parseInt(btn.dataset.duration);
    btn.classList.toggle('active', duration === sessionDuration);
  });
}

function normalizeAllowedEntry(entry) {
  let s = (entry || '').trim();
  if (!s) return null;

  // allow "*.domain.com"
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/^www\./, '');
  s = s.split('/')[0];        // drop path
  s = s.split('?')[0];        // drop query

  if (s.startsWith('*.')) s = s.slice(2); // store wildcard as base domain
  return s || null;
}

function parseAllowedHosts(text) {
  return (text || '')
    .split(/\n|,|;/g)
    .map(normalizeAllowedEntry)
    .filter(Boolean);
}


function startSession() {
  sessionGoal = goalInput.value.trim();
  timeRemaining = sessionDuration * 60;

  const allowedListText = (allowedInput?.value || '').trim();
  const allowedHosts = parseAllowedHosts(allowedListText);

  // Save state (store the raw text so we can re-populate the textarea)
  chrome.storage.local.set({
    isActive: true,
    goal: sessionGoal,
    duration: sessionDuration,
    startTime: Date.now(),
    endTime: Date.now() + (sessionDuration * 60 * 1000),
    allowedHosts,          // normalized array
    allowedListText        // raw textarea value
  });

  // Send message to background script
  chrome.runtime.sendMessage({
    action: 'startSession',
    goal: sessionGoal,
    duration: sessionDuration,
    allowedHosts
  });

  switchView('active');
  startTimer();
  startDebugPreview();
}


function startTimer() {
  document.getElementById('activeGoal').textContent = sessionGoal;
  updateTimerDisplay();

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
  const secs = timeRemaining % 60;
  document.getElementById('timeDisplay').textContent = 
    `${mins}:${secs.toString().padStart(2, '0')}`;

  // Update progress circle
  const progress = ((sessionDuration * 60 - timeRemaining) / (sessionDuration * 60)) * 565;
  document.getElementById('timerProgress').style.strokeDashoffset = 565 - progress;
}

function pauseSession() {
  clearInterval(timerInterval);
  completeSession();
}

function completeSession() {
  clearInterval(timerInterval);
  stopDebugPreview();
  
  chrome.storage.local.set({ isActive: false });
  chrome.runtime.sendMessage({ action: 'endSession' });

  // Show summary
  document.getElementById('summaryGoal').textContent = sessionGoal;
  document.getElementById('deepWorkTime').textContent = `${sessionDuration - 3}m`;
  
  switchView('summary');
}

function resetToSetup() {
  goalInput.value = '';
  startBtn.disabled = true;
  timeRemaining = 0;
  switchView('setup');
}

function switchView(view) {
  setupView.style.display = view === 'setup' ? 'block' : 'none';
  activeView.style.display = view === 'active' ? 'block' : 'none';
  summaryView.style.display = view === 'summary' ? 'block' : 'none';
  currentView = view;
}

function loadState() {
  chrome.storage.local.get(['isActive', 'goal', 'duration', 'endTime', 'allowedListText'], (data) => {
    if (allowedInput) {
      allowedInput.value = data.allowedListText || '';
    }

    if (data.isActive && data.endTime > Date.now()) {
      sessionGoal = data.goal;
      sessionDuration = data.duration;
      timeRemaining = Math.floor((data.endTime - Date.now()) / 1000);
      switchView('active');
      startTimer();
      startDebugPreview();
    }
  });
}
