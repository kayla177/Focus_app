// blocked.js
const params = new URLSearchParams(window.location.search);
const goal = params.get("goal") || "your focus";
document.getElementById("goalText").textContent = goal;

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
	chrome.runtime.sendMessage({ action: "takeBreak" });
	showBreakTimer();
});

function showBreakTimer() {
	document.body.innerHTML = `
    <div class="container">
      <div class="icon-circle">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 8h1a4 4 0 0 1 0 8h-1"/>
          <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/>
          <line x1="6" y1="1" x2="6" y2="4"/>
          <line x1="10" y1="1" x2="10" y2="4"/>
          <line x1="14" y1="1" x2="14" y2="4"/>
        </svg>
      </div>
      <h1>Taking a Break</h1>
      <p class="message">Your focus session is paused. Enjoy a 5-minute break!</p>
      <div class="break-timer" id="breakTimer">5:00</div>
      <p class="hint">When the timer ends, blocking will resume.</p>
    </div>
  `;

	let timeRemaining = 5 * 60; // 5 minutes in seconds
	const timerEl = document.getElementById("breakTimer");

	const interval = setInterval(() => {
		timeRemaining--;
		const mins = Math.floor(timeRemaining / 60);
		const secs = timeRemaining % 60;
		timerEl.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;

		if (timeRemaining <= 0) {
			clearInterval(interval);
			// Break is over, close the tab or navigate away
			try {
				chrome.tabs.query(
					{ active: true, currentWindow: true },
					(tabs) => {
						if (tabs[0]?.id) chrome.tabs.remove(tabs[0].id);
					}
				);
			} catch (_) {}
		}
	}, 1000);
}
