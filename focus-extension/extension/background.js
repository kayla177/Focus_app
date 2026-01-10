// Session management
let isSessionActive = false;
let sessionGoal = "";
let blockedSites = []; // sites to block during session
let distractionCount = 0;
let isOnBreak = false;
let breakEndTime = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if (request.action === "startSession") {
		startSession(request.goal, request.duration, request.blockedSites);
	} else if (request.action === "endSession") {
		endSession();
	} else if (request.action === "takeBreak") {
		takeBreak();
	} else if (request.action === "resumeSession") {
		resumeSession();
	} else if (request.type === "FOCUS_ALERT") {
		// Show Chrome notification for focus alerts (works even when monitor tab not focused)
		showFocusNotification(request.title, request.message);
	}
	return true;
});

function startSession(goal, duration, blocked) {
	isSessionActive = true;
	sessionGoal = goal || "";
	blockedSites = blocked || [];
	distractionCount = 0;

	chrome.alarms.create("sessionEnd", { delayInMinutes: duration });
}

function endSession() {
	isSessionActive = false;
	sessionGoal = "";
	blockedSites = [];
	isOnBreak = false;
	breakEndTime = null;
	chrome.alarms.clear("sessionEnd");
	chrome.alarms.clear("breakEnd");
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
		distractionCount++;

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
  
  const notificationId = 'focus-alert-' + now;
  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: title || 'Focus Alert!',
    message: message || 'You seem distracted. Get back on track!',
    priority: 2,
    requireInteraction: false,
    silent: false // This enables notification sound
  }, () => {
    // Auto-close after 4 seconds
    setTimeout(() => {
      chrome.notifications.clear(notificationId);
    }, 4000);
  });
}

// Click notification to focus the monitor tab
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('focus-alert-')) {
    // Find and focus the monitor tab
    chrome.tabs.query({ url: chrome.runtime.getURL('monitor.html') }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { active: true });
        chrome.windows.update(tabs[0].windowId, { focused: true });
      }
    });
  }
});
