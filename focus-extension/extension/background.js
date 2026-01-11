// background.js (MV3 service worker)
// Uses a real extension tab (capture.html) to run getUserMedia for desktop capture.

let isSessionActive = false;
let sessionGoal = "";
let blockedSites = []; // sites to block during session
let distractionCount = 0; // Web blocked distractions
let monitorAlertCount = 0; // Camera/Focus Monitor alerts
let isOnBreak = false;
let breakEndTime = null;

// Metrics
let sessionStartTime = 0;
let lastDistractionTime = 0;
let longestFocusStreakMs = 0;

let latestFrame = null; // { ts, tabId, dataUrl }
let pendingFrameForAnalysis = null;

// ----- Capture page (extension tab) wiring via Port -----
let captureTabId = null;
let capturePort = null;

let captureReadyResolve = null;
let captureReadyPromise = null;

const DEBUG = true;
function log(...args) {
  if (DEBUG) console.log("[sw]", ...args);
}
function warn(...args) {
  console.warn("[sw]", ...args);
}

function updateStreak() {
  if (!isSessionActive) return;
  const now = Date.now();
  const currentStreak = now - lastDistractionTime;
  if (currentStreak > longestFocusStreakMs) {
    longestFocusStreakMs = currentStreak;
  }
  lastDistractionTime = now;
}

// Catch “Uncaught (in promise)” so it shows with context
self.addEventListener("unhandledrejection", (event) => {
  warn("UNHANDLED REJECTION:", event.reason);
});
self.addEventListener("error", (event) => {
  warn("SW ERROR:", event.message, event.error);
});

function getDebugState() {
  return {
    isSessionActive,
    sessionGoal,
    allowedHostsCount: allowedHosts?.length || 0,
    captureTabId,
    hasCapturePort: !!capturePort,
    latestFrameTs: latestFrame?.ts || null,
  };
}

function safeSendMessage(message) {
  try {
    chrome.runtime.sendMessage(message, () => {
      // Swallow the error if nobody is listening (e.g., popup closed)
      void chrome.runtime.lastError;
    });
  } catch (_) {
    // ignore
  }
}

function waitForCaptureReady(timeoutMs = 7000) {
  if (capturePort) return Promise.resolve(true);
  if (captureReadyPromise) return captureReadyPromise;

  captureReadyPromise = new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      captureReadyPromise = null;
      captureReadyResolve = null;
      reject(new Error("Capture page did not become ready in time"));
    }, timeoutMs);

    captureReadyResolve = () => {
      clearTimeout(t);
      resolve(true);
    };
  });

  return captureReadyPromise;
}

async function ensureCapturePage() {
  // If port exists, we're good
  if (capturePort) return;
  log("ensureCapturePage() begin", {
    captureTabId,
    hasCapturePort: !!capturePort,
  });

  // If tab exists but port is missing, close it and recreate cleanly
  if (captureTabId != null) {
    try {
      await chrome.tabs.remove(captureTabId);
    } catch (_) {}
    captureTabId = null;
  }

  captureReadyPromise = null;
  captureReadyResolve = null;

  // Create a background tab for capture
  const tab = await chrome.tabs.create({
    url: chrome.runtime.getURL("capture.html"),
    active: false,
    pinned: true,
  });
  log("capture tab created", { id: tab.id });

  captureTabId = tab.id;

  await waitForCaptureReady();
  log("capture page ready");
}

async function startCaptureLoop() {
  log("startCaptureLoop() posting pickAndStart");

  await ensureCapturePage();
  if (!capturePort) throw new Error("Capture port not connected");

  capturePort.postMessage({
    action: "pickAndStart",
    payload: {
      intervalMs: 1000,
      maxWidth: 1280,
      maxHeight: 720,
      quality: 0.6,
    },
  });
}

async function stopCaptureLoop() {
  try {
    if (capturePort) capturePort.postMessage({ action: "stop" });
  } catch (_) {}
}

// Listen for the capture page connecting
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "capturePage") return;

  capturePort = port;
  captureTabId = port.sender?.tab?.id ?? captureTabId;

  port.onMessage.addListener((msg) => {
    if (!msg?.action) return;
    log("onConnect", { name: port.name, senderTabId: port.sender?.tab?.id });

    if (msg.action === "ready") {
      if (captureReadyResolve) captureReadyResolve();
      return;
    }

    if (msg.action === "captureFrame") {
      latestFrame = { ts: msg.ts, tabId: msg.tabId, dataUrl: msg.dataUrl };
      pendingFrameForAnalysis = latestFrame;
      maybeAnalyze();
      return;
    }

    if (msg.action === "captureError") {
      console.warn("Capture error:", msg.message);

      const m = String(msg.message || "");

      if (
        m.includes("DevTools") ||
        m.includes("Invalid state") ||
        m.includes("AbortError")
      ) {
        endSession();
        safeSendMessage({
          action: "uiToast",
          message:
            "Screen capture failed. Please close DevTools (if open) and start again, then pick 'Entire screen'.",
        });
      }

      return;
    }
  });

  port.onDisconnect.addListener(() => {
    capturePort = null;
  });
});

