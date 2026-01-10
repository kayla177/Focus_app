# Continuous Tab Monitoring - Quick Setup

## What's New?

Your Focus Mode extension now has **intelligent distraction detection**. During your focus session, the extension automatically:

1. **Monitors all open tabs every minute**
2. **Uses AI to analyze relevance** to your task
3. **Warns you with notifications and a popup panel** when distracting tabs are detected
4. **Lets you close tabs directly** from the warning panel

## Getting Started (3 Steps)

### 1. Ensure API Key is Configured
- Click the extension icon → Settings
- Add your Anthropic or OpenRouter API key
- *(Without this, the extension uses fallback keyword matching, which is less accurate)*

### 2. Start a Focus Session
```
1. Enter your task: "Study calculus" 
2. Add site to focus on: khan-academy.org
3. Set timer: 1 hour
4. Click "Start Focus Session"
```

### 3. Watch for Warnings
As you browse:
- Every **1 minute**, your tabs are analyzed
- If you open YouTube, Reddit, etc. → **⚠️ distraction warning appears**
- Red panel in popup shows: distracting tab + why + close button
- Desktop notification also appears

## What You'll See

### During Focus Session:

**Active Focus View:**
```
┌─────────────────────────────┐
│  55:32  Focus Timer         │  ← Counting down
│  📍 khan-academy.org        │  ← Your allowed site
│  📝 Study calculus          │  ← Your task
├─────────────────────────────┤
│ ⚠️ 2 distracting tabs       │  ← WARNING PANEL
│                              │
│ 87% | Facebook              │  ← Relevance % + Title
│      Scrolling social media │  ← Why it's a distraction
│      [✕ Close Tab]          │  ← Quick close button
│                              │
│ 5%  | Reddit - memes        │
│      Not relevant to task   │
│      [✕ Close Tab]          │
└─────────────────────────────┘
```

**Desktop Notification:**
```
⚠️ Distracting Tab Detected

"Facebook" (87% relevant) - Scrolling social media
[Don't show again] [Open popup]
```

## How It Works

### The Analysis Process

```
Your Task: "Study calculus"
    ↓
[LLM receives task + all open tabs]
    ↓
Analyzes each tab for relevance:
  - Khan Academy (95%) ✅ Relevant
  - Facebook (5%) ⚠️ Distraction
  - YouTube (10%) ⚠️ Distraction
    ↓
Shows warning for anything < 40% relevance
```

### Why Some Tabs Get Flagged

The LLM looks at:
- **Task keywords**: "study", "calculus", "math"
- **Tab content**: Title, URL, domain
- **Context**: Does the site help with your task?

**Examples:**
- Task: "Learn Python" → Stack Overflow = ✅ relevant, Reddit = ⚠️ distraction
- Task: "Write essay" → Google Docs = ✅ relevant, Twitter = ⚠️ distraction
- Task: "Design UI mockup" → Figma = ✅ relevant, LinkedIn = ⚠️ distraction

## Advanced Configuration

### Adjust Warning Sensitivity

The default threshold is **40% relevance** (warn for anything below this).

To make it stricter or lenient:

1. **More strict** (warn for more tabs):
   - Threshold: 60% or higher
   - Use when you need maximum focus

2. **More lenient** (warn for fewer tabs):
   - Threshold: 20-30%
   - Use when you need some flexibility

*Note: Settings UI coming soon - currently set via extension code*

### Disable Monitoring (If Needed)

If you need a break from warnings:
1. Open extension settings
2. Toggle "Tab monitoring" OFF
3. Warnings won't appear for this session
4. Toggle back ON to re-enable

## Keyboard Shortcuts (Coming Soon)

- **Alt+Shift+S**: Quick start focus session
- **Alt+Shift+E**: End focus session
- **Alt+Shift+T**: Toggle monitoring

## FAQ

**Q: Why do some tabs show as distracting when they're helpful?**
- A: The LLM might misunderstand your task. Try rewording it more specifically.
- Example: "Study calculus limits" vs just "Study calculus"

**Q: Can I whitelist specific sites?**
- A: This is coming in the next update! Soon you'll be able to mark tabs as "always okay"

**Q: Does monitoring slow down my browser?**
- A: No! Analysis happens once per minute in the background. Browser performance is unaffected.

**Q: What if my API calls run out?**
- A: The extension falls back to keyword matching (simpler but less accurate)

**Q: Can I see what the LLM decided?**
- A: Yes! Click the "Analyze Open Tabs" button in setup view to see detailed relevance scores

## Testing It Out

### Quick Test (2 minutes)

1. **Open these tabs:**
   - Khan Academy (or Wikipedia on your task)
   - YouTube
   - Reddit

2. **Start focus session** with task: "Study biology"

3. **Wait 1-2 minutes** for monitoring to kick in

4. **You'll see:**
   - Notification for YouTube & Reddit
   - Warning panel in popup showing both as distractions
   - Khan Academy not listed (it's relevant!)

5. **Click "✕ Close Tab"** on YouTube → tab closes instantly

## Need Help?

### Check Browser Console for Errors
1. Right-click popup → **Inspect**
2. Click **Console** tab
3. Look for red error messages

### Common Issues

| Issue | Solution |
|-------|----------|
| No warnings appearing | Check: API key set? Monitoring enabled? Browser notifications ON? |
| Warnings but can't close tabs | Check permissions: chrome://extensions → Focus Mode → Details → check "Tabs" permission |
| Popup freezing | Restart focus session or reload extension |
| False positives | Reword task more specifically, or whitelist the site |

## Documentation

- **[CONTINUOUS_MONITORING_GUIDE.md](CONTINUOUS_MONITORING_GUIDE.md)** - Full technical details
- **[LLM_SETUP_GUIDE.md](LLM_SETUP_GUIDE.md)** - API configuration
- **[OPENROUTER_GUIDE.md](OPENROUTER_GUIDE.md)** - OpenRouter setup (alternative to Anthropic)

---

**That's it! You now have an intelligent accountability partner watching your tabs. Stay focused! 🎯**
