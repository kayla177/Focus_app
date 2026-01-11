const params = new URLSearchParams(window.location.search);
const goal = params.get("goal") || "your focus";
const mode = params.get("mode") || "blocked"; // "nudge" or "blocked"
const reason = params.get("reason") || "";
const originalUrl = params.get("url");

document.getElementById("goalText").textContent = goal;

// Optional: show reason somewhere if you add a <p id="reasonText">
const reasonEl = document.getElementById("reasonText");
if (reasonEl) reasonEl.textContent = reason;

// If in nudge mode, change button text/icons
if (mode === "nudge") {
  document.querySelector("h1").textContent = "Still focused?";
  const breakBtn = document.getElementById("breakBtn");
  breakBtn.textContent = "1 more min";
}

document.getElementById("backBtn").addEventListener("click", async () => {
  // Return to focus
  chrome.runtime.sendMessage({ action: "NUDGE_RETURN_TO_FOCUS" });

  // also close this tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.remove(tab.id);
  } catch (_) {}
});

document.getElementById("breakBtn").addEventListener("click", async () => {
  if (mode === "nudge") {
    // 1 minute snooze
    chrome.runtime.sendMessage({ action: "NUDGE_SNOOZE_1M" });

    // go back to the original page (so they can keep searching)
    if (originalUrl) {
      setTimeout(() => {
        window.location.href = decodeURIComponent(originalUrl);
      }, 50);
    }
    return;
  }

  // existing blocked behavior = 5-min break
  chrome.runtime.sendMessage({ action: "takeBreak" });
  if (originalUrl) {
    setTimeout(() => {
      window.location.href = decodeURIComponent(originalUrl);
    }, 100);
  }
});

// detect if user closes the tab
window.addEventListener("beforeunload", () => {
  try {
    chrome.runtime.sendMessage({ action: "NUDGE_CLOSED" });
  } catch (_) {}
});
