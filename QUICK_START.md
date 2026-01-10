# Quick Start: AI Tab Analysis

## 5-Minute Setup

### Step 1: Get API Key (2 min)
1. Go to https://console.anthropic.com/
2. Sign up/Sign in
3. Create API key
4. Copy the key

### Step 2: Configure Extension (1 min)
1. Right-click Focus Mode icon
2. Click "Manage extension"
3. Click "Extension options"
4. Paste API key
5. Click "Save Settings"

### Step 3: Use It (2 min)
1. Click Focus Mode icon
2. Enter task: "Work on X"
3. Click "Analyze Open Tabs"
4. See which tabs match your task
5. Close distracting ones
6. Add focus sites and start session

---

## Step-by-Step Usage

### To Analyze Tabs:
```
Task Input → Click "Analyze Open Tabs" → View Results → Take Action
```

### To Start Focus Session:
```
Task Input → Add Focus Sites → Set Duration → Click Start
```

---

## Example Session

**Task:** "Complete Python homework"

**Open Tabs:**
- GitHub (95% relevant) - Where my code is
- Stack Overflow (80% relevant) - Help with errors
- YouTube (5% relevant) - Random video from earlier
- Reddit (0% relevant) - Time waster

**Action:** Close YouTube and Reddit, keep GitHub and Stack Overflow open

---

## Costs

**Claude API Pricing (as of 2024):**
- Input: $3 per 1M tokens (~$0.001 per analysis)
- Output: $15 per 1M tokens
- **Estimate:** $0.01-0.05 per analysis
- **Free tier:** New accounts get $5 credit

---

## Fallback Mode

No API key? No problem!
- Extension uses keyword matching
- Task keywords searched in tab titles/URLs
- Automatic scoring 0-100%
- Works offline

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "API key not configured" | Open Settings, paste key, save |
| Analysis very slow | Close some tabs first |
| "Unauthorized" error | Verify API key in settings |
| No results | Try fallback mode (remove key) |

---

## Tips & Tricks

✅ **Good task descriptions:**
- "Complete Python data analysis project"
- "Study for organic chemistry exam"
- "Write marketing copy for blog"

❌ **Vague descriptions:**
- "Work"
- "Study"
- "Do stuff"

💡 **Best practices:**
- Close unnecessary tabs before analyzing
- Use specific task descriptions
- Use Sonnet model for balance
- Run analysis before starting focus

---

## Need Help?

- See `LLM_SETUP_GUIDE.md` for detailed setup
- See `IMPLEMENTATION_GUIDE.md` for technical details
- Check browser console for error messages
- Try fallback mode if API has issues

---

## What's Happening Behind the Scenes

1. **Collect** - Extension gathers all open tabs
2. **Filter** - System/extension pages removed
3. **Prepare** - Creates prompt with task + tabs
4. **Send** - Calls Claude API
5. **Parse** - Extracts relevance scores
6. **Display** - Shows results in popup
7. **Act** - You decide what to do with info

---

Ready to focus better? 🎯
