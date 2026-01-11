// background.js (MV3 service worker)
// Desktop screen capture + session blocking + analyzer trigger

// -------------------- Session state --------------------
let isSessionActive = false;
let sessionGoal = "";
let allowedHosts = []; // allowlist of hostnames (baseline)
let distractionCount = 0;

let captureMode = "desktop"; // for now: desktop only
let desktopStreamId = null;

let latestFrame = null; // { ts, tabId, dataUrl }
let pendingFrameForAnalysis = null;

// -------------------- Offscreen lifecycle --------------------
let offscreenIsReady = false;
let offscreenReadyResolve = null;
let offscreenReadyPromise = null;

function waitForOffscreenReady(timeoutMs = 5000) {
  if (offscreenIsReady) return Promise.resolve(true);
  if (offscreenReadyPromise) return offscreenReadyPromise;

  offscreenReadyPromise = new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      offscreenReadyPromise = null;
      offscreenReadyResolve = null;
      reject(new Error("Offscreen did not become ready in time"));
    }, timeoutMs);

    offscreenReadyResolve = () => {
      clearTimeout(t);
      resolve(true);
    };
  });

  return offscreenReadyPromise;
}

async function ensureOffscreen() {
  if (!chrome.offscreen?.createDocument) {
    throw new Error(
      "chrome.offscreen is not available. Check manifest permissions + reload extension."
    );
  }

  // Prefer getContexts when available
  if (chrome.runtime?.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
    if (contexts.length > 0) return;
  } else if (chrome.offscreen?.hasDocument) {
    if (await chrome.offscreen.hasDocument()) return;
  }

  // reset readiness each time we create
  offscreenIsReady = false;
  offscreenReadyPromise = null;
  offscreenReadyResolve = null;

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Capture desktop frames during an active focus session",
  });

  await waitForOffscreenReady();
}

async function startCaptureLoop() {
  await ensureOffscreen();

  if (!desktopStreamId) throw new Error("Missing desktop streamId");

  await chrome.runtime.sendMessage({
    action: "offscreenStartCapture",
    payload: {
      mode: "desktop",
      streamId: desktopStreamId,
      intervalMs: 1000,
      maxWidth: 1280,
      maxHeight: 720,
      quality: 0.6,
    },
  });
}

async function stopCaptureLoop() {
  try {
    await chrome.runtime.sendMessage({ action: "offscreenStopCapture" });
  } catch (_) {}
}

// -------------------- Messages --------------------
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Offscreen ready ping
  if (request?.action === "offscreenReady") {
    offscreenIsReady = true;
    if (offscreenReadyResolve) offscreenReadyResolve();
    sendResponse?.({ ok: true });
    return; // sync
  }

  // Pre-warm offscreen so desktop streamId won't expire while creating it
  if (request?.action === "prepareOffscreen") {
    ensureOffscreen()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true; // keep channel open for async sendResponse
  }

  if (request?.action === "startSession") {
    // fire-and-forget start
    startSession(
      request.goal,
      request.duration,
      request.allowedHosts,
      request.captureMode,
      request.streamId
    ).catch((e) => {
      console.warn("startSession failed:", e);
      chrome.runtime.sendMessage({
        action: "captureError",
        message: `startSession failed: ${String(e)}`,
      });
    });
    sendResponse?.({ ok: true });
    return; // sync
  }

  if (request?.action === "endSession") {
    endSession();
    sendResponse?.({ ok: true });
    return; // sync
  }

  if (request?.action === "captureFrame") {
    latestFrame = {
      ts: request.ts,
      tabId: request.tabId,
      dataUrl: request.dataUrl,
    };

    pendingFrameForAnalysis = latestFrame;
    maybeAnalyze(); // self-throttles

    // Optional: noisy, but useful for debugging
    // console.log("frame", latestFrame.ts);

    sendResponse?.({ ok: true });
    return; // sync
  }

  if (request?.action === "captureError") {
    console.warn("Capture error:", request.message);

    // If user accidentally selected a DevTools surface, stop session cleanly
    if (String(request.message).includes("DevTools")) {
      endSession();

      // Tell popup UI (if open) to show a friendly hint
      chrome.runtime.sendMessage({
        action: "uiToast",
        message: "Screen capture can't use DevTools windows. Please start again and pick 'Entire Screen'.",
      });
    }

    sendResponse?.({ ok: true });
    return; // sync
  }


  if (request?.action === "getLatestFrame") {
    sendResponse({ ok: true, frame: latestFrame });
    return true; // keep channel open (SW safety)
  }
});

// -------------------- Session control --------------------
async function startSession(goal, duration, allowed, mode, streamId) {
  // If already active, stop any previous capture loop first (prevents races)
  if (isSessionActive) {
    try { await stopCaptureLoop(); } catch (_) {}
  }

  isSessionActive = true;
  sessionGoal = goal || "";
  allowedHosts = Array.isArray(allowed) ? allowed : [];
  captureMode = mode || "desktop";
  desktopStreamId = streamId || null;

  chrome.alarms.clear("sessionEnd");
  if (typeof duration === "number" && duration > 0) {
    chrome.alarms.create("sessionEnd", { delayInMinutes: duration });
  }

  // Start capture
  await startCaptureLoop();
}


function endSession() {
  isSessionActive = false;
  sessionGoal = "";
  allowedHosts = [];
  distractionCount = 0;

  chrome.alarms.clear("sessionEnd");
  stopCaptureLoop();
}

// -------------------- Blocking on navigation --------------------
chrome.webNavigation.onCommitted.addListener((details) => {
  if (!isSessionActive || details.frameId !== 0) return;

  let url;
  try {
    url = new URL(details.url);
  } catch (_) {
    return;
  }

  // don't block chrome://, chrome-extension://, etc.
  if (url.protocol.startsWith("chrome")) return;

  function hostAllowed(hostname) {
    if (!hostname) return false;
    if (!allowedHosts.length) return true; // if empty: allow everything
    return allowedHosts.some(
      (base) => hostname === base || hostname.endsWith("." + base)
    );
  }

  const isAllowed = hostAllowed(url.hostname);

  if (!isAllowed) {
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

// -------------------- Analyze pipeline (no overlap, drop old frames) --------------------
const ANALYZE_INTERVAL_MS = 8000; // tune: 8000–15000
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
  pendingFrameForAnalysis = null; // consume newest only

  inFlightAnalyze = true;

  try {
    // Desktop capture: we analyze the current active tab’s URL/title
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

      if (activeTab?.id != null) {
        await chrome.tabs.update(activeTab.id, { url: blockedUrl });
      }
    }
  } catch (e) {
    console.warn("analyze error:", e);
  } finally {
    inFlightAnalyze = false;
    nextAnalyzeAllowedAt = Date.now() + ANALYZE_INTERVAL_MS;

    // If newer frame arrived while analyzing, run again when allowed
    if (pendingFrameForAnalysis) maybeAnalyze();
  }
}
