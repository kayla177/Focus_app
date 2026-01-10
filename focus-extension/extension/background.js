// Session management
let isSessionActive = false;
let sessionGoal = "";
let allowedHost = ""; // only the starting tab host
let distractionCount = 0;

chrome.runtime.onMessage.addListener((request) => {
  if (request.action === "startSession") {
    startSession(request.goal, request.duration);
  } else if (request.action === "endSession") {
    endSession();
  }
});

function startSession(goal, duration) {
  isSessionActive = true;
  sessionGoal = goal || "";
  distractionCount = 0;

  // Allow only the current active tab's hostname (simple baseline)
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0];
    if (!tab?.url) return;
    try {
      const url = new URL(tab.url);
      allowedHost = url.hostname;
    } catch (_) {
      allowedHost = "";
    }
  });

  chrome.alarms.create("sessionEnd", { delayInMinutes: duration });
}

function endSession() {
  isSessionActive = false;
  sessionGoal = "";
  allowedHost = "";
  chrome.alarms.clear("sessionEnd");
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

  const isAllowed = allowedHost && url.hostname.includes(allowedHost);

  if (!isAllowed) {
    distractionCount++;

    // IMPORTANT: Next export blocked page path
    const blockedUrl =
      chrome.runtime.getURL('blocked/index.html') + `?goal=${encodeURIComponent(sessionGoal)}`;

    chrome.tabs.update(details.tabId, { url: blockedUrl });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "sessionEnd") endSession();
});
