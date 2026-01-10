// LLM-based Tab Analyzer for Focus Mode Extension
// This module uses OpenRouter API to analyze open tabs against a user's task
// API Key must be configured in extension settings and stored in chrome.storage.local

const LLM_CONFIG = {
	apiKey: null, // Loaded from chrome.storage.local (llmApiKey)
	apiProvider: "openrouter",
	apiEndpoint: "https://openrouter.ai/api/v1/chat/completions",
	model: "anthropic/claude-3-5-sonnet",
};

/**
 * Analyzes open tabs to determine if they're related to the user's task
 * @param {string} task - The user's current task description
 * @param {Array} tabs - Array of tab objects with {title, url}
 * @returns {Promise<Object>} Analysis results
 */
async function analyzeTabs(task, tabs) {
	// Load API key from chrome storage (must be saved in settings first)
	const storageData = await chrome.storage.local.get("llmApiKey");
	const apiKey = storageData.llmApiKey;

	if (!apiKey) {
		throw new Error(
			"OpenRouter API key not configured. Please set it in extension settings (chrome-extension settings icon)."
		);
	}

	// Ensure the API key is set for the API call
	LLM_CONFIG.apiKey = apiKey;

	// Filter out extension pages and sensitive URLs
	const filteredTabs = tabs.filter((tab) => {
		if (!tab.url) return false;
		if (
			tab.url.startsWith("chrome://") ||
			tab.url.startsWith("chrome-extension://")
		)
			return false;
		if (tab.url.startsWith("about:")) return false;
		return true;
	});

	const prompt = buildAnalysisPrompt(task, filteredTabs);

	try {
		const response = await callLLMAPI(prompt);
		const analysis = parseAnalysisResponse(response, filteredTabs);
		return analysis;
	} catch (error) {
		console.error("LLM API Error:", error);
		// Fallback to simple keyword matching
		return fallbackAnalysis(task, filteredTabs);
	}
}

/**
 * Builds the prompt for the LLM
 */
function buildAnalysisPrompt(task, tabs) {
	const tabList = tabs
		.map(
			(tab, idx) =>
				`${idx + 1}. Title: "${tab.title}"\n   URL: ${tab.url}`
		)
		.join("\n");

	return `You are a task focus analyzer. Analyze these open browser tabs and determine if they are relevant to the user's stated task.

USER'S TASK: "${task}"

OPEN TABS:
${tabList}

For each tab, provide a JSON object with:
- index: the tab number
- relevance: 0-100 score (100 = directly related, 0 = completely unrelated)
- reason: brief explanation in one sentence

Then provide:
- overallRelevance: average relevance score across all tabs
- summary: 2-3 sentence summary of findings

Respond ONLY with valid JSON in this format:
{
  "tabs": [
    {"index": 1, "relevance": 85, "reason": "Directly related to the task"},
    ...
  ],
  "overallRelevance": 70,
  "summary": "Most tabs are relevant to your task..."
}`;
}

/**
 * Calls the OpenRouter API
 */
async function callLLMAPI(prompt) {
	return callOpenRouterAPI(prompt);
}

/**
 * Calls OpenRouter API
 */
async function callOpenRouterAPI(prompt) {
	if (!LLM_CONFIG.apiKey) {
		throw new Error("API key not available");
	}

	const response = await fetch(LLM_CONFIG.apiEndpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${LLM_CONFIG.apiKey}`,
			"HTTP-Referer": chrome.runtime.getURL("popup.html"),
			"X-Title": "Focus Mode Extension",
		},
		body: JSON.stringify({
			model: LLM_CONFIG.model,
			max_tokens: 1024,
			messages: [
				{
					role: "user",
					content: prompt,
				},
			],
		}),
	});

	if (!response.ok) {
		const errorData = await response.json();
		const errorMsg = errorData.error?.message || JSON.stringify(errorData);
		throw new Error(`OpenRouter API Error: ${errorMsg}`);
	}

	const data = await response.json();
	return data.choices[0].message.content;
}

/**
 * Parses the LLM response and structures it with tab data
 */
function parseAnalysisResponse(response, tabs) {
	try {
		// Extract JSON from the response (in case there's extra text)
		const jsonMatch = response.match(/\{[\s\S]*\}/);
		if (!jsonMatch) {
			throw new Error("No JSON found in response");
		}

		const parsed = JSON.parse(jsonMatch[0]);

		// Merge with original tab data
		const enrichedTabs = parsed.tabs.map((analysis) => {
			const tab = tabs[analysis.index - 1];
			return {
				title: tab.title,
				url: tab.url,
				relevance: analysis.relevance,
				reason: analysis.reason,
			};
		});

		return {
			task: "Task Analysis Results",
			tabs: enrichedTabs,
			overallRelevance: parsed.overallRelevance,
			summary: parsed.summary,
		};
	} catch (error) {
		console.error("Error parsing LLM response:", error);
		throw error;
	}
}

/**
 * Fallback analysis using simple keyword matching
 * Used if LLM is unavailable
 */
function fallbackAnalysis(task, tabs) {
	const taskKeywords = task
		.toLowerCase()
		.split(/\s+/)
		.filter((w) => w.length > 3);

	const analyzedTabs = tabs.map((tab) => {
		const fullText = `${tab.title} ${tab.url}`.toLowerCase();
		const matches = taskKeywords.filter((kw) =>
			fullText.includes(kw)
		).length;
		const relevance =
			Math.min(100, Math.round((matches / taskKeywords.length) * 100)) ||
			0;

		let reason = "";
		if (relevance >= 70) {
			reason = "Keywords from your task found in this tab";
		} else if (relevance >= 40) {
			reason = "Some relevance detected to your task";
		} else {
			reason = "Does not appear related to your current task";
		}

		return {
			title: tab.title,
			url: tab.url,
			relevance: relevance,
			reason: reason,
		};
	});

	const overallRelevance = Math.round(
		analyzedTabs.reduce((sum, tab) => sum + tab.relevance, 0) /
			analyzedTabs.length
	);

	return {
		task: "Task Analysis Results (Basic Mode)",
		tabs: analyzedTabs,
		overallRelevance: overallRelevance,
		summary: `Using keyword matching: ${overallRelevance}% of your tabs appear relevant to "${task}". For better analysis, configure an LLM API key.`,
	};
}

// Export for use in popup.js
window.analyzeTabs = analyzeTabs;
