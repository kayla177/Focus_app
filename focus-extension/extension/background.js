// background.js (MV3 service worker)
// Uses a real extension tab (capture.html) to run getUserMedia for desktop capture.

let isSessionActive = false;
let sessionGoal = "";
let allowedHosts = [];
let distractionCount = 0;

let latestFrame = null; // { ts, tabId, dataUrl }
let pendingFrameForAnalysis = null;

// ----- Capture page (extension tab) wiring via Port -----
let captureTabId = null;
let capturePort = null;

let captureReadyResolve = null;
let captureReadyPromise = null;

const DEBUG = true;
function log(...args) { if (DEBUG) console.log("[sw]", ...args); }
function warn(...args) { console.warn("[sw]", ...args); }

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
  log("ensureCapturePage() begin", { captureTabId, hasCapturePort: !!capturePort });


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

  if (request?.action === "getLatestFrame") {
    sendResponse({ ok: true, frame: latestFrame });
    return true;
  }

  if (request?.action === "getDebugState") {
  sendResponse({ ok: true, state: getDebugState() });
  return true;
}

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

  log("startSession()", { goal, duration, allowedHostsCount: allowedHostsFromPopup?.length || 0 });

  isSessionActive = true;
  sessionGoal = goal || "";
  allowedHosts = Array.isArray(allowedHostsFromPopup)
    ? allowedHostsFromPopup
    : [];
  distractionCount = 0;

  chrome.alarms.clear("sessionEnd");
  if (typeof duration === "number" && duration > 0) {
    chrome.alarms.create("sessionEnd", { delayInMinutes: duration });
  }

  await startCaptureLoop();
}

function endSession() {
  isSessionActive = false;
  sessionGoal = "";
  allowedHosts = [];
  distractionCount = 0;
  log("endSession()");


  chrome.alarms.clear("sessionEnd");
  stopCaptureLoop();

  // Optional: close capture tab when session ends
  if (captureTabId != null) {
    chrome.tabs.remove(captureTabId).catch(() => {});
  }
  captureTabId = null;
  capturePort = null;
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

  function hostAllowed(hostname) {
    if (!hostname) return false;
    if (!allowedHosts.length) return true;
    return allowedHosts.some(
      (base) => hostname === base || hostname.endsWith("." + base)
    );
  }

  if (!hostAllowed(url.hostname)) {
    distractionCount++;

    const blockedUrl =
      chrome.runtime.getURL("blocked/index.html") +
      `?goal=${encodeURIComponent(sessionGoal)}`;

    chrome.tabs.update(details.tabId, { url: blockedUrl });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "sessionEnd") endSession();
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
