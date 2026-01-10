// Background service worker for Focus Mode extension

// Initialize on install
chrome.runtime.onInstalled.addListener(() => {
	chrome.storage.local.set({
		focusMode: false,
		allowedSites: [],
		endTime: null,
		task: "",
		distractingTabs: [],
		tabMonitoringEnabled: true,
		warningThreshold: 40, // Warn when tab relevance < 40%
	});
});

// Tab monitoring alarm
chrome.alarms.create("checkTabs", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === "checkTabs") {
		monitorTabsForDistraction();
	} else if (alarm.name === "focusEnd") {
		endFocusSession();
	}
});

/**
 * Monitor tabs during focus session and warn about distracting tabs
 */
async function monitorTabsForDistraction() {
	const data = await chrome.storage.local.get([
		"focusMode",
		"task",
		"tabMonitoringEnabled",
	]);

	// Continue monitoring if focus mode is active and monitoring enabled.
	// Allow monitoring even when no task string is provided (e.g., session started with allowed sites only).
	if (!data.focusMode || !data.tabMonitoringEnabled) {
		return;
	}

	try {
		const tabs = await chrome.tabs.query({});
		const filteredTabs = tabs.filter((tab) => {
			if (!tab.url) return false;
			if (
				tab.url.startsWith("chrome://") ||
				tab.url.startsWith("chrome-extension://") ||
				tab.url.startsWith("about:")
			)
				return false;
			return true;
		});

		// Analyze tabs for distraction
		if (typeof analyzeTabs === "function") {
			const results = await analyzeTabs(data.task, filteredTabs);
			await handleDistractionWarnings(results, filteredTabs);
		}
	} catch (error) {
		console.error("Tab monitoring error:", error);
	}
}

/**
 * Handle warnings for distracting tabs
 */
async function handleDistractionWarnings(analysisResults, tabs) {
	const data = await chrome.storage.local.get([
		"warningThreshold",
		"distractingTabs",
	]);
	const threshold = data.warningThreshold || 40;
	const previousDistracting = data.distractingTabs || [];

	// Find newly distracting tabs
	const newDistracting = analysisResults.tabs
		.filter((tab) => tab.relevance < threshold)
		.map((tab) => ({
			title: tab.title,
			url: tab.url,
			relevance: tab.relevance,
			reason: tab.reason,
			timestamp: Date.now(),
		}));

	// Store distracting tabs
	await chrome.storage.local.set({
		distractingTabs: newDistracting,
		lastAnalysis: analysisResults,
	});

	// Show notifications for newly detected distracting tabs
	const newlyDistracting = newDistracting.filter(
		(tab) => !previousDistracting.find((prev) => prev.url === tab.url)
	);

	if (newlyDistracting.length > 0) {
		newlyDistracting.forEach((tab) => {
			chrome.notifications.create(`distraction-${Date.now()}`, {
				type: "basic",
				iconUrl: chrome.runtime.getURL("icon.png"),
				title: "⚠️ Distracting Tab Detected",
				message: `"${tab.title}" (${tab.relevance}% relevant) - ${tab.reason}`,
				priority: 2,
				requireInteraction: false,
			});
		});

		// Send message to popup to update warning display
		chrome.runtime
			.sendMessage({
				action: "updateDistractions",
				distractingTabs: newDistracting,
			})
			.catch(() => {
				// Popup not open, that's fine
			});
	}
}

// Check if URL is allowed during focus mode
function isUrlAllowed(url, allowedSites) {
	if (!url) return true;

	try {
		const urlObj = new URL(url);
		const hostname = urlObj.hostname.toLowerCase();

		// Always allow extension pages and chrome pages
		if (
			url.startsWith("chrome://") ||
			url.startsWith("chrome-extension://") ||
			url.startsWith("about:") ||
			url.startsWith("edge://")
		) {
			return true;
		}

		// Check if hostname matches any allowed site
		return allowedSites.some((site) => {
			const cleanSite = site
				.toLowerCase()
				.replace(/^(https?:\/\/)?(www\.)?/, "")
				.split("/")[0];
			return (
				hostname === cleanSite ||
				hostname === "www." + cleanSite ||
				hostname.endsWith("." + cleanSite)
			);
		});
	} catch (e) {
		return true;
	}
}

