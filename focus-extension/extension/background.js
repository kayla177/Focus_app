// Session management
let isSessionActive = false;
let sessionGoal = "";
let blockedSites = []; // sites to block during session
let distractionCount = 0; // Web blocked distractions
let monitorAlertCount = 0; // Camera/Focus Monitor alerts
let isOnBreak = false;
let breakEndTime = null;

let latestFrame = null; // { ts, tabId, dataUrl } — for now keep last only
let offscreenIsReady = false;

// Metrics
let sessionStartTime = 0;
let lastDistractionTime = 0;
let longestFocusStreakMs = 0;

// --- Focus nudge state ---
let focusHomeTabId = null; // tab user started the session on
let lastVerdict = null; // keep last LLM verdict (optional)
let lastVerdictAt = 0;
let lastVerdictDistracted = false;

let snoozeUntil = 0; // timestamp ms; when > now, don't nudge
let activeNudgeNotificationId = null;
let activeNudgeTabId = null;

// Notification ids
const NUDGE_PREFIX = "focus-nudge-";
const ALARM_SNOOZE_END = "focusSnoozeEnd";

function updateStreak() {
  if (!isSessionActive) return;
  const now = Date.now();
  const currentStreak = now - lastDistractionTime;
  if (currentStreak > longestFocusStreakMs) {
    longestFocusStreakMs = currentStreak;
  }
  lastDistractionTime = now;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "startSession") {
    startSession(request.goal, request.duration, request.blockedSites);
  } else if (request.action === "endSession") {
    const stats = endSession();
    sendResponse(stats);
  } else if (request.action === "takeBreak") {
    takeBreak();
  } else if (request.action === "resumeSession") {
    resumeSession();
  } else if (request.action === "offscreenReady") {
    offscreenIsReady = true;
    if (offscreenReadyResolve) offscreenReadyResolve();
    sendResponse?.({ ok: true });
    return;
  } else if (request.action === "captureFrame") {
    latestFrame = {
      ts: request.ts,
      tabId: request.tabId,
      dataUrl: request.dataUrl,
    };
    analyzeFrame(latestFrame).catch(console.warn);
    console.log("frame", latestFrame.ts, latestFrame.dataUrl?.slice(0, 50));
  } else if (request.action === "captureError") {
    console.warn("Capture error:", request.message);
  } else if (request.type === "FOCUS_ALERT") {
    monitorAlertCount++;
    updateStreak();
    // Show Chrome notification for focus alerts (works even when monitor tab not focused)
    showFocusNotification(request.title, request.message);
  } else if (request.type === "getLatestFrame") {
    sendResponse({ ok: true, frame: latestFrame });
    return true; // IMPORTANT: keeps the message channel open for async SW
  } // --- Nudge UI actions ---
  else if (request.action === "NUDGE_RETURN_TO_FOCUS") {
    (async () => {
      snoozeUntil = 0;
      await closeNudgeTabIfOpen();
      const ok = await focusBackToHomeTab();
      if (!ok)
        chrome.tabs.create({ url: chrome.runtime.getURL("monitor.html") });
    })();
  } else if (request.action === "NUDGE_SNOOZE_1M") {
    // snooze for 60s, close the nudge UI
    snoozeUntil = Date.now() + 60 * 1000;
    chrome.alarms.create(ALARM_SNOOZE_END, { when: snoozeUntil });
    closeNudgeTabIfOpen();
    // allow them to continue what they were doing (nudge page will navigate back via blocked.js)
  } else if (request.action === "NUDGE_CLOSED") {
    // user closed nudge tab manually; optionally snooze a bit to avoid spam
    // choose one behavior:
    // A) no snooze (it will re-open quickly if still distracted)
    // B) small snooze so it doesn't instantly re-open
    snoozeUntil = Date.now() + 15 * 1000;
  }
  return true;
});

async function startCaptureLoop() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (!tab) return console.error("No active tab");

  // Remember the tab they started focusing on
  focusHomeTabId = tab.id;

  // 1. Get the Stream ID (Standard)
  chrome.desktopCapture.chooseDesktopMedia(
    ["screen", "window", "tab"],
    tab,
    async (streamId) => {
      if (!streamId) return console.error("User cancelled");

      // 2. FORCE INJECT the content script to ensure it's there
      // This solves "Receiving end does not exist" on tabs that haven't been reloaded
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content_capture.js"],
        });

        console.log("Script injected. Sending stream ID...");

        // 3. Send the message now that we know the script is ready
        // We add a small delay to ensure the listener is registered
        setTimeout(() => {
          chrome.tabs
            .sendMessage(tab.id, {
              action: "START_CAPTURE",
              streamId: streamId,
              tabId: tab.id,
            })
            .catch((err) => console.error("Message failed:", err));
        }, 100);
      } catch (err) {
        console.error(
          "Could not inject script (Are you on a restricted page like chrome:// or a PDF?):",
          err
        );
      }
    }
  );
}

