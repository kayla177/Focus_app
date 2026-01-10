// Popup script for Focus Mode extension

document.addEventListener("DOMContentLoaded", () => {
	const setupView = document.getElementById("setupView");
	const activeView = document.getElementById("activeView");
	const taskInput = document.getElementById("taskInput");
	const siteInput = document.getElementById("siteInput");
	const addSiteBtn = document.getElementById("addSiteBtn");
	const allowedSitesList = document.getElementById("allowedSitesList");
	const durationBtns = document.querySelectorAll(".duration-btn");
	const customMinutes = document.getElementById("customMinutes");
	const startBtn = document.getElementById("startBtn");
	const endBtn = document.getElementById("endBtn");
	const timerText = document.getElementById("timerText");
	const focusSitesList = document.getElementById("focusSitesList");
	const analyzeTabsBtn = document.getElementById("analyzeTabsBtn");
	const analysisResults = document.getElementById("analysisResults");
	const currentTask = document.getElementById("currentTask");
	const distractionWarnings = document.getElementById("distractionWarnings");
	const distractingTabsList = document.getElementById("distractingTabsList");
	const distractionCount = document.getElementById("distractionCount");

	let allowedSites = [];
	let selectedDuration = 60; // Default 60 minutes
	let timerInterval;
	let distractionCheckInterval;
	let userTask = "";

	// Check current status
	checkStatus();

	// Listen for distraction updates from background
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (message.action === "updateDistractions") {
			displayDistractions(message.distractingTabs);
		}
	});

	// Duration button clicks
	durationBtns.forEach((btn) => {
		btn.addEventListener("click", () => {
			durationBtns.forEach((b) => b.classList.remove("active"));
			btn.classList.add("active");
			selectedDuration = parseInt(btn.dataset.minutes);
			customMinutes.value = "";
		});
	});

	// Custom duration input
	customMinutes.addEventListener("input", () => {
		if (customMinutes.value) {
			durationBtns.forEach((b) => b.classList.remove("active"));
			selectedDuration = parseInt(customMinutes.value) || 60;
		}
	});

	// Add site button
	addSiteBtn.addEventListener("click", addSite);
	siteInput.addEventListener("keypress", (e) => {
		if (e.key === "Enter") addSite();
	});

	// Start focus session
	startBtn.addEventListener("click", () => {
		// Add current input if not empty
		if (siteInput.value.trim()) {
			addSite();
		}

		// Allow starting focus if either a task or at least one allowed site is provided
		const hasTask = !!taskInput.value.trim();
		const hasSites = allowedSites.length > 0;
		if (!hasTask && !hasSites) {
			alert(
				"Please enter a task or add at least one website to focus on!"
			);
			return;
		}

		userTask = taskInput.value.trim();
		// If user provided sites, enable blocking; if only task provided, do monitoring-only
		const blockDuringFocus = hasSites;

		chrome.runtime.sendMessage(
			{
				action: "startFocus",
				allowedSites: allowedSites,
				duration: selectedDuration,
				task: userTask,
				blockDuringFocus: blockDuringFocus,
			},
			(response) => {
				if (response && response.success) {
					checkStatus();
				}
			}
		);
	});

	// End session early
	endBtn.addEventListener("click", () => {
		if (confirm("Are you sure you want to end your focus session early?")) {
			chrome.runtime.sendMessage({ action: "stopFocus" }, () => {
				checkStatus();
			});
		}
	});

	// Analyze tabs button
	analyzeTabsBtn.addEventListener("click", () => {
		if (!taskInput.value.trim()) {
			alert("Please enter your task first!");
			return;
		}
		analyzeTabsForTask(taskInput.value.trim());
	});

	function addSite() {
		let site = siteInput.value.trim().toLowerCase();
		if (!site) return;

		// Clean up the URL
		site = site.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0];

		if (!allowedSites.includes(site)) {
			allowedSites.push(site);
			renderAllowedSites();
		}
		siteInput.value = "";
	}

	function removeSite(site) {
		allowedSites = allowedSites.filter((s) => s !== site);
		renderAllowedSites();
	}

	function renderAllowedSites() {
		allowedSitesList.innerHTML = "";
		allowedSites.forEach((site) => {
			const div = document.createElement("div");
			div.className = "site-tag";
			div.innerHTML = `
        <span>${site}</span>
        <button class="remove-tag" data-site="${site}">×</button>
      `;
			allowedSitesList.appendChild(div);
		});

		document.querySelectorAll(".remove-tag").forEach((btn) => {
			btn.addEventListener("click", (e) => {
				removeSite(e.target.dataset.site);
			});
		});
	}

	function checkStatus() {
		chrome.runtime.sendMessage({ action: "getStatus" }, (data) => {
			if (data && data.focusMode && data.endTime > Date.now()) {
				showActiveView(data);
			} else {
				showSetupView();
			}
		});
	}

	function showSetupView() {
		setupView.style.display = "block";
		activeView.style.display = "none";
		allowedSites = [];
		renderAllowedSites();
		analysisResults.style.display = "none";
		if (timerInterval) clearInterval(timerInterval);
	}

	function showActiveView(data) {
		setupView.style.display = "none";
		activeView.style.display = "block";

		// Show current task
		currentTask.textContent = data.task || "No task specified";

		// Show focus sites
		focusSitesList.innerHTML = "";
		(data.allowedSites || []).forEach((site) => {
			const li = document.createElement("li");
			li.textContent = site;
			focusSitesList.appendChild(li);
		});

		// Show any existing distractions
		if (data.distractingTabs && data.distractingTabs.length > 0) {
			displayDistractions(data.distractingTabs);
		}

		// Start timer
		updateTimer(data.endTime);
		if (timerInterval) clearInterval(timerInterval);
		timerInterval = setInterval(() => updateTimer(data.endTime), 1000);

		// Start periodic distraction checking
		if (distractionCheckInterval) clearInterval(distractionCheckInterval);
		distractionCheckInterval = setInterval(() => {
			chrome.runtime.sendMessage(
				{ action: "getDistractions" },
				(distractions) => {
					if (distractions && distractions.length > 0) {
						displayDistractions(distractions);
					}
				}
			);
		}, 5000); // Check every 5 seconds
	}

	function updateTimer(endTime) {
		const remaining = Math.max(0, endTime - Date.now());

		if (remaining <= 0) {
			checkStatus();
			return;
		}

		const minutes = Math.floor(remaining / 60000);
		const seconds = Math.floor((remaining % 60000) / 1000);
		timerText.textContent = `${minutes
			.toString()
			.padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
	}

	async function analyzeTabsForTask(task) {
		analysisResults.style.display = "block";
		analysisResults.innerHTML =
			'<p class="loading">🔄 Analyzing tabs...</p>';

		try {
			const tabs = await chrome.tabs.query({});
			const tabData = tabs.map((tab) => ({
				title: tab.title,
				url: tab.url,
			}));

			// Call the LLM analyzer
			if (typeof analyzeTabs === "function") {
				const results = await analyzeTabs(task, tabData);
				displayAnalysisResults(results);
			} else {
				analysisResults.innerHTML =
					'<p class="error">LLM module not loaded. Please set up API key in extension settings.</p>';
			}
		} catch (error) {
			console.error("Error analyzing tabs:", error);
			analysisResults.innerHTML = `<p class="error">Error: ${error.message}</p>`;
		}
	}

	function displayAnalysisResults(results) {
		let html = '<div class="analysis-content">';
		html += `<p><strong>Task:</strong> ${results.task}</p>`;
		html += `<p><strong>Overall Relevance:</strong> ${results.overallRelevance}%</p>`;

		html += '<div class="tab-analysis">';
		results.tabs.forEach((tab) => {
			const relevanceClass =
				tab.relevance >= 70
					? "relevant"
					: tab.relevance >= 40
					? "partially-relevant"
					: "not-relevant";
			html += `
        <div class="tab-item ${relevanceClass}">
          <div class="tab-relevance">${tab.relevance}%</div>
          <div class="tab-details">
            <div class="tab-title">${tab.title}</div>
            <div class="tab-url">${tab.url}</div>
            <div class="tab-reason">${tab.reason}</div>
          </div>
        </div>
      `;
		});
		html += "</div>";

		html += `<div class="analysis-summary"><p>${results.summary}</p></div>`;
		html += "</div>";

		analysisResults.innerHTML = html;
	}

	// Display distraction warnings in popup
	function displayDistractions(distractingTabs) {
		if (!distractingTabs || distractingTabs.length === 0) {
			distractionWarnings.style.display = "none";
			distractingTabsList.innerHTML = "";
			return;
		}

		distractionWarnings.style.display = "block";
		distractionCount.textContent = distractingTabs.length;
		distractingTabsList.innerHTML = "";

		distractingTabs.forEach((tab) => {
			const tabItem = document.createElement("div");
			tabItem.className = "distracting-tab-item";

			// Relevance percentage badge
			const relevance = tab.relevance || 0;
			const relevanceColor =
				relevance > 60
					? "#ff6b6b"
					: relevance > 40
					? "#ffa500"
					: "#ff4444";

			const relevanceBadge = document.createElement("span");
			relevanceBadge.className = "relevance-badge";
			relevanceBadge.textContent = `${Math.round(relevance)}%`;
			relevanceBadge.style.backgroundColor = relevanceColor;

			// Tab title
			const tabTitle = document.createElement("span");
			tabTitle.className = "tab-title";
			tabTitle.textContent = tab.title || tab.url || "Unknown tab";
			tabTitle.title = tab.url;

			// Tab reason (why it's a distraction)
			const tabReason = document.createElement("div");
			tabReason.className = "tab-reason";
			tabReason.textContent = tab.reason || "Not relevant to your task";

			// Close button
			const closeBtn = document.createElement("button");
			closeBtn.className = "close-distraction-btn";
			closeBtn.textContent = "×";
			closeBtn.title = "Close this tab";
			closeBtn.onclick = (e) => {
				e.stopPropagation();
				chrome.runtime.sendMessage(
					{
						action: "closeDistractionTab",
						tabId: tab.id,
						tabUrl: tab.url,
					},
					() => {
						tabItem.style.opacity = "0.5";
						closeBtn.disabled = true;
					}
				);
			};

			tabItem.appendChild(relevanceBadge);
			tabItem.appendChild(tabTitle);
			tabItem.appendChild(closeBtn);
			tabItem.appendChild(tabReason);

			distractingTabsList.appendChild(tabItem);
		});
	}
});
