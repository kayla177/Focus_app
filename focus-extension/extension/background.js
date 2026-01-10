// Session management
let isSessionActive = false;
let sessionGoal = "";
let blockedSites = []; // sites to block during session
let distractionCount = 0;
let isOnBreak = false;
let breakEndTime = null;

chrome.runtime.onMessage.addListener((request) => {
	if (request.action === "startSession") {
		startSession(request.goal, request.duration, request.blockedSites);
	} else if (request.action === "endSession") {
		endSession();
	} else if (request.action === "takeBreak") {
		takeBreak();
	} else if (request.action === "resumeSession") {
		resumeSession();
	}
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