function stopCaptureLoop() {
  // Notify all tabs to stop capturing (simplified)
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((t) =>
      chrome.tabs.sendMessage(t.id, { action: "STOP_CAPTURE" }).catch(() => {})
    );
  });
}

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
    throw new Error(
      "chrome.offscreen is not available. Check manifest permissions + reload extension."
    );
  }

  // Prefer runtime contexts check when available
  if (chrome.runtime?.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
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
    justification: "Capture focused tab frames during an active focus session",
  });

  // wait until offscreen.js runs and announces readiness
  await waitForOffscreenReady();
}

function startSession(goal, duration, blocked) {
  isSessionActive = true;
  sessionGoal = goal || "";
  blockedSites = blocked || [];
  distractionCount = 0;
  monitorAlertCount = 0;
  sessionStartTime = Date.now();
  lastDistractionTime = sessionStartTime;
  longestFocusStreakMs = 0;

  console.log("[session] started", {
    goal: sessionGoal,
    durationMinutes: duration,
  });
  chrome.notifications.getPermissionLevel?.((level) => {
    console.log("[notify] permission level (on startSession)", level);
  });

  chrome.alarms.create("sessionEnd", { delayInMinutes: duration });
  startCaptureLoop();
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
  isOnBreak = false;
  breakEndTime = null;

  focusHomeTabId = null;
  lastVerdict = null;
  lastVerdictAt = 0;
  lastVerdictDistracted = false;
  snoozeUntil = 0;

  if (activeNudgeNotificationId) {
    chrome.notifications.clear(activeNudgeNotificationId);
    activeNudgeNotificationId = null;
  }
  chrome.alarms.clear(ALARM_SNOOZE_END);

  chrome.alarms.clear("sessionEnd");
  chrome.alarms.clear("breakEnd");

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
  stopCaptureLoop();
  closeNudgeTabIfOpen();
  activeNudgeTabId = null;

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
    chrome.runtime.sendMessage({ action: "breakEnded" }).catch(() => {});
  } else if (alarm.name === ALARM_SNOOZE_END) {
    // Only re-nudge if the last LLM verdict is still "distracted" and recent
    const now = Date.now();
    const distractedRecently =
      lastVerdictDistracted && now - lastVerdictAt < 90 * 1000;
    if (
      isSessionActive &&
      !isOnBreak &&
      now >= snoozeUntil &&
      distractedRecently
    ) {
      // use stored lastVerdict info if you want
      openNudgeTab({
        goal: sessionGoal,
        url: lastVerdict?.url || "",
        reason: lastVerdict?.reason || "Quick check-in.",
      }).catch(console.warn);
    }
  }
});

// Focus notification with sound (works in background)
// Focus notification with sound (works in background)
let lastNotificationTime = 0;

function showFocusNotification(title, message) {
  console.log("[notify] showFocusNotification called", {
    title,
    hasMessage: !!message,
  });

  const now = Date.now();
  if (now - lastNotificationTime < 5000) {
    console.log("[notify] throttled (5s)", { now, lastNotificationTime });
    return;
  }
  lastNotificationTime = now;

  const notificationId = "focus-alert-" + now;

  chrome.notifications.getPermissionLevel?.((level) => {
    console.log("[notify] permission level", level);
  });

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
      if (chrome.runtime.lastError) {
        console.warn("[notify] create failed", chrome.runtime.lastError);
        return;
      }
      console.log("[notify] created", notificationId);
      setTimeout(() => chrome.notifications.clear(notificationId), 4000);
    }
  );
}

