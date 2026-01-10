# Focus Mode - Chrome Extension

A browser extension that helps you stay focused by **blocking all websites except the ones you're studying on**.

## How It Works

Unlike typical blockers that block specific sites, this extension does the **opposite**:
1. You specify which site(s) you want to focus on (e.g., `learn.uwaterloo.ca`)
2. Set a timer (25 min, 1 hour, 2 hours, etc.)
3. **ALL other websites are blocked** until your session ends

Perfect for studying when you need to stay on your course website!

## Features

- ✅ Allow only specific websites during focus sessions
- ✅ **🎯 MAJOR: Continuous AI-powered tab monitoring** - Real-time detection of distracting tabs with instant warnings
- ✅ **NEW: AI-powered tab analysis** - LLM checks if your open tabs match your task
- ✅ Timer with preset durations (25m, 45m, 1h, 2h) or custom
- ✅ Blocks ALL other sites (YouTube, Reddit, etc.)
- ✅ Motivational quotes on blocked pages
- ✅ Can add multiple allowed sites
- ✅ End session early if needed
- ✅ Specify your task and track it during focus session

## Installation

### Step 1: Load the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** by toggling the switch in the top-right corner
3. Click **"Load unpacked"** button
4. Select the `website-blocker-extension` folder
5. The extension should now appear in your extensions list!

### Step 2: Pin the Extension (Recommended)

1. Click the puzzle piece icon (Extensions) in Chrome toolbar
2. Find "Focus Mode" and click the pin icon

## Usage

### Basic Focus Session

1. Click the extension icon in your browser toolbar
2. **Enter your task** (e.g., "Complete Python project")
3. Enter the website you want to focus on (e.g., `learn.uwaterloo.ca`)
4. Click **"+ Add Another Site"** if you need multiple sites
5. Select a duration (25m, 45m, 1h, 2h, or custom)
6. Click **🚀 Start Focus Session**
7. Now ONLY your allowed sites will work - everything else shows a "Stay Focused" page!

### Analyzing Your Open Tabs

1. Enter your task description
2. Click **"Analyze Open Tabs"** button
3. The AI will evaluate each open tab to see if it's related to your task
4. Results show:
   - Relevance score for each tab
   - Brief explanation for each tab
   - Overall relevance     # Extension configuration
├── background.js          # Service worker for blocking logic
├── popup.html             # Extension popup UI
├── popup.js               # Popup functionality
├── popup.css              # Popup styles
├── llm-analyzer.js        # AI tab analysis (NEW!)
├── blocked.html           # Page shown when trying to access blocked sites
├── LLM_SETUP_GUIDE.md     # Setup guide for LLM features (NEW!)
└── README.md    
1. Enter task: "Study for statistics exam"
2. Enter site: `learn.uwaterloo.ca`
3. Click "Analyze Open Tabs" to see which tabs are relevant
4. Select `1h` duration
5. Click Start
6. Now YouTube, Reddit, Twitter, etc. are all blocked until the hour is up!

## Files Structure

```
website-blocker-extension/
├── manifest.json      # Extension configuration
├── background.js      # Service worker for blocking logic
├── popup.html         # Extension popup UI
├── popup.js           # Popup functionality
├── popup.css          # Popup styles
├── blocked.html       # Page shown when trying to access blocked sites
└── README.md          # This file
```

## Troubleshooting

- **Extension not working?** Make sure Developer mode is enabled and reload the extension
- **Tab analysis not working?** See [LLM_SETUP_GUIDE.md](LLM_SETUP_GUIDE.md) for configuration steps
- **"API Error: Unauthorized"?** Check that your Claude API key is valid and properly configured

## Advanced Features

### LLM Tab Analysis

The extension can now use AI to analyze whether your open tabs match your task:
- Specify your current task before analyzing
- Get relevance scores for each open tab
- Identify and close distracting tabs before starting
- Optional: Requires Claude API key (free tier available)

For setup instructions, see [LLM_SETUP_GUIDE.md](LLM_SETUP_GUIDE.md).

### Fallback Mode

If you don't configure an LLM API:
- Tab analysis uses keyword matching instead
- Provides basic relevance detection
- No API calls, fully local analysis
- **Sites still accessible?** Try closing and reopening Chrome tabs
- **Timer not showing?** Reopen the popup to see current session status

## License

Free to use and modify!
