# Implementation Guide: LLM Tab Analysis Feature

## Summary

Your Focus Mode extension now includes an AI-powered tab analyzer that can look at the tabs a user has open and determine if they are connected to the task the user specified beforehand.

## What Was Implemented

### 1. **Task Input** (`popup.html`, `popup.js`)
- Added a new task input field at the top of the popup
- Users specify what they're working on before analyzing tabs
- Task is stored and displayed during focus sessions

### 2. **Tab Analysis UI** (`popup.html`, `popup.css`)
- "Analyze Open Tabs" button in the setup view
- Results display with:
  - Relevance percentage for each tab (0-100%)
  - Tab title and URL
  - Explanation of relevance
  - Overall relevance summary
  - Color-coded indicators (green: relevant, yellow: partial, red: not relevant)

### 3. **LLM Integration** (`llm-analyzer.js`)
- **Claude API Integration**: Uses Anthropic's Claude API for intelligent tab analysis
- **Prompt Engineering**: Generates detailed prompts asking Claude to evaluate tab relevance
- **Fallback Mode**: Automatic keyword matching if API unavailable
- **Error Handling**: Graceful degradation and user-friendly error messages

### 4. **Settings Page** (`settings.html`)
- Easy API key configuration interface
- Model selection (Opus, Sonnet, Haiku)
- Shows configuration status
- Clear and save settings functionality
- Access via right-click → "Options"

### 5. **Backend Integration** (`background.js`, `manifest.json`)
- Task storage in chrome.storage.local
- Task persistence during focus sessions
- Updated message handling for task data
- Proper session management

## How It Works

### User Flow

1. User opens extension popup
2. Enters task: "Complete Python project"
3. Optionally clicks "Analyze Open Tabs"
4. Extension collects all open tabs
5. Sends to Claude API with task description
6. Receives analysis with relevance scores
7. User sees which tabs are relevant/distracting
8. User closes distracting tabs
9. User starts focus session with allowed sites

### Technical Flow

```
User Input (Task)
       ↓
Analyze Tabs Button Click
       ↓
llm-analyzer.js: Collect Tabs
       ↓
llm-analyzer.js: Build Prompt
       ↓
Check API Key (chrome.storage)
       ↓
Call Claude API / Fallback Mode
       ↓
Parse Response
       ↓
popup.js: Display Results
       ↓
User Action (Close tabs / Start session)
```

## Files Added/Modified

### New Files
- **`llm-analyzer.js`** - Core LLM integration logic
- **`settings.html`** - Settings page for API configuration
- **`LLM_SETUP_GUIDE.md`** - Comprehensive setup instructions

### Modified Files
- **`popup.html`** - Added task input and analysis section
- **`popup.js`** - Added task handling and analysis UI logic
- **`popup.css`** - Added styles for analysis results
- **`background.js`** - Added task storage and retrieval
- **`manifest.json`** - Added settings page reference
- **`README.md`** - Updated with new feature documentation

## API Integration Details

### Claude API
- **Endpoint**: `https://api.anthropic.com/v1/messages`
- **Model**: `claude-3-5-sonnet-20241022` (configurable)
- **Authentication**: API key header
- **Request**: JSON with prompt and messages
- **Response**: JSON with content array

### API Flow
```javascript
POST https://api.anthropic.com/v1/messages
Headers:
  - x-api-key: [user's API key]
  - Content-Type: application/json
  - anthropic-version: 2023-06-01

Body:
{
  "model": "claude-3-5-sonnet-20241022",
  "max_tokens": 1024,
  "messages": [
    {
      "role": "user",
      "content": "Analyze these tabs for relevance to: [task]..."
    }
  ]
}
```

## Fallback Mechanism

If LLM is unavailable:
```javascript
function fallbackAnalysis(task, tabs) {
  // Extract keywords from task
  const keywords = task.split(/\s+/)
  
  // Score each tab based on keyword matches
  tabs.forEach(tab => {
    const matches = countMatches(tab.title + tab.url, keywords)
    const relevance = (matches / keywords.length) * 100
  })
  
  // Return scored results
}
```

## Configuration Methods

### Method 1: Settings Page (Recommended)
1. Right-click extension icon
2. Select "Manage extension" → "Options"
3. Paste API key in settings page
4. Select model
5. Click Save

### Method 2: Direct Storage (Developer)
```javascript
chrome.storage.local.set({
  llmApiKey: 'sk-ant-...',
  llmModel: 'claude-3-5-sonnet-20241022'
});
```

### Method 3: Local Proxy
Modify `llm-analyzer.js`:
```javascript
const LLM_CONFIG = {
  apiKey: 'not-needed',
  apiEndpoint: 'http://localhost:3000/api/analyze-tabs',
  proxyMode: true
};
```

