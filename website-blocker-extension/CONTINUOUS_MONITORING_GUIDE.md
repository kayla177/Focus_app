# Continuous Tab Monitoring Feature

## Overview

The Focus Mode extension now includes **continuous tab monitoring** - a major feature that works alongside the timer to keep you accountable. While you're in a focus session, the extension actively analyzes ALL your open tabs every minute and warns you when you open distracting content.

## How It Works

### 1. **Automatic Tab Analysis**
- During focus sessions, background.js analyzes all open tabs every **1 minute**
- Each tab is evaluated by the LLM to determine relevance to your task
- Tabs with relevance score **below 40%** (default) are flagged as distracting

### 2. **Real-Time Warnings**

#### In the Popup
When distracting tabs are detected:
- A red **distraction warning panel** appears at the top of the popup
- Shows count: "⚠️ 3 distracting tabs detected"
- Lists each distraction with:
  - **Relevance %**: How relevant the tab is to your task
  - **Tab title**: Name of the webpage
  - **Why**: Reason it's a distraction ("Not relevant to your task")
  - **Close button**: Quick option to close the tab directly

#### Desktop Notifications
- Chrome notification appears with: `⚠️ Distracting Tab Detected`
- Shows tab title and relevance percentage
- Only appears for *newly* detected distractions (not every minute)

### 3. **Smart Distraction Detection**
The LLM analyzes each tab by comparing:
- Your **task description** (e.g., "Write Python code for data analysis")
- Each tab's **title and URL**
- Domain/site context

**Example Analysis**:
```
Task: "Build a React weather app"

Tab 1: "React Documentation" → 95% relevant ✅
Tab 2: "YouTube - Music Beats" → 5% relevant ⚠️ Distraction
Tab 3: "Twitter Feed" → 2% relevant ⚠️ Distraction
Tab 4: "npm react-router" → 90% relevant ✅
```

## User Experience

### During Focus Session

1. **Start Focus**
   - Enter task: "Study for algebra exam"
   - Add allowed sites: `khan-academy.com`
   - Click "Start Focus"

2. **Tabs Are Monitored**
   - Popup shows active timer and focus sites
   - Every 1 minute, background analyzes all tabs
   - If new distractions detected → notification + warning panel

3. **Distraction Panel Shows**
   ```
   ⚠️ 2 distracting tabs detected
   
   87% | Facebook          | Scrolling social media
        ✕ Close Tab
   
   5%  | Reddit - memes    | Not relevant to your task
        ✕ Close Tab
   ```

4. **Close Distracting Tabs**
   - Click "✕" button in warning panel
   - Tab closes immediately
   - Popup updates to remove closed tab
   - Focus stays on your task

### End of Session
- All monitoring stops when focus session ends
- Distraction panel clears
- Timer resets

## Configuration

### Warning Threshold (Advanced)

The extension uses a configurable threshold to determine what counts as a distraction. Default is **40% relevance**.

To change (in settings page, coming soon):
```javascript
// Warn for tabs with relevance < 40% (default)
warningThreshold: 40  

// More lenient (warn only very distracting tabs)
warningThreshold: 20  

// More strict (warn for anything < 60%)
warningThreshold: 60  
```

### Disable Monitoring (Temporarily)

If you need to disable monitoring for a session:
1. Go to extension settings
2. Toggle "Enable tab monitoring" OFF
3. You'll no longer see warnings

## API Behavior

### Tab Analysis API Call
```javascript
// Every 1 minute during focus:
const results = await analyzeTabs(
  "Study for algebra exam",  // Your task
  [
    { title: "Khan Academy Algebra", url: "khanacademy.org" },
    { title: "Facebook", url: "facebook.com" },
    // ... all other open tabs
  ]
);

// Returns:
{
  tabs: [
    { 
      title: "Khan Academy Algebra", 
      relevance: 95,
      reason: "Directly related to algebra studying"
    },
    { 
      title: "Facebook", 
      relevance: 5,
      reason: "Social media, not related to algebra"
    }
  ]
}
```

### Message Flow

```
background.js (every 1 min)
  ↓
analyzeTabs() [LLM API call]
  ↓
handleDistractionWarnings()
  ↓
chrome.notifications.create() [Desktop notification]
  ↓
chrome.runtime.sendMessage() [To popup.js]
  ↓
popup.js receives "updateDistractions"
  ↓
displayDistractions() [Renders warning panel]
```

## Technical Details

### Files Involved

- **background.js**
  - `monitorTabsForDistraction()` - Runs every 1 minute
  - `handleDistractionWarnings()` - Detects new distractions
  - Message handler for "getDistractions"
  - Message handler for "closeDistractionTab"

- **popup.js**
  - `displayDistractions()` - Renders warning panel
  - Periodic check (every 5 seconds) for latest distractions
  - Close button handlers

- **llm-analyzer.js**
  - `analyzeTabs()` - Main analysis function (unchanged)
  - Works with both Anthropic and OpenRouter APIs

### Storage

Monitoring data stored in `chrome.storage.local`:
```javascript
{
  focusMode: true,
  task: "Study for algebra",
  tabMonitoringEnabled: true,
  warningThreshold: 40,
  distractingTabs: [
    {
      title: "Facebook",
      url: "facebook.com",
      relevance: 5,
      reason: "Social media, not related to algebra",
      timestamp: 1234567890
    }
  ]
}
```

### Chrome APIs Used

- `chrome.alarms` - Creates 1-minute monitoring interval
- `chrome.tabs.query()` - Gets all open tabs
- `chrome.tabs.remove()` - Closes distraction tab
- `chrome.notifications` - Desktop warnings
- `chrome.runtime.sendMessage()` - Popup communication
- `chrome.storage.local` - Persistent settings

## Troubleshooting

### Not Seeing Distraction Warnings?

1. **Ensure API key is set**
   - Go to extension settings
   - Configure Anthropic or OpenRouter API key
   - Without API key, fallback keyword matching is used

2. **Check threshold setting**
   - Extremely high threshold (80%+) might hide real distractions
   - Reset to default 40%

3. **Check monitoring enabled**
   - Settings page should show "Tab monitoring: ON"
   - Re-enable if accidentally disabled

4. **Check browser notifications**
   - Chrome settings → Notifications
   - Allow "Focus Mode" extension notifications
   - Without this, you won't see desktop alerts

### Popup Not Updating?

1. Ensure popup window is open during focus session
2. Check browser console for errors (Right-click → Inspect → Console)
3. Restart focus session if unresponsive

### False Positives (Tasks Marked as Distractions)?

This can happen when LLM misinterprets relevance. Examples:
- **Task**: "Research quantum physics"
- **False positive**: Wikipedia article on quantum mechanics marked low relevance

Solutions:
- Reword task to be more specific
- Use allowed sites feature to whitelist research domains
- Temporarily disable monitoring for trusted tabs

## Future Enhancements

Planned features:
- [ ] Whitelist specific tabs/sites
- [ ] Customize LLM analysis prompt
- [ ] Analytics dashboard (tabs closed, time in focus, etc.)
- [ ] Audio alerts for distracting tabs
- [ ] Smart detection for "productive procrastination" sites
- [ ] Integration with calendar/goals
- [ ] Weekly focus reports

## Summary

The continuous monitoring feature transforms the Focus Mode extension from a passive blocker into an **active accountability partner** that:
- ✅ Monitors in real-time
- ✅ Uses AI for intelligent relevance detection
- ✅ Provides immediate warnings
- ✅ Allows quick action (close tabs)
- ✅ Works seamlessly with the timer

This keeps you aware of drift, preventing distraction before it becomes a productivity killer.
