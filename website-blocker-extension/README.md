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
- ✅ Timer with preset durations (25m, 45m, 1h, 2h) or custom
- ✅ Blocks ALL other sites (YouTube, Reddit, etc.)
- ✅ Motivational quotes on blocked pages
- ✅ Can add multiple allowed sites
- ✅ End session early if needed

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

1. Click the extension icon in your browser toolbar
2. Enter the website you want to focus on (e.g., `learn.uwaterloo.ca`)
3. Click **"+ Add Another Site"** if you need multiple sites
4. Select a duration (25m, 45m, 1h, 2h, or custom)
5. Click **🚀 Start Focus Session**
6. Now ONLY your allowed sites will work - everything else shows a "Stay Focused" page!

### Example: Studying for 1 Hour

1. Enter `learn.uwaterloo.ca`
2. Select `1h` duration
3. Click Start
4. Now YouTube, Reddit, Twitter, etc. are all blocked until the hour is up!

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
- **Sites still accessible?** Try closing and reopening Chrome tabs
- **Timer not showing?** Reopen the popup to see current session status

## License

Free to use and modify!