## Security Considerations

### Data Sent to API
- Task description
- Tab titles
- Tab URLs

### Data NOT Sent
- Tab contents
- Browsing history
- Personal information
- System/extension pages

### Best Practices
- Store API key in chrome.storage (not in code)
- Filter sensitive URLs before sending
- Consider proxy for additional privacy
- Never commit API keys to version control

## Prompt Engineering

The extension uses this prompt strategy:

```
Task: [user's task]
Tabs: [list of tabs with titles and URLs]

For each tab, provide:
- Relevance score (0-100)
- Brief explanation

Also provide:
- Overall relevance percentage
- Summary of findings
```

This design ensures:
- Structured JSON responses
- Consistent scoring
- Useful explanations
- Actionable summaries

## Error Handling

```javascript
try {
  const response = await callLLMAPI(prompt)
  const results = parseAnalysisResponse(response)
  displayResults(results)
} catch (error) {
  // Fall back to keyword matching
  const results = fallbackAnalysis(task, tabs)
  displayResults(results)
}
```

Errors handled:
- Missing API key → Show user instructions
- Invalid API key → Show auth error
- Network errors → Fall back to keyword matching
- Parsing errors → Use fallback mode
- Rate limits → Queue and retry

## Performance Optimizations

1. **Lazy Loading**: LLM module only loaded when needed
2. **Caching**: Results stored temporarily
3. **Filtering**: System pages excluded before API call
4. **Rate Limiting**: Single request per analysis
5. **Timeout**: 10-second timeout per API call

## Testing Recommendations

### Manual Testing
1. Test with various task descriptions
2. Test with 5-50 open tabs
3. Test with different Claude models
4. Test API error scenarios
5. Test fallback keyword matching

### Edge Cases
- Empty task description
- No open tabs
- System pages mixed with regular tabs
- Very long URLs
- Non-English tab titles
- API rate limits

## Future Enhancements

1. **Persistent History**: Store analysis results
2. **Smart Recommendations**: Auto-close distracting tabs
3. **Task Templates**: Pre-defined tasks (Study, Work, Create, etc.)
4. **Multiple Providers**: Support OpenAI, Gemini, etc.
5. **Batch Analysis**: Analyze multiple times during session
6. **Learning**: Remember user preferences
7. **Statistics**: Track focus quality over time
8. **Integration**: Connect with calendar, todos

## Troubleshooting Guide

### "LLM API key not configured"
- Open Settings (right-click → Options)
- Paste Claude API key
- Click Save

### "API Error: 401 Unauthorized"
- Verify API key in settings
- Check key hasn't been revoked
- Create new key if needed

### "No JSON found in response"
- Claude API response format changed
- Extension will fall back to keyword matching
- Check LLM_ANALYZER_JS for response parsing

### Slow Analysis
- Too many tabs? Try with fewer
- API might be slow, wait 10 seconds
- Consider using Haiku model (faster)

### No Results Display
- Check browser console for errors
- Verify popup.js loaded llm-analyzer.js
- Try fallback mode (remove API key)

## Code Architecture

### Module Structure
```
popup.html
├── popup.js (UI logic)
├── llm-analyzer.js (LLM integration)
└── popup.css (styles)

background.js (State management)
├── Storage (chrome.storage.local)
├── Message handling
└── Focus session logic

settings.html (Configuration UI)
└── settings.js (Settings logic)

manifest.json (Configuration)
```

### Key Functions

**llm-analyzer.js**
- `analyzeTabs(task, tabs)` - Main analysis function
- `buildAnalysisPrompt(task, tabs)` - Prompt generation
- `callLLMAPI(prompt)` - API communication
- `parseAnalysisResponse(response, tabs)` - Response parsing
- `fallbackAnalysis(task, tabs)` - Keyword matching fallback

**popup.js**
- `analyzeTabsForTask(task)` - Tab collection and analysis
- `displayAnalysisResults(results)` - UI rendering
- `checkStatus()` - Session status check
- `startBtn` event handlers

**settings.html**
- `saveSettings()` - Persist API key
- `clearSettings()` - Remove API key
- `loadSettings()` - Load from storage

## Maintenance Notes

- Update Claude model versions as they're released
- Monitor API pricing and usage
- Handle API deprecations
- Keep fallback mode robust
- Test regularly with new Chrome versions

## Support Resources

- [Claude API Documentation](https://docs.anthropic.com/)
- [Anthropic Console](https://console.anthropic.com/)
- [Chrome Extension Documentation](https://developer.chrome.com/docs/extensions/)
- [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/storage/)
