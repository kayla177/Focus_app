# Code Examples & Integration Guide

## Example 1: Basic Usage

### User Workflow
```javascript
// User enters task
const task = "Complete Python data analysis project";

// User clicks analyze button
analyzeTabsForTask(task);

// Extension collects tabs
chrome.tabs.query({}, (tabs) => {
  const tabData = tabs.map(tab => ({
    title: tab.title,
    url: tab.url
  }));
});

// Claude analyzes and returns
{
  "tabs": [
    {"index": 1, "relevance": 95, "reason": "GitHub repo for the project"},
    {"index": 2, "relevance": 85, "reason": "Pandas documentation"},
    {"index": 3, "relevance": 5, "reason": "YouTube video unrelated"}
  ],
  "overallRelevance": 62,
  "summary": "Most of your tabs are relevant..."
}

// Results displayed to user
```

---

## Example 2: API Configuration

### Method A: Settings Page
```html
<!-- settings.html provides UI for this -->
<input type="password" id="apiKey" placeholder="sk-ant-...">
<button onclick="saveSettings()">Save</button>

<!-- JavaScript -->
<script>
function saveSettings() {
  const apiKey = document.getElementById('apiKey').value;
  chrome.storage.local.set({
    llmApiKey: apiKey,
    llmModel: 'claude-3-5-sonnet-20241022'
  });
}
</script>
```

### Method B: Developer Console
```javascript
// Open DevTools for popup
chrome.storage.local.set({
  llmApiKey: 'sk-ant-xxx...',
  llmModel: 'claude-3-5-sonnet-20241022'
});

// Verify it's set
chrome.storage.local.get(['llmApiKey'], (data) => {
  console.log('API Key set:', !!data.llmApiKey);
});
```

### Method C: Backend Proxy
```javascript
// Node.js express server
const express = require('express');
const fetch = require('node-fetch');
const app = express();

app.post('/api/analyze-tabs', async (req, res) => {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(req.body)
  });
  const data = await response.json();
  res.json(data);
});

app.listen(3000);
```

---

## Example 3: Implementing Custom Prompts

### Modifying the Analysis Prompt

```javascript
// In llm-analyzer.js, customize buildAnalysisPrompt()

function buildAnalysisPrompt(task, tabs) {
  // Custom prompt with specific criteria
  return `You are a productivity assistant. Analyze browser tabs for focus.

TASK: "${task}"

TABS:
${tabs.map((t, i) => `${i+1}. ${t.title}\n   ${t.url}`).join('\n')}

Evaluate each tab on:
1. Direct relevance to task
2. Supporting resources
3. Distraction level
4. Time-sensitivity

Respond with JSON:
{
  "tabs": [
    {
      "index": 1,
      "relevance": 90,
      "category": "primary|supporting|distraction",
      "reason": "...",
      "action": "keep|close|maybe"
    }
  ],
  "overallRelevance": 75,
  "summary": "...",
  "recommendations": ["Close tab 3", "Keep tabs 1 and 2"]
}`;
}
```

---

## Example 4: Enhanced Fallback Analysis

### Custom Keyword Matching

```javascript
function advancedFallbackAnalysis(task, tabs) {
  // Extract task keywords with weights
  const taskWords = task.toLowerCase().split(/[\s\-_]+/);
  const weights = {
    primary: 3,      // Task keywords
    supporting: 2,   // Common related terms
    distraction: -2  // Known distraction sites
  };

  // Common distraction patterns
  const distractionKeywords = [
    'youtube', 'reddit', 'twitter', 'facebook', 'tiktok', 'instagram'
  ];
  
  // Supporting patterns for common tasks
  const supportingKeywords = {
    'python': ['github', 'stackoverflow', 'documentation', 'jupyter'],
    'study': ['wikipedia', 'khan academy', 'coursera', 'documentation'],
    'write': ['grammarly', 'thesaurus', 'dictionary', 'google docs']
  };

  const results = tabs.map(tab => {
    const content = `${tab.title} ${tab.url}`.toLowerCase();
    
    // Check for distractions
    const hasDistraction = distractionKeywords.some(kw => 
      content.includes(kw)
    );
    if (hasDistraction) {
      return { tab, relevance: 5, reason: 'Known distraction site' };
    }

    // Count keyword matches
    const matches = taskWords.filter(kw => content.includes(kw)).length;
    const relevance = Math.min(100, (matches / taskWords.length) * 100);

    return {
      tab,
      relevance,
      reason: matches > 0 ? 'Keywords matched' : 'No relevance detected'
    };
  });

  return results;
}
```

