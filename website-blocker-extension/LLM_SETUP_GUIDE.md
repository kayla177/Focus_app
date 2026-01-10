# Focus Mode Extension - LLM Tab Analysis Feature

## Overview
The Focus Mode extension now includes an AI-powered tab analyzer that uses an LLM (Large Language Model) to determine if your open browser tabs are related to your current task. This helps you stay focused by identifying distracting tabs.

## Features
- **Task Input**: Specify what you're working on before starting your focus session
- **Smart Tab Analysis**: AI analyzes all open tabs and compares them to your task
- **Relevance Scoring**: Each tab gets a relevance score (0-100%) indicating how related it is to your task
- **Fallback Mode**: If no LLM is configured, the extension uses keyword matching
- **Session Tracking**: Your task is displayed during the entire focus session

## Setup Instructions

### Option 1: Using Claude API Directly (Anthropic)

1. **Get an API Key**
   - Go to https://console.anthropic.com/
   - Create an account or sign in
   - Navigate to "API Keys"
   - Create a new API key
   - Copy the key (keep it secure!)

2. **Configure the Extension**
   - Right-click on the extension icon
   - Select "Manage extension"
   - Click "Extension options"
   - Paste your API key
   - Leave the provider as "anthropic"
   - Click Save

### Option 2: Using OpenRouter API (Recommended Alternative)

OpenRouter provides access to Claude and many other LLMs through a single unified API.

1. **Get an API Key**
   - Go to https://openrouter.ai/
   - Create an account or sign in
   - Navigate to "Keys" section
   - Create a new API key
   - Copy the key (keep it secure!)

2. **Configure the Extension**
   - Right-click on the extension icon
   - Select "Manage extension"
   - Click "Extension options"
   - Paste your OpenRouter API key
   - Select provider: "openrouter"
   - Choose your model:
     - `anthropic/claude-3-5-sonnet` (recommended)
     - `anthropic/claude-3-opus`
     - `anthropic/claude-3-haiku`
     - Or any other available model
   - Click Save

3. **Why Use OpenRouter?**
   - Single API for multiple LLM providers
   - Often cheaper than direct API access
   - Access to bleeding-edge models
   - Better rate limits
   - Includes usage analytics

### Option 3: Using a Local Proxy Server

If you want to avoid exposing your API key to the browser:

1. **Set up a backend server** that proxies requests to your chosen LLM API
2. **Modify `llm-analyzer.js` to use your proxy:**
   ```javascript
   const LLM_CONFIG = {
     apiKey: 'not-needed',
     apiProvider: 'proxy',
     apiEndpoint: 'http://localhost:3000/api/analyze-tabs',
     model: 'your-model'
   };
   ```

3. **Example Node.js proxy for OpenRouter:**
   ```javascript
   const express = require('express');
   const fetch = require('node-fetch');
   const app = express();

   app.post('/api/analyze-tabs', async (req, res) => {
     const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
       method: 'POST',
       headers: {
         'Content-Type': 'application/json',
         'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
       },
       body: JSON.stringify(req.body)
     });
     const data = await response.json();
     res.json(data);
   });

   app.listen(3000);
   ```

### Option 4: Fallback Keyword Matching

The extension will automatically fall back to keyword matching if:
- No LLM API key is configured
- The API is unavailable
- There's a network error

This provides basic tab relevance analysis without requiring an API.

## How It Works

### When You Click "Analyze Open Tabs"

1. **Tab Collection**: The extension gathers all open tabs (excluding system pages)
2. **Prompt Generation**: Creates a detailed prompt for the LLM with:
   - Your task description
   - All open tab titles and URLs
3. **API Call**: Sends the prompt to Claude API
4. **Analysis**: Claude evaluates each tab's relevance to your task
5. **Results Display**: Shows:
   - Individual tab relevance scores
   - Overall relevance percentage
   - Explanations for each tab
   - Summary of findings

### Relevance Scoring

