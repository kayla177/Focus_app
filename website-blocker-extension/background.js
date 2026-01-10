// Background service worker for Focus Mode extension

// Initialize on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    focusMode: false,
    allowedSites: [],
    endTime: null
  });
});

// Check if URL is allowed during focus mode
function isUrlAllowed(url, allowedSites) {
  if (!url) return true;
  
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    // Always allow extension pages and chrome pages
    if (url.startsWith('chrome://') || 
        url.startsWith('chrome-extension://') ||
        url.startsWith('about:') ||
        url.startsWith('edge://')) {
      return true;
    }
    
    // Check if hostname matches any allowed site
    return allowedSites.some(site => {
      const cleanSite = site.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
      return hostname === cleanSite || 
             hostname === 'www.' + cleanSite ||
             hostname.endsWith('.' + cleanSite);
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
  if (details.frameId === 0) { // Main frame only
    checkAndBlockTab(details.tabId, details.url);
  }
});

async function checkAndBlockTab(tabId, url) {
  const data = await chrome.storage.local.get(['focusMode', 'allowedSites', 'endTime']);
  
  if (!data.focusMode) return;
  
  // Check if focus session has ended
  if (data.endTime && Date.now() > data.endTime) {
    await endFocusSession();
    return;
  }
  
  if (!isUrlAllowed(url, data.allowedSites || [])) {
    // Redirect to blocked page
    const blockedUrl = chrome.runtime.getURL('blocked.html');
    chrome.tabs.update(tabId, { url: blockedUrl });
  }
}

async function endFocusSession() {
  await chrome.storage.local.set({
    focusMode: false,
    allowedSites: [],
    endTime: null
  });
  chrome.alarms.clear('focusEnd');
}

// Handle alarm for session end
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'focusEnd') {
    endFocusSession();
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'startFocus') {
    const endTime = Date.now() + (message.duration * 60 * 1000);
    chrome.storage.local.set({
      focusMode: true,
      allowedSites: message.allowedSites,
      endTime: endTime
    });
    chrome.alarms.create('focusEnd', { when: endTime });
    sendResponse({ success: true });
  } else if (message.action === 'stopFocus') {
    endFocusSession();
    sendResponse({ success: true });
  } else if (message.action === 'getStatus') {
    chrome.storage.local.get(['focusMode', 'allowedSites', 'endTime'], (data) => {
      sendResponse(data);
    });
    return true; // Keep channel open for async response
  }
  return true;
});