// If capture tab is closed, clear state
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === captureTabId) {
    captureTabId = null;
    capturePort = null;
  }
});

// ----- Messages from popup / other extension pages -----
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request?.action === "startSession") {
    startSession(
      request.goal,
      request.duration,
      request.allowedHosts,
      request.streamId
    ).catch((e) => {
      console.warn("startSession failed:", e);
      sendToPopupToast(`startSession failed: ${String(e)}`);
    });

    sendResponse?.({ ok: true });
    return; // sync
  }

  if (request?.action === "endSession") {
    endSession();
    sendResponse?.({ ok: true });
    return;
  }

  if (request.action === "takeBreak") {
    takeBreak();
  } else if (request.action === "resumeSession") {
    resumeSession();
  } else if (request.type === "FOCUS_ALERT") {
    monitorAlertCount++;
    updateStreak();
    // Show Chrome notification for focus alerts (works even when monitor tab not focused)
    showFocusNotification(request.title, request.message);
  }

  if (request?.action === "getLatestFrame") {
    sendResponse({ ok: true, frame: latestFrame });
    return true;
  }

  if (request?.action === "getDebugState") {
    sendResponse({ ok: true, state: getDebugState() });
    return true;
  }
  return true;
});

function sendToPopupToast(message) {
  try {
    safeSendMessage({ action: "uiToast", message });
  } catch (_) {}
}

// ----- Session control -----
async function startSession(goal, duration, allowedHostsFromPopup, streamId) {
  // Stop any previous session capture first
  if (isSessionActive) {
    try {
      await stopCaptureLoop();
    } catch (_) {}
  }

  log("startSession()", {
    goal,
    duration,
    allowedHostsCount: allowedHostsFromPopup?.length || 0,
  });

  isSessionActive = true;
  sessionGoal = goal || "";
  blockedSites = blocked || [];
  distractionCount = 0;

  monitorAlertCount = 0;
  sessionStartTime = Date.now();
  lastDistractionTime = sessionStartTime;
  longestFocusStreakMs = 0;

  chrome.alarms.clear("sessionEnd");
  if (typeof duration === "number" && duration > 0) {
    chrome.alarms.create("sessionEnd", { delayInMinutes: duration });
  }

  await startCaptureLoop();
}

function endSession() {
  // Finalize streak calculation
  if (isSessionActive) {
    const now = Date.now();
    const currentStreak = now - lastDistractionTime;
    if (currentStreak > longestFocusStreakMs) {
      longestFocusStreakMs = currentStreak;
    }
  }

  const stats = {
    distractionCount,
    monitorAlertCount,
    longestFocusStreakMs,
  };

  isSessionActive = false;
  sessionGoal = "";
  blockedSites = [];
  distractionCount = 0;
  isOnBreak = false;
  breakEndTime = null;
  chrome.alarms.clear("sessionEnd");
  chrome.alarms.clear("breakEnd");

  stopCaptureLoop();

  // Optional: close capture tab when session ends
  if (captureTabId != null) {
    chrome.tabs.remove(captureTabId).catch(() => {});
  }
  captureTabId = null;
  capturePort = null;

  // Close any open monitor tabs or windows (Full or Mini)
  const monitorUrl = chrome.runtime.getURL("monitor.html");
  const miniMonitorUrl = chrome.runtime.getURL("mini-monitor.html");

  chrome.tabs.query({}, (tabs) => {
    const tabsToClose = tabs.filter(
      (t) => t.url === monitorUrl || t.url === miniMonitorUrl
    );
    if (tabsToClose.length > 0) {
      chrome.tabs.remove(tabsToClose.map((t) => t.id));
    }
  });

  return stats;
}

function takeBreak() {
  isOnBreak = true;
  breakEndTime = Date.now() + 5 * 60 * 1000; // 5 minutes
  chrome.alarms.create("breakEnd", { delayInMinutes: 5 });

  // Store break state so popup can restore it
  chrome.storage.local.set({ isOnBreak: true, breakEndTime });

  // Notify popup to show break timer
  chrome.runtime.sendMessage({ action: "takeBreak" }).catch(() => {});
}

function resumeSession() {
  isOnBreak = false;
  breakEndTime = null;
  chrome.alarms.clear("breakEnd");

  // Clear break state from storage
  chrome.storage.local.set({ isOnBreak: false, breakEndTime: null });
}

