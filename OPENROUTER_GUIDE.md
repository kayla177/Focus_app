# OpenRouter Integration Guide

## What is OpenRouter?

OpenRouter is a unified API gateway that provides access to multiple LLMs (Claude, GPT-4, Llama, Mistral, etc.) through a single interface. It's a great alternative to using provider APIs directly.

**Website:** https://openrouter.ai/

## Why Use OpenRouter?

✅ **Single API** - Access Claude, GPT-4, and 50+ other models with one key  
✅ **Better Pricing** - Often cheaper than direct API access  
✅ **Flexible** - Easy to switch between models  
✅ **Reliable** - Built-in fallback and load balancing  
✅ **Analytics** - Built-in usage tracking and limits  
✅ **Latest Models** - Early access to new models  

## Getting Started with OpenRouter

### Step 1: Create Account & Get API Key
1. Go to https://openrouter.ai/
2. Sign up with email or social login
3. Navigate to "Keys" in your dashboard
4. Create a new API key
5. Copy the key (store it securely)

### Step 2: Configure Your Focus Mode Extension

**Method A: Via Settings Page**
1. Right-click Focus Mode icon → "Manage extension" → "Options"
2. Look for provider selection (if using updated settings.html)
3. Select "OpenRouter"
4. Paste your OpenRouter API key
5. Choose your model
6. Click Save

**Method B: Manual Configuration**
Edit `llm-analyzer.js`:
```javascript
const LLM_CONFIG = {
  apiKey: null,  // Will load from chrome.storage
  apiProvider: 'openrouter',
  apiEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
  model: 'anthropic/claude-3-5-sonnet',
};
```

Then in browser console (DevTools):
```javascript
chrome.storage.local.set({
  llmApiKey: 'your-openrouter-key-here'
});
```

## Available Models on OpenRouter

### Claude (Anthropic)
- `anthropic/claude-3-5-sonnet` ⭐ **Recommended** - Best balance
- `anthropic/claude-3-opus` - Most capable
- `anthropic/claude-3-haiku` - Fastest/cheapest

### GPT (OpenAI)
- `openai/gpt-4-turbo` - Most capable
- `openai/gpt-4` - Reliable
- `openai/gpt-3.5-turbo` - Fastest

### Open Source
- `meta-llama/llama-2-70b` - High quality open source
- `mistralai/mistral-7b` - Fast and efficient
- `mistralai/mistral-large` - Larger variant
- `nousresearch/nous-hermes-2-mixtral-8x7b`

### Other
- `google/palm-2` - Google's model
- `cohere/command` - Cohere's model

**See all models:** https://openrouter.ai/docs#models

## Pricing Comparison

### Anthropic Claude (Direct)
- Input: $3 per 1M tokens
- Output: $15 per 1M tokens
- **Per analysis: ~$0.01-0.02**

### OpenRouter (Claude)
- Variable pricing (usually 10-20% cheaper)
- Transparent per-request costs
- Volume discounts available
- **Per analysis: ~$0.008-0.015**

### OpenRouter (GPT-3.5-turbo)
- Even cheaper than Claude
- **Per analysis: ~$0.001-0.002**

## Configuration Examples

### Minimum Config (Use defaults)
```javascript
// Just set apiProvider and get key from storage
LLM_CONFIG.apiProvider = 'openrouter';
```

### Custom Model
```javascript
const LLM_CONFIG = {
  apiKey: null,
  apiProvider: 'openrouter',
  apiEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
  model: 'openai/gpt-4-turbo'  // Change model
};
```

### For Testing (cheaper)
```javascript
const LLM_CONFIG = {
  apiKey: null,
  apiProvider: 'openrouter',
  apiEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
  model: 'openai/gpt-3.5-turbo'  // Very cheap
};
```

## How It Works

1. **Request Format**: Extension sends prompt in OpenRouter format
2. **API Call**: Your key is sent to OpenRouter (not the browser)
3. **Routing**: OpenRouter routes to chosen model
4. **Response**: Results come back and are parsed
5. **Fallback**: If unavailable, automatic fallback to keyword matching

## Troubleshooting

### "Unauthorized" Error
- Verify API key is correct
- Check key hasn't expired or been revoked
- Ensure key has billing set up (free tier has limits)

### "Model not found"
- Check model name in LLM_CONFIG
- Visit https://openrouter.ai/docs#models for current list
- Some models may be rate-limited or unavailable

### Slow Responses
- OpenRouter queues requests during high traffic
- GPT models may be slower than expected
- Use Haiku/Mistral for faster responses

### High Costs
- Monitor usage in OpenRouter dashboard
- Use cheaper models like GPT-3.5-turbo
- Set rate limits in your account

## Best Practices

✅ **Use Claude 3.5 Sonnet** - Best balance of speed/quality/price  
✅ **Monitor Usage** - Check OpenRouter dashboard regularly  
✅ **Set Spending Limits** - In account settings  
✅ **Keep Key Secure** - Never commit to git or share  
✅ **Use Chrome Storage** - Don't hardcode in code  
✅ **Test Before Production** - Try with a small key first  

## Security

### What's Sent
- Task description
- Tab titles and URLs
- (All through OpenRouter, not directly)

### What's Not Sent
- Tab contents
- Browsing history
- Personal data

### API Key Protection
- Store in `chrome.storage.local` (local to browser)
- Never hardcode in source
- Use environment variables if setting up proxy
- Can be rotated in OpenRouter dashboard anytime

## Switching Providers

Easy to switch between OpenRouter and Anthropic direct:

```javascript
// Switch to Anthropic
LLM_CONFIG.apiProvider = 'anthropic';
LLM_CONFIG.apiEndpoint = 'https://api.anthropic.com/v1/messages';

// Switch back to OpenRouter
LLM_CONFIG.apiProvider = 'openrouter';
LLM_CONFIG.apiEndpoint = 'https://openrouter.ai/api/v1/chat/completions';
```

## Additional Resources

- **OpenRouter Docs**: https://openrouter.ai/docs
- **Model Pricing**: https://openrouter.ai/docs#models
- **API Reference**: https://openrouter.ai/docs#quick-start
- **Status Page**: https://status.openrouter.ai/

## Support

For OpenRouter-specific issues:
- Check https://status.openrouter.io/
- Visit their support: https://openrouter.ai/contact
- Check rate limits in your account

For Focus Mode Extension issues:
- Check LLM_SETUP_GUIDE.md troubleshooting section
- Review llm-analyzer.js for configuration options
- Check browser console for error messages

---

**TL;DR:** Get an OpenRouter key, set `apiProvider: 'openrouter'`, paste your key in settings, choose your model, and you're done! 🚀
