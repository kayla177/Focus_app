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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.remove(tab.id);
  } catch (_) {}
});

document.getElementById("breakBtn").addEventListener("click", async () => {
  chrome.runtime.sendMessage({ action: "endSession" });
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.remove(tab.id);
  } catch (_) {}
});
