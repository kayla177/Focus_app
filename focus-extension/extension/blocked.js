// blocked.js
const params = new URLSearchParams(window.location.search);
const goal = params.get("goal") || "your focus";
document.getElementById("goalText").textContent = goal;

// Speak motivation if available
if (window.FocusVoice) {
    // Small delay to let page settle
    setTimeout(() => {
        window.FocusVoice.speakMotivation();
    }, 500);
}

document.getElementById("backBtn").addEventListener("click", async () => {
	// Try to go back; if not possible, close tab via tabs API.
	try {
		history.back();
	} catch (_) {}
	try {
		const [tab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});
		if (tab?.id) chrome.tabs.remove(tab.id);
	} catch (_) {}
});

document.getElementById("breakBtn").addEventListener("click", async () => {
	// Send break message to background FIRST
	chrome.runtime.sendMessage({ action: "takeBreak" });

	// Get the original URL that was blocked
	const originalUrl = params.get("url");
	if (originalUrl) {
		// Small delay to ensure message is processed
		setTimeout(() => {
			window.location.href = decodeURIComponent(originalUrl);
		}, 100);
	}
});