// Listen for tab updates and navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
	if (changeInfo.url) {
		checkAndBlockTab(tabId, changeInfo.url);
	}
});

chrome.tabs.onActivated.addListener((activeInfo) => {
	chrome.tabs.get(activeInfo.tabId, (tab) => {
		if (tab && tab.url) {
			checkAndBlockTab(activeInfo.tabId, tab.url);
		}
	});
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
	if (details.frameId === 0) {
		// Main frame only
		checkAndBlockTab(details.tabId, details.url);
	}
});

async function checkAndBlockTab(tabId, url) {
	const data = await chrome.storage.local.get([
		"focusMode",
		"allowedSites",
		"endTime",
		"blockDuringFocus",
	]);

	if (!data.focusMode) return;

	// Check if focus session has ended
	if (data.endTime && Date.now() > data.endTime) {
		await endFocusSession();
		return;
	}

	if (!isUrlAllowed(url, data.allowedSites || [])) {
		// Only block navigation if blocking is enabled for this session
		if (data.blockDuringFocus) {
			const blockedUrl = chrome.runtime.getURL("blocked.html");
			chrome.tabs.update(tabId, { url: blockedUrl });
		}
	}
}

async function endFocusSession() {
	await chrome.storage.local.set({
		focusMode: false,
		allowedSites: [],
		endTime: null,
		task: "",
	});
	chrome.alarms.clear("focusEnd");
}

// Handle alarm for session end
chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === "focusEnd") {
		endFocusSession();
	}
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.action === "startFocus") {
		const endTime = Date.now() + message.duration * 60 * 1000;
		chrome.storage.local.set({
			focusMode: true,
			allowedSites: message.allowedSites || [],
			endTime: endTime,
			task: message.task || "",
			// If true, non-allowed sites will be blocked. If false, monitoring only.
			blockDuringFocus:
				message.blockDuringFocus === undefined
					? true
					: !!message.blockDuringFocus,
			distractingTabs: [],
			tabMonitoringEnabled: true,
		});
		chrome.alarms.create("focusEnd", { when: endTime });

		// Start immediate tab monitoring
		monitorTabsForDistraction();

		sendResponse({ success: true });
	} else if (message.action === "stopFocus") {
		endFocusSession();
		sendResponse({ success: true });
	} else if (message.action === "getStatus") {
		chrome.storage.local.get(
			[
				"focusMode",
				"allowedSites",
				"endTime",
				"task",
				"distractingTabs",
				"lastAnalysis",
			],
			(data) => {
				sendResponse(data);
			}
		);
		return true; // Keep channel open for async response
	} else if (message.action === "getDistractions") {
		chrome.storage.local.get("distractingTabs", (data) => {
			// Get actual tab IDs for each URL
			chrome.tabs.query({}, (tabs) => {
				const distracting = (data.distractingTabs || []).map(
					(distTab) => {
						const matchingTab = tabs.find(
							(t) => t.url === distTab.url
						);
						return {
							...distTab,
							id: matchingTab ? matchingTab.id : null,
						};
					}
				);
				sendResponse(distracting);
			});
		});
		return true;
	} else if (message.action === "closeDistractionTab") {
		// Close a specific distracting tab by ID
		if (message.tabId) {
			chrome.tabs.remove(message.tabId, () => {
				// Remove from distractingTabs list
				chrome.storage.local.get("distractingTabs", (data) => {
					const updated = (data.distractingTabs || []).filter(
						(tab) => tab.url !== message.tabUrl
					);
					chrome.storage.local.set({ distractingTabs: updated });
				});
			});
		}
		sendResponse({ success: true });
	}
	return true;
});