---

## Example 5: Testing the Implementation

### Unit Tests

```javascript
// Test API key validation
async function testApiKeyValidation() {
  // Test 1: Missing API key
  chrome.storage.local.set({ llmApiKey: null });
  try {
    await analyzeTabs('task', []);
    console.error('Should have thrown error');
  } catch (e) {
    console.log('✓ Correctly threw error for missing API key');
  }

  // Test 2: Valid API key
  chrome.storage.local.set({ llmApiKey: 'sk-ant-xxx' });
  try {
    // Mock API response
    const result = await analyzeTabs('task', [
      { title: 'Test', url: 'https://example.com' }
    ]);
    console.log('✓ Correctly processed with API key');
  } catch (e) {
    console.log('✓ Fell back to keyword matching');
  }
}

// Test prompt generation
function testPromptGeneration() {
  const task = 'Complete Python project';
  const tabs = [
    { title: 'GitHub', url: 'https://github.com/myproject' },
    { title: 'YouTube', url: 'https://youtube.com' }
  ];

  const prompt = buildAnalysisPrompt(task, tabs);
  console.assert(prompt.includes(task), 'Task in prompt');
  console.assert(prompt.includes('GitHub'), 'Tab title in prompt');
  console.assert(prompt.includes('json'), 'JSON format requested');
  console.log('✓ Prompt generation correct');
}

// Test response parsing
function testResponseParsing() {
  const response = JSON.stringify({
    tabs: [
      { index: 1, relevance: 95, reason: 'GitHub repo' },
      { index: 2, relevance: 5, reason: 'Unrelated video' }
    ],
    overallRelevance: 50,
    summary: 'Mixed relevance'
  });

  const parsed = parseAnalysisResponse(response, [
    { title: 'GitHub', url: 'https://github.com' },
    { title: 'YouTube', url: 'https://youtube.com' }
  ]);

  console.assert(parsed.tabs.length === 2, 'Correct number of tabs');
  console.assert(parsed.overallRelevance === 50, 'Correct overall relevance');
  console.log('✓ Response parsing correct');
}
```

---

## Example 6: Advanced Features

### Scheduling Analysis

```javascript
// Run analysis periodically during focus session
function schedulePeriodicAnalysis(intervalMinutes = 30) {
  const checkInterval = setInterval(async () => {
    const data = await chrome.storage.local.get(['focusMode', 'task']);
    
    if (!data.focusMode) {
      clearInterval(checkInterval);
      return;
    }

    // Run analysis automatically
    const tabs = await chrome.tabs.query({});
    const results = await analyzeTabs(data.task, tabs);

    // Show notification if distraction detected
    if (results.overallRelevance < 50) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon.png',
        title: 'Focus Alert',
        message: 'Consider closing distracting tabs'
      });
    }
  }, intervalMinutes * 60 * 1000);
}
```

### Persistent Analysis History

```javascript
// Store analysis results
async function saveAnalysisResult(task, result) {
  const history = await chrome.storage.local.get('analysisHistory');
  const entries = history.analysisHistory || [];
  
  entries.push({
    timestamp: Date.now(),
    task: task,
    overallRelevance: result.overallRelevance,
    tabCount: result.tabs.length,
    summary: result.summary
  });

  // Keep only last 100 analyses
  if (entries.length > 100) {
    entries.shift();
  }

  await chrome.storage.local.set({ analysisHistory: entries });
}

// Retrieve history
async function getAnalysisHistory() {
  const data = await chrome.storage.local.get('analysisHistory');
  return data.analysisHistory || [];
}

// Generate statistics
async function generateStats() {
  const history = await getAnalysisHistory();
  const avgRelevance = history.reduce((sum, e) => 
    sum + e.overallRelevance, 0) / history.length;
  
  return {
    totalAnalyses: history.length,
    avgRelevance: Math.round(avgRelevance),
    lastAnalysis: history[history.length - 1]?.timestamp
  };
}
```

