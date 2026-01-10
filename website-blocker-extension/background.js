// Session management
let isSessionActive = false;
let sessionGoal = '';
let allowedUrls = [];
let distractionCount = 0;

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startSession') {
    startSession(request.goal, request.duration);
  } else if (request.action === 'endSession') {
    endSession();
  }
});

function startSession(goal, duration) {
  isSessionActive = true;
  sessionGoal = goal;
  distractionCount = 0;

  // Get current tab and allow it
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      const url = new URL(tabs[0].url);
      allowedUrls = [url.hostname];
    }
  });

  // Set up alarm for session end
  chrome.alarms.create('sessionEnd', { delayInMinutes: duration });
}

function endSession() {
  isSessionActive = false;
  sessionGoal = '';
  allowedUrls = [];
  chrome.alarms.clear('sessionEnd');
}

// Monitor tab navigation
chrome.webNavigation.onCommitted.addListener((details) => {
  if (!isSessionActive || details.frameId !== 0) return;

  const url = new URL(details.url);
  const isAllowed = allowedUrls.some(allowed => url.hostname.includes(allowed));

  if (!isAllowed && !url.protocol.startsWith('chrome')) {
    distractionCount++;
    // Redirect to blocked page
    chrome.tabs.update(details.tabId, {
      url: chrome.runtime.getURL('blocked.html') + 
           `?goal=${encodeURIComponent(sessionGoal)}`
    });
  }
});

// Handle session end alarm
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'sessionEnd') {
    endSession();
  }
});