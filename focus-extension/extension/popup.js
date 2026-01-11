// State management
let currentView = "setup";
let sessionGoal = "";
let sessionDuration = 25;
let timeRemaining = 0;
let timerInterval = null;
let isOnBreak = false;

// DOM elements
const setupView = document.getElementById("setupView");
const activeView = document.getElementById("activeView");
const summaryView = document.getElementById("summaryView");
const goalInput = document.getElementById("goalInput");
const durationSlider = document.getElementById("durationSlider");
const durationValue = document.getElementById("durationValue");
const startBtn = document.getElementById("startBtn");
const presetBtns = document.querySelectorAll(".preset-btn");
const blockedInput = document.getElementById("blockedInput");

// Initialize
document.addEventListener("DOMContentLoaded", () => {
	loadState();
	setupEventListeners();
});

function setupEventListeners() {
	// Goal input
	goalInput.addEventListener("input", () => {
		startBtn.disabled = !goalInput.value.trim();
	});

	// Duration slider
	durationSlider.addEventListener("input", () => {
		const value = durationSlider.value;
		durationValue.textContent = `${value} minutes`;
		sessionDuration = parseInt(value);
		updatePresetButtons();
	});

	// Preset buttons
	presetBtns.forEach((btn) => {
		btn.addEventListener("click", () => {
			const duration = parseInt(btn.dataset.duration);
			durationSlider.value = duration;
			sessionDuration = duration;
			durationValue.textContent = `${duration} minutes`;
			updatePresetButtons();
		});
	});

	// Start button
	startBtn.addEventListener("click", startSession);

	// Pause button
	document.getElementById("pauseBtn").addEventListener("click", pauseSession);

	// Focus Monitor button
	document.getElementById("monitorBtn")?.addEventListener("click", () => {
		chrome.tabs.create({ url: chrome.runtime.getURL("monitor.html") });
	});

	// Mini Monitor button - opens small popup window
	document.getElementById("miniMonitorBtn")?.addEventListener("click", () => {
		const width = 140;
		const height = 100;
		const left = screen.width - width - 20;
		const top = 80;
		chrome.windows.create({
			url: chrome.runtime.getURL("mini-monitor.html"),
			type: "popup",
			width: width,
			height: height,
			left: left,
			top: top,
			focused: false,
		});
	});

	// End break button
	document.getElementById("endBreakBtn")?.addEventListener("click", endBreak);

	// New session button
	document
		.getElementById("newSessionBtn")
		.addEventListener("click", resetToSetup);

	// Listen for break end message from background
	chrome.runtime.onMessage.addListener((request) => {
		if (request.action === "breakEnded") {
			endBreak();
		} else if (request.action === "takeBreak") {
			startBreak();
		}
	});
}

function updatePresetButtons() {
	presetBtns.forEach((btn) => {
		const duration = parseInt(btn.dataset.duration);
		btn.classList.toggle("active", duration === sessionDuration);
	});
}