### Auto-Close Distracting Tabs

```javascript
// Automatically close very low-relevance tabs
async function autoCloseDistractingTabs(results, threshold = 10) {
  const tabsToClose = results.tabs
    .filter(tab => tab.relevance < threshold)
    .map((tab, idx) => results.tabs[idx].tabId);

  if (tabsToClose.length > 0) {
    const confirmed = await new Promise(resolve => {
      chrome.runtime.sendMessage({
        action: 'confirmCloseTabs',
        tabCount: tabsToClose.length
      }, resolve);
    });

    if (confirmed) {
      tabsToClose.forEach(tabId => {
        chrome.tabs.remove(tabId);
      });
    }
  }
}
```

---

## Example 7: Error Recovery

### Robust API Calls

```javascript
async function robustApiCall(prompt, maxRetries = 3) {
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(LLM_CONFIG.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': LLM_CONFIG.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: LLM_CONFIG.model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }]
        }),
        timeout: 10000 // 10 second timeout
      });

      if (!response.ok) {
        const error = await response.json();
        
        // Handle specific errors
        if (response.status === 401) {
          throw new Error('Invalid API key');
        } else if (response.status === 429) {
          // Rate limit - wait and retry
          await new Promise(resolve => 
            setTimeout(resolve, 1000 * (i + 1))
          );
          continue;
        } else if (response.status === 500) {
          // Server error - retry
          await new Promise(resolve => 
            setTimeout(resolve, 1000 * (i + 1))
          );
          continue;
        }
        
        throw new Error(`API Error: ${error.error?.message || 'Unknown'}`);
      }

      const data = await response.json();
      return data.content[0].text;

    } catch (error) {
      lastError = error;
      if (i < maxRetries - 1) {
        // Exponential backoff
        await new Promise(resolve => 
          setTimeout(resolve, 1000 * Math.pow(2, i))
        );
      }
    }
  }

  throw new Error(`API call failed after ${maxRetries} retries: ${lastError.message}`);
}
```

---

## Example 8: Integration with Other Features

### Combine with Website Blocking

```javascript
// Suggest blocking distracting sites
async function suggestBlockingRules(analysisResults) {
  const distractingTabs = analysisResults.tabs
    .filter(tab => tab.relevance < 20)
    .map(tab => {
      try {
        const url = new URL(tab.url);
        return url.hostname;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (distractingTabs.length > 0) {
    return {
      suggestion: 'Block these distracting sites?',
      sites: distractingTabs,
      action: 'addToBlockList'
    };
  }
}

// User can then click to add to focus-allowed list
function blockSuggestedSites(sites) {
  const allowed = [...currentAllowedSites];
  sites.forEach(site => {
    if (!allowed.includes(site)) {
      allowed.push(site);
    }
  });
  return allowed;
}
```

---

## Quick Reference: Common Tasks

### Get Current Task
```javascript
const data = await chrome.storage.local.get('task');
const currentTask = data.task || '';
```

### Get All Tabs
```javascript
const tabs = await chrome.tabs.query({});
```

### Save Settings
```javascript
chrome.storage.local.set({
  llmApiKey: 'sk-ant-...',
  llmModel: 'claude-3-5-sonnet-20241022'
});
```

### Analyze Tabs Directly
```javascript
const tabs = await chrome.tabs.query({});
const results = await analyzeTabs('Your task', tabs);
```

### Check If Configured
```javascript
const data = await chrome.storage.local.get('llmApiKey');
const isConfigured = !!data.llmApiKey;
```

---

That's your complete code reference! 🚀
