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
    blockedSitesCount: blockedSites?.length || 0,
    distractionCount,
    isOnBreak,
    breakEndTime,
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

function sendToPopupToast(message) {
  safeSendMessage({ action: "uiToast", message });
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

  captureTabId = tab.id;
  log("capture tab created", { id: tab.id });

  await waitForCaptureReady();
  log("capture page ready");
}

async function startCaptureLoop(streamId) {
  log("startCaptureLoop() posting pickAndStart", { streamIdPresent: !!streamId });

  await ensureCapturePage();
  if (!capturePort) throw new Error("Capture port not connected");
  if (!streamId) throw new Error("Missing streamId (user must pick a screen)");

  // IMPORTANT: pass streamId to capture page so it can call getUserMedia correctly
  capturePort.postMessage({
    action: "pickAndStart",
    payload: {
      streamId,
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
    log("onConnect msg", { action: msg.action, senderTabId: port.sender?.tab?.id });

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
      warn("Capture error:", msg.message);

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
    startSession(request.goal, request.duration, request.blockedSites, request.streamId)
      .then(() => sendResponse?.({ ok: true }))
      .catch((e) => {
        warn("startSession failed:", e);
        sendToPopupToast(`startSession failed: ${String(e?.message ?? e)}`);
        sendResponse?.({ ok: false, error: String(e?.message ?? e) });
      });

    return true; // async
  }

  if (request?.action === "endSession") {
    const stats = endSession();
    sendResponse?.({ ok: true, stats });
    return true;
  }

  if (request?.action === "takeBreak") {
    takeBreak();
    sendResponse?.({ ok: true });
    return true;
  }

  if (request?.action === "resumeSession") {
    resumeSession();
    sendResponse?.({ ok: true });
    return true;
  }

  if (request?.type === "FOCUS_ALERT") {
    monitorAlertCount++;
    updateStreak();
    showFocusNotification(request.title, request.message);
    sendResponse?.({ ok: true });
    return true;
  }

  if (request?.action === "getLatestFrame") {
    sendResponse({ ok: true, frame: latestFrame });
    return true;
  }

  if (request?.action === "getDebugState") {
    sendResponse({ ok: true, state: getDebugState() });
    return true;
  }

  return false;
});

// ----- Session control -----
async function startSession(goal, duration, blockedSitesFromPopup, streamId) {
  // Stop any previous session capture first
  if (isSessionActive) {
    try {
      await stopCaptureLoop();
    } catch (_) {}
  }

  log("startSession()", {
    goal,
    duration,
    blockedSitesCount: blockedSitesFromPopup?.length || 0,
    streamIdPresent: !!streamId,
  });

  isSessionActive = true;
  sessionGoal = goal || "";
  blockedSites = Array.isArray(blockedSitesFromPopup) ? blockedSitesFromPopup : [];
  distractionCount = 0;

  monitorAlertCount = 0;
  sessionStartTime = Date.now();
  lastDistractionTime = sessionStartTime;
  longestFocusStreakMs = 0;

  isOnBreak = false;
  breakEndTime = null;

  chrome.alarms.clear("sessionEnd");
  chrome.alarms.clear("breakEnd");

  if (typeof duration === "number" && duration > 0) {
    chrome.alarms.create("sessionEnd", { delayInMinutes: duration });
  }

  await startCaptureLoop(streamId);
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

  // Delay closing tabs to ensure storage writes complete
  setTimeout(() => {
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
  }, 100);

  return stats;
}

function takeBreak() {
  isOnBreak = true;
  breakEndTime = Date.now() + 5 * 60 * 1000; // 5 minutes
  chrome.alarms.clear("breakEnd");
  chrome.alarms.create("breakEnd", { delayInMinutes: 5 });

  chrome.storage.local.set({ isOnBreak: true, breakEndTime });
  chrome.runtime.sendMessage({ action: "takeBreak" }).catch(() => {});
}

function resumeSession() {
  isOnBreak = false;
  breakEndTime = null;
  chrome.alarms.clear("breakEnd");

  chrome.storage.local.set({ isOnBreak: false, breakEndTime: null });
  chrome.runtime.sendMessage({ action: "breakEnded" }).catch(() => {});
}

function isHostBlocked(hostname, blockedList) {
  if (!hostname || !blockedList.length) return false;
  return blockedList.some((site) => {
    const cleanSite = String(site || "")
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

  // don't block chrome:// pages etc
  if (url.protocol.startsWith("chrome")) return;

  // Skip blocking during break
  if (isOnBreak) return;

  const isBlocked = isHostBlocked(url.hostname, blockedSites);
  if (isBlocked) {
    distractionCount++; // Web distraction
    updateStreak(); // Reset streak

    const blockedUrl =
      chrome.runtime.getURL("blocked/index.html") +
      `?goal=${encodeURIComponent(sessionGoal)}&url=${encodeURIComponent(details.url)}`;

    chrome.tabs.update(details.tabId, { url: blockedUrl });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "sessionEnd") {
    endSession();
  } else if (alarm.name === "breakEnd") {
    resumeSession();
  }
});

// Focus notification with sound (works in background)
let lastNotificationTime = 0;
function showFocusNotification(title, message) {
  const now = Date.now();
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
      silent: false,
    },
    () => {
      setTimeout(() => chrome.notifications.clear(notificationId), 4000);
    }
  );
}

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith("focus-alert-")) {
    chrome.tabs.query({ url: chrome.runtime.getURL("monitor.html") }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
        chrome.windows.update(tabs[0].windowId, { focused: true });
      }
    });
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
      warn("analyze failed:", json?.error || json);
      return;
    }

    const v = json.verdict;
    log("verdict:", v);

    if (v?.distracted && (v.confidence ?? 0) >= 0.7) {
      const blockedUrl =
        chrome.runtime.getURL("blocked/index.html") +
        `?goal=${encodeURIComponent(sessionGoal)}`;

      const [activeTab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (activeTab?.id != null) {
        await chrome.tabs.update(activeTab.id, { url: blockedUrl });
      }
    }
  } catch (e) {
    warn("analyze error:", e);
  } finally {
    inFlightAnalyze = false;
    nextAnalyzeAllowedAt = Date.now() + ANALYZE_INTERVAL_MS;

    if (pendingFrameForAnalysis) maybeAnalyze();
  }
}
