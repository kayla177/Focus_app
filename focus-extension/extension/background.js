// Session management
let isSessionActive = false;
let sessionGoal = "";
let allowedHost = []; // only the starting tab host (baseline)
let distractionCount = 0;

let latestFrame = null; // { ts, tabId, dataUrl } — for now keep last only
let offscreenIsReady = false;


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "offscreenReady") {
    offscreenIsReady = true;
    if (offscreenReadyResolve) offscreenReadyResolve();
    sendResponse?.({ ok: true });
    return;
  }

  if (request.action === "startSession") {
    startSession(request.goal, request.duration, request.allowedHosts);
  } else if (request.action === "endSession") {
    endSession();
  } else if (request.action === "captureFrame") {
    // For now: store last frame (later you'll POST to your API)
    latestFrame = { ts: request.ts, tabId: request.tabId, dataUrl: request.dataUrl };
    console.log("frame", latestFrame.ts, latestFrame.dataUrl?.slice(0, 50));
  } else if (request.action === "captureError") {
    console.warn("Capture error:", request.message);
  }

  if (request.action === "getLatestFrame") {
    sendResponse({ ok: true, frame: latestFrame });
    return true; // IMPORTANT: keeps the message channel open for async SW
  }
});

let offscreenReadyResolve = null;
let offscreenReadyPromise = null;

function waitForOffscreenReady(timeoutMs = 5000) {
  if (offscreenIsReady) return Promise.resolve(true); // ✅ key line
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
    throw new Error("chrome.offscreen is not available. Check manifest permissions + reload extension.");
  }

  // Prefer runtime contexts check when available
  if (chrome.runtime?.getContexts) {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    if (contexts.length > 0) return;
  } else if (chrome.offscreen?.hasDocument) {
    if (await chrome.offscreen.hasDocument()) return;
  }

  // reset promise each time we create
offscreenIsReady = false;
offscreenReadyPromise = null;
offscreenReadyResolve = null;

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["USER_MEDIA"],
    justification: "Capture focused tab frames during an active focus session"
  });

  // wait until offscreen.js runs and announces readiness
  await waitForOffscreenReady();
}


async function startCaptureLoop() {
  await ensureOffscreen();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });

  // send message (if it fails, retry once)
  try {
    await chrome.runtime.sendMessage({
      action: "offscreenStartCapture",
      payload: { tabId: tab.id, streamId, intervalMs: 1000, maxWidth: 1280, maxHeight: 720, quality: 0.6 }
    });
  } catch (e) {
    // one quick retry
    await new Promise(r => setTimeout(r, 150));
    await chrome.runtime.sendMessage({
      action: "offscreenStartCapture",
      payload: { tabId: tab.id, streamId, intervalMs: 1000, maxWidth: 1280, maxHeight: 720, quality: 0.6 }
    });
  }
}



async function stopCaptureLoop() {
  try {
    chrome.runtime.sendMessage({ action: "offscreenStopCapture" });
  } catch (_) {}
}

function startSession(goal, duration, allowed) {
  isSessionActive = true;
  sessionGoal = goal || "";
  distractionCount = 0;
  allowedHosts = Array.isArray(allowed) ? allowed : [];

  chrome.alarms.create("sessionEnd", { delayInMinutes: duration });
  startCaptureLoop();
}


function endSession() {
  isSessionActive = false;
  sessionGoal = "";
  allowedHost = "";
  chrome.alarms.clear("sessionEnd");

  // Stop capture
  stopCaptureLoop();
}

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

  function hostAllowed(hostname) {
    if (!hostname) return false;
    if (!allowedHosts.length) return true; // if empty, allow everything for now
    return allowedHosts.some((base) => hostname === base || hostname.endsWith("." + base));
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