function isHostBlocked(hostname, blockedList) {
  if (!hostname || !blockedList.length) return false;
  return blockedList.some((site) => {
    const cleanSite = site
      .toLowerCase()
      .replace(/^(https?:\/\/)?(www\.)?/, "")
      .split("/")[0];
    return (
      hostname.includes(cleanSite) ||
      hostname === cleanSite ||
      "www." + cleanSite === hostname
    );
  });
}

// ----- Blocking on navigation -----
chrome.webNavigation.onCommitted.addListener((details) => {
  if (!isSessionActive || details.frameId !== 0) return;

  let url;
  try {
    url = new URL(details.url);
  } catch (_) {
    return;
  }

  if (url.protocol.startsWith("chrome")) return;

  // Skip blocking during break
  if (isOnBreak) return;

  const isBlocked = isHostBlocked(url.hostname, blockedSites);

  if (isBlocked) {
    distractionCount++; // Web distraction
    updateStreak(); // Reset streak

    // IMPORTANT: Next export blocked page path
    const blockedUrl =
      chrome.runtime.getURL("blocked/index.html") +
      `?goal=${encodeURIComponent(sessionGoal)}&url=${encodeURIComponent(
        details.url
      )}`;

    chrome.tabs.update(details.tabId, { url: blockedUrl });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "sessionEnd") {
    endSession();
  } else if (alarm.name === "breakEnd") {
    resumeSession();
    // notify popup to resume timer
    chrome.runtime.sendMessage({ action: "breakEnded" }).catch(() => {});
  }
});

// Focus notification with sound (works in background)
let lastNotificationTime = 0;
function showFocusNotification(title, message) {
  const now = Date.now();
  // Throttle: max one notification every 5 seconds
  if (now - lastNotificationTime < 5000) return;
  lastNotificationTime = now;

  const notificationId = "focus-alert-" + now;
  chrome.notifications.create(
    notificationId,
    {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: title || "Focus Alert!",
      message: message || "You seem distracted. Get back on track!",
      priority: 2,
      requireInteraction: false,
      silent: false, // This enables notification sound
    },
    () => {
      // Auto-close after 4 seconds
      setTimeout(() => {
        chrome.notifications.clear(notificationId);
      }, 4000);
    }
  );
}

// Click notification to focus the monitor tab
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith("focus-alert-")) {
    // Find and focus the monitor tab
    chrome.tabs.query(
      { url: chrome.runtime.getURL("monitor.html") },
      (tabs) => {
        if (tabs.length > 0) {
          chrome.tabs.update(tabs[0].id, { active: true });
          chrome.windows.update(tabs[0].windowId, { focused: true });
        }
      }
    );
  }
});

// ----- Analyze pipeline (same as before) -----
const ANALYZE_INTERVAL_MS = 8000;
const SERVER_URL = "http://localhost:3001/analyze";

let inFlightAnalyze = false;
let nextAnalyzeAllowedAt = 0;
let analyzeTimer = null;

function scheduleAnalyze(ms) {
  if (analyzeTimer) clearTimeout(analyzeTimer);
  analyzeTimer = setTimeout(() => {
    analyzeTimer = null;
    maybeAnalyze();
  }, ms);
}

async function maybeAnalyze() {
  if (!isSessionActive) return;
  if (inFlightAnalyze) return;

  const now = Date.now();
  if (now < nextAnalyzeAllowedAt) {
    scheduleAnalyze(nextAnalyzeAllowedAt - now);
    return;
  }

  if (!pendingFrameForAnalysis) return;

  const frame = pendingFrameForAnalysis;
  pendingFrameForAnalysis = null;

  inFlightAnalyze = true;

  try {
    const [tab] = await chrome.tabs
      .query({ active: true, currentWindow: true })
      .catch(() => []);

    const payload = {
      goal: sessionGoal,
      url: tab?.url || "",
      title: tab?.title || "",
      ts: frame.ts,
      screenshotDataUrl: frame.dataUrl,
    };

    const res = await fetch(SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    if (!json?.ok) {
      console.warn("analyze failed:", json?.error || json);
      return;
    }

    const v = json.verdict;
    console.log("verdict:", v);

    if (v?.distracted && (v.confidence ?? 0) >= 0.7) {
      const blockedUrl =
        chrome.runtime.getURL("blocked/index.html") +
        `?goal=${encodeURIComponent(sessionGoal)}`;

      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (activeTab?.id != null)
        await chrome.tabs.update(activeTab.id, { url: blockedUrl });
    }
  } catch (e) {
    console.warn("analyze error:", e);
  } finally {
    inFlightAnalyze = false;
    nextAnalyzeAllowedAt = Date.now() + ANALYZE_INTERVAL_MS;

    if (pendingFrameForAnalysis) maybeAnalyze();
  }
}