- **70-100%**: Highly relevant - these tabs support your current task
- **40-70%**: Partially relevant - might be useful but could be distracting
- **0-40%**: Not relevant - consider closing these tabs

## Data Privacy

### What's Sent to the API
- Your task description
- Open tab titles
- Open tab URLs

### What's NOT Sent
- Tab contents or page data
- Your browsing history
- Personal information not in the URLs
- Chrome extension or system pages (filtered out)

### Security Notes
- Never commit your API key to version control
- Use the chrome storage method for local setup
- Consider using a proxy server for additional privacy
- The extension runs entirely on your machine; no data is logged by Focus Mode

## Troubleshooting

### "API Error: Unauthorized"
- Your API key is invalid or expired
- Check that you copied the full key from Claude console
- Verify the key hasn't been revoked

### "No JSON found in response"
- The API response format may have changed
- Try using the fallback keyword matching
- Check that you're using the correct Claude model

### Tabs Not Analyzing
- Make sure you've entered a task description first
- Check browser console (DevTools) for error messages
- Verify you have internet connection
- Try adding one tab at a time

### Slow Analysis
- Large number of tabs can slow down analysis
- Close unnecessary tabs before analyzing
- First request may be slightly slower

## Advanced Configuration

### Using Different Providers and Models

You can modify `llm-analyzer.js` to use different providers and models:

#### Anthropic Claude (Direct)
```javascript
const LLM_CONFIG = {
  apiKey: null,
  apiProvider: 'anthropic',
  apiEndpoint: 'https://api.anthropic.com/v1/messages',
  model: 'claude-3-5-sonnet-20241022'  // or claude-3-opus-20240229, claude-3-haiku-20240307
};
```

#### OpenRouter (Recommended)
```javascript
const LLM_CONFIG = {
  apiKey: null,
  apiProvider: 'openrouter',
  apiEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
  model: 'anthropic/claude-3-5-sonnet'  // or 'anthropic/claude-3-opus', 'anthropic/claude-3-haiku'
};
```

#### Other OpenRouter Models
```javascript
// GPT-4
model: 'openai/gpt-4'

// GPT-3.5-turbo
model: 'openai/gpt-3.5-turbo'

// Llama 2
model: 'meta-llama/llama-2-70b'

// Mistral
model: 'mistralai/mistral-7b'

// See all available models at: https://openrouter.ai/docs#models
```

### Custom LLM Models (Legacy)

Available Claude models:
- `claude-3-opus-20240229` - Most capable (slower)
- `claude-3-sonnet-20240229` - Balanced
- `claude-3-5-sonnet-20241022` - Latest, recommended
- `claude-3-haiku-20240307` - Fastest (less accurate)

### Custom Prompts

Edit the `buildAnalysisPrompt()` function in `llm-analyzer.js` to customize how the LLM analyzes tabs.

## Example Usage

1. **Start a focus session**:
   - Input task: "Complete Python data analysis project"
   - Add allowed sites: github.com, stackoverflow.com, python.org
   - Set duration: 2 hours

2. **Analyze your open tabs**:
   - Click "Analyze Open Tabs"
   - Results show:
     - GitHub tab: 95% relevant
     - StackOverflow tab: 85% relevant
     - YouTube tab: 5% relevant
     - News site: 0% relevant

3. **Take action**:
   - Keep relevant tabs open
   - Close distracting tabs
   - Start your focus session

## Limitations

- Requires internet connection for LLM analysis
- API calls may have latency (usually 1-3 seconds)
- LLM analysis quality depends on how clearly you describe your task
- Very long tab lists (50+ tabs) may hit API size limits

## Future Enhancements

Potential improvements:
- Persistent analysis history
- Smart tab grouping
- Automatic tab closing suggestions
- Integration with other focus tools
- Support for additional LLM providers
- Batch tab analysis recommendations

## Support

For issues or feature requests, check the extension settings or contact the developer.