function showFocusNudgeNotification(title, message) {
  const now = Date.now();

  console.log("[notify] showFocusNudgeNotification called", {
    title,
    hasMessage: !!message,
    isSessionActive,
    isOnBreak,
    snoozeUntil,
  });

  if (!isSessionActive || isOnBreak) {
    console.log("[notify] nudge skipped: inactive/break", {
      isSessionActive,
      isOnBreak,
    });
    return;
  }

  if (now < snoozeUntil) {
    console.log("[notify] nudge skipped: snoozed", {
      now,
      snoozeUntil,
      remainingMs: snoozeUntil - now,
    });
    return;
  }

  if (now - lastNotificationTime < 5000) {
    console.log("[notify] nudge throttled (5s)", { now, lastNotificationTime });
    return;
  }
  lastNotificationTime = now;

  if (activeNudgeNotificationId) {
    chrome.notifications.clear(activeNudgeNotificationId);
    activeNudgeNotificationId = null;
  }

  const notificationId = NUDGE_PREFIX + now;
  activeNudgeNotificationId = notificationId;

  chrome.notifications.getPermissionLevel?.((level) => {
    console.log("[notify] permission level (nudge)", level);
  });

  console.log("[notify] creating nudge", { notificationId });

  chrome.notifications.create(
    notificationId,
    {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: title || "Still focused?",
      message:
        message ||
        "Are you still working on your goal, or searching for something?",
      priority: 2,
      // macOS sometimes behaves oddly with requireInteraction; keep it false for reliability
      requireInteraction: false,
      silent: false,
      buttons: [{ title: "Return to focus" }, { title: "1 more min" }],
    },
    () => {
      if (chrome.runtime.lastError) {
        console.warn("[notify] nudge create failed", chrome.runtime.lastError);
        return;
      }
      console.log("[notify] nudge created", notificationId);
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

chrome.notifications.onButtonClicked.addListener(
  async (notificationId, buttonIndex) => {
    if (!notificationId.startsWith(NUDGE_PREFIX)) return;

    // Button 0: Return to focus
    if (buttonIndex === 0) {
      snoozeUntil = 0;
      lastVerdictDistracted = false;

      // Try to focus the original "focus home" tab
      try {
        if (focusHomeTabId != null) {
          const t = await chrome.tabs.get(focusHomeTabId);
          if (t?.id != null) {
            await chrome.tabs.update(t.id, { active: true });
            await chrome.windows.update(t.windowId, { focused: true });
          }
        } else {
          // fallback: open monitor tab
          chrome.tabs.create({ url: chrome.runtime.getURL("monitor.html") });
        }
      } catch (e) {
        // if tab no longer exists, fallback to monitor
        chrome.tabs.create({ url: chrome.runtime.getURL("monitor.html") });
      }

      chrome.notifications.clear(notificationId);
      activeNudgeNotificationId = null;
      return;
    }

    // Button 1: "1 more min"
    if (buttonIndex === 1) {
      snoozeUntil = Date.now() + 60 * 1000;

      // schedule an alarm to re-nudge when 1 min is up
      chrome.alarms.create(ALARM_SNOOZE_END, { when: snoozeUntil });

      chrome.notifications.clear(notificationId);
      activeNudgeNotificationId = null;
      return;
    }
  }
);

let lastAnalyzeAt = 0;
const ANALYZE_EVERY_MS = 2500;

async function analyzeFrame({ dataUrl, ts, tabId }) {
  const now = Date.now();
  if (now - lastAnalyzeAt < ANALYZE_EVERY_MS) return;
  lastAnalyzeAt = now;

  const tab = await chrome.tabs.get(tabId);
  const payload = {
    goal: sessionGoal,
    url: tab?.url || "",
    title: tab?.title || "",
    ts,
    screenshotDataUrl: dataUrl,
  };

  const res = await fetch("http://localhost:3001/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = await res.json();
  if (!json.ok) {
    console.warn("analyze failed:", json.error);
    return;
  }

  const v = json.verdict;
  console.log("verdict:", v);

  // store last verdict info for the 1-min alarm logic
  lastVerdict = { ...v, url: tab?.url || "" };
  lastVerdictAt = Date.now();
  lastVerdictDistracted = !!v.distracted;

  // Don’t nudge when viewing extension pages
  if (isExtensionUrl(tab?.url)) return;

  if (v.distracted && v.suggested_action !== "none") {
    monitorAlertCount++;
    updateStreak();

    // Open your own UI instead of OS notifications
    openNudgeTab({
      goal: sessionGoal,
      url: tab?.url || "",
      reason: v.reason || "",
    }).catch(console.warn);
  }
}

function isExtensionUrl(u) {
  return typeof u === "string" && u.startsWith("chrome-extension://");
}

async function openNudgeTab({ goal, url, reason }) {
  // skip if snoozed
  const now = Date.now();
  if (now < snoozeUntil) return;

  // if already open, just focus it
  if (activeNudgeTabId) {
    try {
      const t = await chrome.tabs.get(activeNudgeTabId);
      if (t?.id != null) {
        await chrome.tabs.update(t.id, { active: true });
        await chrome.windows.update(t.windowId, { focused: true });
        return;
      }
    } catch (_) {
      activeNudgeTabId = null;
    }
  }

  const nudgeUrl =
    chrome.runtime.getURL("blocked/index.html") +
    `?mode=nudge&goal=${encodeURIComponent(goal || "")}` +
    `&url=${encodeURIComponent(url || "")}` +
    `&reason=${encodeURIComponent(reason || "")}`;

  const tab = await chrome.tabs.create({ url: nudgeUrl, active: true });
  activeNudgeTabId = tab.id;
}

async function focusBackToHomeTab() {
  try {
    if (focusHomeTabId != null) {
      const t = await chrome.tabs.get(focusHomeTabId);
      await chrome.tabs.update(t.id, { active: true });
      await chrome.windows.update(t.windowId, { focused: true });
      return true;
    }
  } catch (_) {}
  return false;
}

async function closeNudgeTabIfOpen() {
  if (!activeNudgeTabId) return;
  try {
    await chrome.tabs.remove(activeNudgeTabId);
  } catch (_) {}
  activeNudgeTabId = null;
}