function normalizeBlockedEntry(entry) {
	let s = (entry || "").trim();
	if (!s) return null;

	// allow "*.domain.com"
	s = s.replace(/^https?:\/\//, "");
	s = s.replace(/^www\./, "");
	s = s.split("/")[0]; // drop path
	s = s.split("?")[0]; // drop query

	if (s.startsWith("*.")) s = s.slice(2); // store wildcard as base domain
	return s || null;
}

function parseBlockedSites(text) {
	return (text || "")
		.split(/\n|,|;/g)
		.map(normalizeBlockedEntry)
		.filter(Boolean);
}

function startSession() {
	sessionGoal = goalInput.value.trim();
	timeRemaining = sessionDuration * 60;
	isOnBreak = false;

	const blockedListText = (blockedInput?.value || "").trim();
	const blockedSites = parseBlockedSites(blockedListText);

	// Save state (store the raw text so we can re-populate the textarea)
	chrome.storage.local.set({
		isActive: true,
		goal: sessionGoal,
		duration: sessionDuration,
		startTime: Date.now(),
		endTime: Date.now() + sessionDuration * 60 * 1000,
		blockedSites, // normalized array
		blockedListText, // raw textarea value
	});

	// Send message to background script
	chrome.runtime.sendMessage({
		action: "startSession",
		goal: sessionGoal,
		duration: sessionDuration,
		blockedSites,
	});

	switchView("active");
	startTimer();
}

function startTimer() {
	document.getElementById("activeGoal").textContent = sessionGoal;
	updateTimerDisplay();

	if (timerInterval !== null) clearInterval(timerInterval);

	timerInterval = setInterval(() => {
		timeRemaining--;
		updateTimerDisplay();

		if (timeRemaining <= 0) {
			completeSession();
		}
	}, 1000);
}

function pauseTimer() {
	if (timerInterval !== null) {
		clearInterval(timerInterval);
		timerInterval = null;
	}
}

function resumeTimer() {
	if (timerInterval === null) {
		timerInterval = setInterval(() => {
			timeRemaining--;
			updateTimerDisplay();

			if (timeRemaining <= 0) {
				completeSession();
			}
		}, 1000);
	}
}

function updateTimerDisplay() {
	const mins = Math.floor(timeRemaining / 60);
	const secs = timeRemaining % 60;
	document.getElementById("timeDisplay").textContent = `${mins}:${secs
		.toString()
		.padStart(2, "0")}`;

	// Update progress circle
	const progress =
		((sessionDuration * 60 - timeRemaining) / (sessionDuration * 60)) * 565;
	document.getElementById("timerProgress").style.strokeDashoffset =
		565 - progress;
}

function pauseSession() {
	// Check if this is being called due to a break (from blocked page)
	// If so, pause the timer instead of ending the session
	if (isOnBreak) {
		pauseTimer();
	} else {
		clearInterval(timerInterval);
		completeSession();
	}
}

function completeSession() {
	if (timerInterval) clearInterval(timerInterval);

	chrome.storage.local.set({ isActive: false });
	chrome.runtime.sendMessage({ action: "endSession" }, (stats) => {
		// Stats come back from background.js
		const alerts = stats?.monitorAlertCount || 0;
		const longestStreakMs = stats?.longestFocusStreakMs || 0;

		// Calculate actual session time (how long they actually ran it)
		chrome.storage.local.get(["startTime"], (storage) => {
			const actualSessionMs = Date.now() - (storage.startTime || Date.now());
			const actualSessionMinutes = actualSessionMs / 60000;
			console.log(`Actual session time: ${actualSessionMinutes.toFixed(2)} minutes`);

			// Format streak
			const minutes = Math.floor(longestStreakMs / 60000);
			const seconds = Math.floor((longestStreakMs % 60000) / 1000);
			const streakText =
				minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

			// Populate Summary
			document.getElementById("summaryGoal").textContent = sessionGoal;

			// Get focus score from facial monitor (real tracked time)
			chrome.storage.local.get(
				["facialFocusScore", "facialFocusedMs", "facialDistractedMs", "facialDistractionCount", "facialLongestStretchMs"],
				(data) => {
					console.log("Focus data from storage:", data);
					
					// Use monitor distraction count if available, otherwise use alerts
					const totalDistractions = data.facialDistractionCount ?? alerts;
					console.log(`Distractions: ${totalDistractions}, Actual session: ${actualSessionMinutes.toFixed(2)} min`);
					
					// Calculate distraction rate (distractions per minute) using ACTUAL session time
					const distractionRate = totalDistractions / actualSessionMinutes;
					console.log(`Distraction rate: ${distractionRate.toFixed(2)} per minute`);
					
					// Scoring logic: More distractions in less time = worse score
					// Start at 100, subtract penalty based on distraction rate
					// 0 distractions = 100%
					// 1 distraction per 25 min = ~96%
					// 1 distraction per 5 min = ~80%
					// 2 distractions per 1 min = ~40%
					let focusScore;
					if (totalDistractions === 0) {
						focusScore = 100;
					} else {
						// Each distraction per minute costs you 30 points
						// Examples:
						// - 1 distraction in 25 min = 0.04 rate → 100 - (0.04 * 30) = 98.8%
						// - 2 distractions in 1 min = 2.0 rate → 100 - (2.0 * 30) = 40%
						// - 1 distraction in 1 min = 1.0 rate → 100 - (1.0 * 30) = 70%
						const penalty = distractionRate * 30;
						focusScore = Math.max(0, 100 - penalty);
					}
					
					console.log(`Final focus score: ${focusScore.toFixed(1)}%`);
				
				const clampedScore = Math.max(
					0,
					Math.min(100, Math.round(focusScore))
				);
				document.getElementById(
					"focusScore"
				).textContent = `${clampedScore}%`;
				const focusProgress = document.getElementById("focusProgress");
				if (focusProgress)
					focusProgress.style.width = `${clampedScore}%`;

				// Longest Stretch - prefer facial monitor data if available
				let finalStreakText = streakText;
				if (
					data.facialLongestStretchMs &&
					data.facialLongestStretchMs > longestStreakMs
				) {
					const mins = Math.floor(
						data.facialLongestStretchMs / 60000
					);
					const secs = Math.floor(
						(data.facialLongestStretchMs % 60000) / 1000
					);
					finalStreakText =
						mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
				}
				document.getElementById("longestStretch").textContent =
					finalStreakText;

					// Distractions (Beeps)
					document.getElementById("distractionCount").textContent =
						alerts;

					switchView("summary");
				}
			);
		});
	});
}

function startBreak() {
	isOnBreak = true;
	pauseTimer();
	showBreakView(5 * 60); // 5 minutes
}

function endBreak() {
	isOnBreak = false;
	if (window.breakInterval) {
		clearInterval(window.breakInterval);
		window.breakInterval = null;
	}

	// Send resume message to background
	chrome.runtime.sendMessage({ action: "resumeSession" });

	// Switch back to active view and resume timer
	switchView("active");
	resumeTimer();
}

function resetToSetup() {
	goalInput.value = "";
	startBtn.disabled = true;
	timeRemaining = 0;
	switchView("setup");
}

function switchView(view) {
	setupView.style.display = view === "setup" ? "block" : "none";
	activeView.style.display = view === "active" ? "block" : "none";
	document.getElementById("breakView").style.display =
		view === "break" ? "block" : "none";
	summaryView.style.display = view === "summary" ? "block" : "none";
	currentView = view;
}

function loadState() {
	chrome.storage.local.get(
		[
			"isActive",
			"goal",
			"duration",
			"endTime",
			"blockedListText",
			"isOnBreak",
			"breakEndTime",
		],
		(data) => {
			if (blockedInput) {
				blockedInput.value = data.blockedListText || "";
			}

			if (data.isActive && data.endTime > Date.now()) {
				sessionGoal = data.goal;
				sessionDuration = data.duration;
				timeRemaining = Math.floor((data.endTime - Date.now()) / 1000);

				// Check if we're on a break
				if (data.isOnBreak && data.breakEndTime > Date.now()) {
					isOnBreak = true;
					// Calculate remaining break time
					const breakTimeRemaining = Math.floor(
						(data.breakEndTime - Date.now()) / 1000
					);
					showBreakView(breakTimeRemaining);
				} else {
					switchView("active");
					startTimer();
				}
			}
		}
	);
}

function showBreakView(breakTimeRemaining) {
	const breakTimerDisplay = document.getElementById("breakTimerDisplay");
	switchView("break");

	// Update display immediately
	const mins = Math.floor(breakTimeRemaining / 60);
	const secs = breakTimeRemaining % 60;
	breakTimerDisplay.textContent = `${mins}:${secs
		.toString()
		.padStart(2, "0")}`;

	const breakInterval = setInterval(() => {
		breakTimeRemaining--;
		const mins = Math.floor(breakTimeRemaining / 60);
		const secs = breakTimeRemaining % 60;
		breakTimerDisplay.textContent = `${mins}:${secs
			.toString()
			.padStart(2, "0")}`;

		if (breakTimeRemaining <= 0) {
			clearInterval(breakInterval);
			endBreak();
		}
	}, 1000);

	// Store interval ID for cleanup
	window.breakInterval = breakInterval;
}
