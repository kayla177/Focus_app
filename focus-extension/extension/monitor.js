/**
 * Focus Monitor - Distraction Detection using WebGazer (local)
 *
 * Simple on/off screen detection with optional face presence via WebGazer.
 */

class FocusMonitor {
	constructor() {
		// DOM Elements
		this.video = document.getElementById("webcam");
		this.pipVideo = document.getElementById("pipVideo");
		this.canvas = document.getElementById("overlay");
		this.ctx = this.canvas.getContext("2d");
		this.faceBox = document.getElementById("faceBox");
		this.alertOverlay = document.getElementById("alertOverlay");
		this.statusBadge = document.getElementById("statusBadge");
		this.calibrationOverlay = document.getElementById("calibrationOverlay");
		this.calibrationGrid = document.getElementById("calibrationGrid");
		this.calibrationInstructions = document.getElementById(
			"calibrationInstructions"
		);

		// Stat elements
		this.focusScoreEl = document.getElementById("focusScore");
		this.scoreProgress = document.getElementById("scoreProgress");
		this.attentionStatusEl = document.getElementById("attentionStatus");
		this.headPositionEl = document.getElementById("headPosition");
		this.faceDetectedEl = document.getElementById("faceDetected");
		this.confidenceEl = document.getElementById("confidence");
		this.sessionTimeEl = document.getElementById("sessionTime");
		this.focusedTimeEl = document.getElementById("focusedTime");
		this.distractedTimeEl = document.getElementById("distractedTime");
		this.distractionCountEl = document.getElementById("distractionCount");
		this.timeline = document.getElementById("timeline");

		// Buttons
		this.startBtn = document.getElementById("startBtn");
		this.stopBtn = document.getElementById("stopBtn");
		this.calibrateBtn = document.getElementById("calibrateBtn");
		this.pipBtn = document.getElementById("pipBtn");

		// WebGazer
		this.wgReady = false;

		// Debug
		const params = new URLSearchParams(location.search);
		this.debugEnabled =
			params.has("debug") ||
			localStorage.getItem("focusMonitorDebug") === "1";
		this.lastDebugLog = 0;

		// Settings
		this.alertDelay = 3;
		this.soundEnabled = true;
		this.sensitivity = "medium";

		// State
		this.isRunning = false;
		this.animationFrame = null;

		// Gaze smoothing
		this.gazeHistory = [];

		// Tracking metrics
		this.sessionStart = null;
		this.focusedMs = 0;
		this.distractedMs = 0;
		this.distractionCount = 0;
		this.lastUpdate = Date.now();
		this.currentState = "focused";
		this.stateStartTime = Date.now();
		this.distractedSince = null;
		this.isAlertShowing = false;
		this.currentFocusStretchStart = Date.now();
		this.longestFocusStretchMs = 0;

		// Calibration
		this.isCalibrating = false;
		this.isCalibrated = false;
		this.calibrationPoints = [];
		this.calibrationIndex = 0;
		this.calibrationSamples = 0;

		// Timeline data
		this.timelineData = [];
		this.lastTimelineUpdate = Date.now();

		// Audio
		this.alertSound = this.createAlertSound();

		// WebGazer presence/head checks
		this.facePresent = false;
		this.lastWgCheck = 0;
		this.lastFaceSeen = 0;
		this.faceGoneTimeout = 1200; // ms without face features => away

		// Head baseline (auto-calibrated)
		this.headBaseline = null;
		this.headBaselineFrames = [];
		this.isCapturingHeadBaseline = false;

		// Head delta calibration (captured when gaze calibration completes)
		this.calibratedHeadDelta = null;
		this.lastHeadMetrics = null;
		this.lastHeadDelta = null;

		// Minimize feature
		this.isMinimized = false;
		this.videoSection = document.getElementById("videoSection");
		this.miniIndicator = document.getElementById("miniIndicator");
		this.miniStatus = document.getElementById("miniStatus");
		this.miniExpandBtn = document.getElementById("miniExpandBtn");
		this.minimizeBtn = document.getElementById("minimizeBtn");

		this.init();
	}

	init() {
		// Event listeners
		this.startBtn.addEventListener("click", () => this.start());
		this.stopBtn.addEventListener("click", () => this.stop());
		this.calibrateBtn?.addEventListener("click", () =>
			this.startCalibration()
		);

		// Minimize/Expand handlers
		this.minimizeBtn?.addEventListener("click", () =>
			this.toggleMinimize()
		);
		this.miniExpandBtn?.addEventListener("click", () =>
			this.toggleMinimize()
		);

		// PiP Pop-out
		this.pipBtn?.addEventListener("click", async () => {
			if (document.pictureInPictureElement) {
				await document.exitPictureInPicture();
			} else if (this.pipVideo && this.pipVideo.readyState >= 1) {
				try {
					await this.pipVideo.requestPictureInPicture();
				} catch (e) {
					console.error("PiP failed", e);
				}
			}
		});

		document
			.getElementById("alertDelay")
			?.addEventListener("change", (e) => {
				this.alertDelay = parseInt(e.target.value) || 3;
			});
		document
			.getElementById("soundEnabled")
			?.addEventListener("change", (e) => {
				this.soundEnabled = e.target.checked;
			});
		document
			.getElementById("sensitivity")
			?.addEventListener("change", (e) => {
				this.sensitivity = e.target.value;
			});

		this.setStatus("Ready", "");
		console.log("[FocusMonitor] Initialized");
		if (this.debugEnabled) {
			console.log("[FocusMonitor][debug] Debug logging enabled");
			console.log(
				"[FocusMonitor][debug] Tip: toggle via localStorage.focusMonitorDebug='1' or add ?debug"
			);
		}
	}

	debugLog(payload) {
		if (!this.debugEnabled) return;
		const now = Date.now();
		if (now - this.lastDebugLog < 1000) return;
		this.lastDebugLog = now;
		try {
			console.log("[FocusMonitor][debug]", payload);
		} catch (e) {
			// ignore
		}
	}

	isCanvasMirrored() {
		if (!this.canvas) return false;
		const t = getComputedStyle(this.canvas).transform;
		if (!t || t === "none") return false;
		// Common for scaleX(-1): matrix(-1, 0, 0, 1, 0, 0)
		return t.startsWith("matrix(-1") || t.includes("matrix3d(-1");
	}

	createAlertSound() {
		let ctx = null;
		return {
			play: () => {
				if (!this.soundEnabled) return;
				try {
					if (!ctx)
						ctx = new (window.AudioContext ||
							window.webkitAudioContext)();
					const osc = ctx.createOscillator();
					const gain = ctx.createGain();
					osc.connect(gain);
					gain.connect(ctx.destination);
					osc.frequency.value = 440;
					osc.type = "sine";
					gain.gain.setValueAtTime(0.3, ctx.currentTime);
					gain.gain.exponentialRampToValueAtTime(
						0.01,
						ctx.currentTime + 0.5
					);
					osc.start(ctx.currentTime);
					osc.stop(ctx.currentTime + 0.5);
				} catch (e) {}
			},
		};
	}

	setStatus(text, type) {
		this.statusBadge.className = `status-badge ${type}`;
		this.statusBadge.innerHTML = `<span class="status-dot"></span><span class="status-text">${text}</span>`;
	}

	async start() {
		try {
			this.setStatus("Starting camera...", "warning");

			await this.ensureWebGazer();

			// Hide default video/feed elements from WebGazer
			this.hideWebGazerUI();

			// Reset state
			this.sessionStart = Date.now();
			this.focusedMs = 0;
			this.distractedMs = 0;
			this.distractionCount = 0;
			this.currentState = "focused";
			this.timelineData = [];
			this.gazeHistory = [];
			this.isCalibrated = false;

			this.isRunning = true;
			this.startBtn.disabled = true;
			this.stopBtn.disabled = false;
			this.calibrateBtn.disabled = false;
			if (this.pipBtn) this.pipBtn.disabled = false;
			if (this.minimizeBtn) this.minimizeBtn.disabled = false;

			// Start PiP stream
			if (this.canvas) {
				const stream = this.canvas.captureStream(30);
				if (this.pipVideo) {
					this.pipVideo.srcObject = stream;
				}
			}

			this.setStatus("Monitoring", "active");

			// Start detection loop
			this.lastUpdate = Date.now();
			this.detect();
			this.lastFaceSeen = Date.now();

			// Reset head baseline
			this.headBaseline = null;
			this.headBaselineFrames = [];
			this.isCapturingHeadBaseline = true;
			this.headBaselineStartTime = Date.now();
		} catch (err) {
			console.error("[FocusMonitor] Error:", err);
			this.setStatus("Camera error: " + err.message, "error");
		}
	}

	stop() {
		this.isRunning = false;

		if (this.animationFrame) {
			cancelAnimationFrame(this.animationFrame);
		}

		if (typeof webgazer !== "undefined") {
			webgazer.pause();
		}

		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		this.faceBox.style.display = "none";
		this.hideAlert();

		this.startBtn.disabled = false;
		this.stopBtn.disabled = true;
		this.calibrateBtn.disabled = false;
		if (this.pipBtn) this.pipBtn.disabled = true;
		if (this.minimizeBtn) this.minimizeBtn.disabled = true;

		// If minimized, restore to full view
		if (this.isMinimized) {
			this.toggleMinimize();
		}

		if (document.pictureInPictureElement) {
			document.exitPictureInPicture().catch(() => {});
		}

		this.setStatus("Stopped", "");
	}

	toggleMinimize() {
		this.isMinimized = !this.isMinimized;
		if (this.isMinimized) {
			this.videoSection?.classList.add("minimized");
			this.miniIndicator?.classList.add("visible");
		} else {
			this.videoSection?.classList.remove("minimized");
			this.miniIndicator?.classList.remove("visible");
		}
	}

	updateMiniIndicator(state) {
		if (!this.miniStatus) return;
		if (state === "focused") {
			this.miniStatus.classList.remove("distracted");
		} else {
			this.miniStatus.classList.add("distracted");
		}
	}

	detect() {
		if (!this.isRunning) return;

		// Primary: WebGazer internal tracker for face presence + head direction
		this.pollTracker();

		// Update stats
		this.updateStats();

		this.animationFrame = requestAnimationFrame(() => this.detect());
	}

	pollTracker() {
		if (typeof webgazer === "undefined") return;
		const now = Date.now();
		if (now - this.lastWgCheck < 80) return; // ~12fps polling
		this.lastWgCheck = now;

		const tracker = webgazer.getTracker?.();
		const positions = tracker?.getPositions?.();

		// 1. Draw webgazer camera feed onto the canvas (so it's in the stream)
		const feed = document.getElementById("webgazerVideoFeed");
		// Sync canvas size to feed if needed
		if (feed && feed.videoWidth) {
			if (this.canvas.width !== feed.videoWidth)
				this.canvas.width = feed.videoWidth;
			if (this.canvas.height !== feed.videoHeight)
				this.canvas.height = feed.videoHeight;

			// Draw frame mirrored horizontally to match user expectation
			this.ctx.save();
			this.ctx.translate(this.canvas.width, 0);
			this.ctx.scale(-1, 1);
			this.ctx.drawImage(
				feed,
				0,
				0,
				this.canvas.width,
				this.canvas.height
			);
			this.ctx.restore();
		} else {
			// Fallback clear
			this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		}

		// Debug logging...
		this.debugLog({
			hasWebgazer: typeof webgazer !== "undefined",
			hasTracker: !!tracker,
			hasGetPositions: !!tracker?.getPositions,
			positionsLen: Array.isArray(positions) ? positions.length : null,
			faceAgeMs: now - this.lastFaceSeen,
			isCapturingHeadBaseline: this.isCapturingHeadBaseline,
			isCalibrated: this.isCalibrated,
		});

		// (Removed separate clearRect/resize block - merged above with feed draw)

		// Check if positions array is valid and has actual landmark data
		const hasValidPositions =
			positions && Array.isArray(positions) && positions.length >= 15;
		// Also check that at least some landmarks have actual coordinates (not all null/false)
		const hasActualLandmarks =
			hasValidPositions &&
			positions.slice(0, 15).some((p) => p && typeof p[0] === "number");

		if (!hasActualLandmarks) {
			const debugInfo = {
				posLen: positions?.length ?? 0,
				hasData: hasActualLandmarks,
				ageMs: now - this.lastFaceSeen,
			};
			if (now - this.lastFaceSeen > this.faceGoneTimeout) {
				this.facePresent = false;
				this.setAttention("away", "Not visible");
				this.gazeHistory = [];
				if (this.headPositionEl) {
					this.headPositionEl.textContent = "Not visible";
					this.headPositionEl.style.color = "#ff6b6b";
				}
				if (this.faceDetectedEl) {
					this.faceDetectedEl.textContent = "No";
					this.faceDetectedEl.style.color = "#ff6b6b";
				}
				if (this.confidenceEl) {
					this.confidenceEl.textContent = "--";
				}
				this.drawHeadOverlay("Not visible", "#ff6b6b", debugInfo);
			} else {
				// Still within timeout, show waiting state
				this.drawHeadOverlay("Detecting...", "#fbbf24", debugInfo);
			}
			return;
		}

		// Face visible
		this.facePresent = true;
		this.lastFaceSeen = now;
		if (this.faceDetectedEl) {
			this.faceDetectedEl.textContent = "Yes";
			this.faceDetectedEl.style.color = "#4ade80";
		}

		// Compute head yaw metric from facial landmarks
		const headMetrics = this.computeHeadMetrics(positions);
		this.lastHeadMetrics = headMetrics;
		if (headMetrics && typeof headMetrics.asymmetry === "number") {
			const baseAsymNow = this.headBaseline?.asymmetry ?? 0;
			this.lastHeadDelta = headMetrics.asymmetry - baseAsymNow;
		} else {
			this.lastHeadDelta = null;
		}

		if (this.debugEnabled) {
			const sampleIdx = [0, 14, 33, 41, 47, 62];
			const sample = {};
			for (const idx of sampleIdx) {
				const p = positions[idx];
				if (p && typeof p[0] === "number" && typeof p[1] === "number") {
					sample[idx] = [Math.round(p[0]), Math.round(p[1])];
				}
			}
			this.debugLog({ headMetrics, samplePoints: sample });
		}
		if (this.isCapturingHeadBaseline) {
			if (headMetrics) {
				this.headBaselineFrames.push(headMetrics);
			}
			// Complete after 18 frames OR timeout after 3 seconds
			const baselineTimeout =
				this.headBaselineStartTime &&
				Date.now() - this.headBaselineStartTime > 3000;
			if (this.headBaselineFrames.length >= 18 || baselineTimeout) {
				if (this.headBaselineFrames.length > 0) {
					this.headBaseline = this.averageHeadBaseline(
						this.headBaselineFrames
					);
				} else {
					// No frames captured, use 0 as baseline
					this.headBaseline = { asymmetry: 0, ipd: 0 };
				}
				this.isCapturingHeadBaseline = false;
				console.log(
					"[FocusMonitor] Head baseline captured:",
					this.headBaseline,
					"frames:",
					this.headBaselineFrames.length
				);
			} else {
				if (this.headPositionEl) {
					this.headPositionEl.textContent = "Calibrating...";
					this.headPositionEl.style.color = "#fbbf24";
				}
				if (this.confidenceEl) {
					this.confidenceEl.textContent = "head-cal";
				}
				const calDebug = {
					frames: `${this.headBaselineFrames.length}/18`,
					asym: headMetrics?.asymmetry?.toFixed(3) ?? "null",
					L: headMetrics?.leftDist
						? Math.round(headMetrics.leftDist)
						: "?",
					R: headMetrics?.rightDist
						? Math.round(headMetrics.rightDist)
						: "?",
					metrics: headMetrics ? "yes" : "NO",
				};
				this.drawHeadOverlay(
					"Calibrating head...",
					"#fbbf24",
					calDebug
				);
				return;
			}
		}

		const head = this.classifyHeadDirection(headMetrics);

		const baselineDeltaForDisplay =
			typeof this.calibratedHeadDelta === "number" &&
			!isNaN(this.calibratedHeadDelta)
				? this.calibratedHeadDelta
				: head?.baselineDelta ?? null;

		// Build debug info for overlay (always show so user can see values)
		const debugOverlay = {
			asym: headMetrics?.asymmetry?.toFixed(3) ?? "null",
			base: this.headBaseline?.asymmetry?.toFixed(3) ?? "null",
			delta: head?.delta?.toFixed(3) ?? "null",
			bDelta:
				baselineDeltaForDisplay != null
					? Number(baselineDeltaForDisplay).toFixed(3)
					: "null",
			dChg:
				head?.deltaChange != null
					? Number(head.deltaChange).toFixed(3)
					: "null",
			thr: String(head?.threshold ?? "null"),
			cal: this.isCalibrated ? "Y" : "N",
			hasB:
				typeof this.calibratedHeadDelta === "number" &&
				!isNaN(this.calibratedHeadDelta)
					? "Y"
					: "N",
			fs: head?.facingScreen ? "Y" : "N",
			L: headMetrics?.leftDist ? Math.round(headMetrics.leftDist) : "?",
			R: headMetrics?.rightDist ? Math.round(headMetrics.rightDist) : "?",
		};

		if (this.debugEnabled) {
			this.debugLog({
				head,
				baselineAsym: this.headBaseline?.asymmetry?.toFixed(3) ?? null,
				currentAsym: headMetrics?.asymmetry?.toFixed(3) ?? null,
				delta: head?.delta?.toFixed(3) ?? null,
				threshold: head?.threshold ?? null,
				ipd: headMetrics?.ipd ? Math.round(headMetrics.ipd) : null,
				sensitivity: this.sensitivity,
			});
		}
		if (!head.facingScreen) {
			this.setAttention("distracted", head.direction);
			if (this.headPositionEl) {
				this.headPositionEl.textContent = head.direction;
				this.headPositionEl.style.color = "#ff6b6b";
			}
			if (this.confidenceEl) {
				this.confidenceEl.textContent = "head";
			}
			this.drawHeadOverlay(head.direction, "#ff6b6b", debugOverlay);
			return;
		}

		if (this.headPositionEl) {
			this.headPositionEl.textContent = "Facing screen";
			this.headPositionEl.style.color = "#4ade80";
		}
		this.drawHeadOverlay("Facing screen", "#4ade80", debugOverlay);

		// Secondary: use gaze point when available
		if (!this.isCalibrated) {
			// Avoid false "look at screen" calls before calibration.
			this.setAttention("focused", "Facing screen");
			if (this.confidenceEl) {
				this.confidenceEl.textContent = "head";
			}
			return;
		}

		const pred = webgazer.getCurrentPrediction();
		if (pred && typeof pred.x === "number" && typeof pred.y === "number") {
			this.gazeHistory.push({ x: pred.x, y: pred.y });
			if (this.gazeHistory.length > 10) this.gazeHistory.shift();
			this.debugLog({
				pred: { x: Math.round(pred.x), y: Math.round(pred.y) },
				gazeHistoryLen: this.gazeHistory.length,
			});
			this.analyzeGaze();
			if (this.confidenceEl) {
				this.confidenceEl.textContent = "gaze";
			}
		} else {
			// If gaze isn't ready but head is aligned, treat as focused.
			this.setAttention("focused", "Facing screen");
			if (this.confidenceEl) {
				this.confidenceEl.textContent = "face";
			}
		}
	}

	computeHeadMetrics(positions) {
		// Use eye-to-nose asymmetry: when facing forward, left-eye-to-nose ≈ right-eye-to-nose.
		// When turned, one side compresses. This is a face-internal ratio, more robust than absolute offsets.
		//
		// clmtrackr landmark indices (WebGazer uses clmtrackr internally):
		//   27: left eye inner corner, 32: left eye outer corner
		//   34: right eye inner corner, 29: right eye outer corner (indices vary; we pick centers)
		//   62: nose tip (fallback 33 or 41)
		//
		// We'll approximate eye centers from available landmarks.
		const leftEyeOuter = positions[23]; // outer corner left eye
		const leftEyeInner = positions[25]; // inner corner left eye
		const rightEyeInner = positions[30]; // inner corner right eye
		const rightEyeOuter = positions[28]; // outer corner right eye
		const nose = positions[62] || positions[41] || positions[37];

		if (
			!leftEyeOuter ||
			!leftEyeInner ||
			!rightEyeInner ||
			!rightEyeOuter ||
			!nose
		)
			return null;

		// Eye center approximations
		const leftEyeCenter = [
			(leftEyeOuter[0] + leftEyeInner[0]) / 2,
			(leftEyeOuter[1] + leftEyeInner[1]) / 2,
		];
		const rightEyeCenter = [
			(rightEyeOuter[0] + rightEyeInner[0]) / 2,
			(rightEyeOuter[1] + rightEyeInner[1]) / 2,
		];

		const leftDist = this.distance(leftEyeCenter, nose);
		const rightDist = this.distance(rightEyeCenter, nose);
		const sumDist = leftDist + rightDist;
		if (sumDist < 1) return null;

		// Asymmetry: positive when right side is farther (turned left), negative when left side is farther (turned right)
		const asymmetry = (rightDist - leftDist) / sumDist;

		// Also track inter-pupillary distance for sanity / debug
		const ipd = this.distance(leftEyeCenter, rightEyeCenter);

		return { asymmetry, ipd, leftDist, rightDist };
	}

	averageHeadBaseline(frames) {
		const vals = frames
			.map((f) => f.asymmetry)
			.filter((v) => typeof v === "number" && !isNaN(v));
		const avg = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
		// Also average IPD for reference
		const ipdVals = frames
			.map((f) => f.ipd)
			.filter((v) => typeof v === "number" && !isNaN(v));
		const avgIpd =
			ipdVals.reduce((a, b) => a + b, 0) / Math.max(1, ipdVals.length);
		return { asymmetry: avg, ipd: avgIpd };
	}

	classifyHeadDirection(metrics) {
		const threshold = 0.01;
		const hasBaselineDelta =
			typeof this.calibratedHeadDelta === "number" &&
			!isNaN(this.calibratedHeadDelta);
		const baselineDelta = hasBaselineDelta ? this.calibratedHeadDelta : 0;

		// If we can't compute metrics this frame, still return the baseline info for UI/debug.
		if (!metrics) {
			return {
				facingScreen: true,
				direction: "Centered",
				delta: null,
				asym: null,
				threshold: `±${threshold.toFixed(3)}`,
				baselineDelta,
				deltaChange: null,
			};
		}

		const asym = metrics.asymmetry;
		const baseAsym = this.headBaseline?.asymmetry ?? 0;
		const delta = asym - baseAsym;
		const deltaChange = delta - baselineDelta;

		// Round to 3 decimals for display and comparison (matches HUD)
		const deltaRounded = Math.round(delta * 1000) / 1000;
		const baselineDeltaRounded = Math.round(baselineDelta * 1000) / 1000;
		const deltaChangeRounded = deltaRounded - baselineDeltaRounded;

		// Asymmetric thresholds: left turns (positive deltaChange) need lower threshold
		const thresholdLeft = 0.001; // more sensitive for left turns
		const thresholdRight = 0.008; // keep right as-is

		// HARDCODED: check against asymmetric thresholds
		const notFocused =
			deltaChangeRounded >= thresholdLeft ||
			deltaChangeRounded <= -thresholdRight;

		if (notFocused) {
			return {
				facingScreen: false,
				direction: "Not focused",
				delta: deltaRounded,
				asym,
				threshold: `L:${thresholdLeft}/R:${thresholdRight}`,
				baselineDelta: baselineDeltaRounded,
				deltaChange: deltaChangeRounded,
			};
		}

		return {
			facingScreen: true,
			direction: "Centered",
			delta: deltaRounded,
			asym,
			threshold: `L:${thresholdLeft}/R:${thresholdRight}`,
			baselineDelta: baselineDeltaRounded,
			deltaChange: deltaChangeRounded,
		};
	}

	drawHeadOverlay(text, color, debugInfo = null) {
		if (!this.ctx) return;
		this.ctx.save();
		// The canvas element is CSS-mirrored (scaleX(-1)) to match the mirrored webcam.
		// Flip the drawing back so text reads normally.
		if (this.isCanvasMirrored()) {
			this.ctx.translate(this.canvas.width, 0);
			this.ctx.scale(-1, 1);
		}

		// Main status box
		this.ctx.fillStyle = "rgba(0,0,0,0.6)";
		const boxHeight = debugInfo ? 110 : 40;
		this.ctx.fillRect(10, 10, 280, boxHeight);
		this.ctx.fillStyle = color;
		this.ctx.font =
			"600 16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
		this.ctx.fillText(`Head: ${text}`, 20, 36);

		// Debug values if available
		if (debugInfo) {
			this.ctx.fillStyle = "#fff";
			this.ctx.font = "12px monospace";
			let y = 54;
			for (const [key, val] of Object.entries(debugInfo)) {
				this.ctx.fillText(`${key}: ${val}`, 20, y);
				y += 14;
			}
		}
		this.ctx.restore();
	}

	distance(p1, p2) {
		return Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
	}

	setAttention(state, reason) {
		const now = Date.now();

		// Update time tracking
		const elapsed = now - this.lastUpdate;
		if (this.currentState === "focused") {
			this.focusedMs += elapsed;
		} else {
			this.distractedMs += elapsed;
		}
		this.lastUpdate = now;

		// State change
		if (state !== this.currentState) {
			if (state === "distracted" || state === "away") {
				this.distractionCount++;
				this.distractedSince = now;
				// Calculate current focus stretch and update longest if needed
				if (
					this.currentState === "focused" &&
					this.currentFocusStretchStart
				) {
					const currentStretch = now - this.currentFocusStretchStart;
					if (currentStretch > this.longestFocusStretchMs) {
						this.longestFocusStretchMs = currentStretch;
					}
				}
			} else {
				this.distractedSince = null;
				this.hideAlert();
				// Start new focus stretch
				this.currentFocusStretchStart = now;
			}
			this.currentState = state;
		}

		// Check if should show alert
		if (
			(state === "distracted" || state === "away") &&
			this.distractedSince
		) {
			const distractedFor = (now - this.distractedSince) / 1000;
			if (distractedFor >= this.alertDelay && !this.isAlertShowing) {
				this.showAlert();
			}
		}

		// Update status display
		if (this.attentionStatusEl) {
			this.attentionStatusEl.textContent =
				state === "focused" ? "✓ Focused" : "✗ Distracted";
			this.attentionStatusEl.style.color =
				state === "focused" ? "#4ade80" : "#ff6b6b";
		}

		// Update mini indicator (for minimized view)
		this.updateMiniIndicator(state);

		// Update face box color
		this.faceBox.className = `face-box ${state}`;

		// Timeline
		if (now - this.lastTimelineUpdate > 1000) {
			this.timelineData.push(state);
			if (this.timelineData.length > 60) this.timelineData.shift();
			this.renderTimeline();
			this.lastTimelineUpdate = now;
		}
	}

	updateFaceBoxDummy(show) {
		this.faceBox.style.display = show ? "block" : "none";
		if (show) {
			this.faceBox.style.left = "20%";
			this.faceBox.style.top = "20%";
			this.faceBox.style.width = "60%";
			this.faceBox.style.height = "60%";
		}
	}

	updateUI(metrics, score, faceDetected) {
		if (this.faceDetectedEl) {
			this.faceDetectedEl.textContent = faceDetected ? "Yes" : "No";
			this.faceDetectedEl.style.color = faceDetected
				? "#4ade80"
				: "#ff6b6b";
		}

		if (this.confidenceEl) {
			this.confidenceEl.textContent = faceDetected
				? `${Math.round(score * 100)}%`
				: "--";
		}
	}

	updateStats() {
		const now = Date.now();
		const sessionMs = now - this.sessionStart;

		// Session time
		if (this.sessionTimeEl) {
			this.sessionTimeEl.textContent = this.formatTime(sessionMs);
		}

		// Focused/distracted time
		if (this.focusedTimeEl) {
			this.focusedTimeEl.textContent = this.formatTime(this.focusedMs);
		}
		if (this.distractedTimeEl) {
			this.distractedTimeEl.textContent = this.formatTime(
				this.distractedMs
			);
		}

		// Distraction count
		if (this.distractionCountEl) {
			this.distractionCountEl.textContent = this.distractionCount;
		}

		// Focus score
		const totalTracked = this.focusedMs + this.distractedMs;
		const score =
			totalTracked > 0
				? Math.round((this.focusedMs / totalTracked) * 100)
				: 100;

		if (this.focusScoreEl) {
			this.focusScoreEl.textContent = score;
		}

		if (this.scoreProgress) {
			const circumference = 2 * Math.PI * 45;
			const offset = circumference - (score / 100) * circumference;
			this.scoreProgress.style.strokeDasharray = circumference;
			this.scoreProgress.style.strokeDashoffset = offset;
		}

		// Check if current focus stretch is the longest
		if (this.currentState === "focused" && this.currentFocusStretchStart) {
			const currentStretch = now - this.currentFocusStretchStart;
			if (currentStretch > this.longestFocusStretchMs) {
				this.longestFocusStretchMs = currentStretch;
			}
		}

		// Save focus stats to storage for popup to access
		if (chrome?.storage?.local) {
			chrome.storage.local.set({
				facialFocusScore: score,
				facialLongestStretchMs: this.longestFocusStretchMs,
				facialDistractionCount: this.distractionCount,
			});
		}
	}

	renderTimeline() {
		if (!this.timeline) return;
		this.timeline.innerHTML = this.timelineData
			.map((state) => `<div class="timeline-segment ${state}"></div>`)
			.join("");
	}

	showAlert() {
		this.isAlertShowing = true;
		if (this.alertOverlay) {
			this.alertOverlay.style.display = "flex";
		}
		this.alertSound.play();
		this.setStatus("Distracted!", "error");

		// Send notification via background script for alerts even when tab not focused
		if (chrome?.runtime?.sendMessage) {
			chrome.runtime
				.sendMessage({
					type: "FOCUS_ALERT",
					title: "Focus Alert!",
					message: "You seem distracted. Get back on track!",
				})
				.catch(() => {}); // Ignore errors if background not ready
		}
	}

	hideAlert() {
		this.isAlertShowing = false;
		if (this.alertOverlay) {
			this.alertOverlay.style.display = "none";
		}
		if (this.isRunning) {
			this.setStatus("Monitoring", "active");
		}
	}

	formatTime(ms) {
		const secs = Math.floor(ms / 1000);
		const mins = Math.floor(secs / 60);
		const remSecs = secs % 60;
		return `${mins}:${remSecs.toString().padStart(2, "0")}`;
	}
	hideWebGazerUI() {
		// Keep gaze dot visible; hide the preview video/overlays
		const ids = [
			"webgazerVideoFeed",
			"webgazerFaceOverlay",
			"webgazerFaceFeedbackBox",
		];
		ids.forEach((id) => {
			const el = document.getElementById(id);
			if (el) el.style.display = "none";
		});
	}

	async ensureWebGazer() {
		return new Promise((resolve, reject) => {
			if (typeof webgazer === "undefined") {
				reject(new Error("WebGazer not loaded"));
				return;
			}
			webgazer.setGazeListener((data, timestamp) => {
				if (!this.isRunning) return;
				if (data) {
					// we consume predictions via getCurrentPrediction in the main loop
				}
			});
			webgazer.showFaceFeedbackBox(false);
			webgazer.showPredictionPoints(true); // Keep gaze dot visible
			// Disable mouse-based learning - we only want eye tracking
			webgazer.removeMouseEventListeners();
			webgazer
				.begin()
				.then(() => {
					this.wgReady = true;
					// Note: we don't mirror to this.video anymore, we draw to canvas.
					// But ensure feed is playing.
					const feed = document.getElementById("webgazerVideoFeed");
					if (feed) {
						feed.play().catch(() => {});
					}
					this.setStatus("Monitoring", "active");
					console.log("[FocusMonitor] WebGazer started");
					resolve();
				})
				.catch(reject);
		});
	}

	analyzeGaze() {
		if (!this.gazeHistory.length) return;
		const avgX =
			this.gazeHistory.reduce((s, p) => s + p.x, 0) /
			this.gazeHistory.length;
		const avgY =
			this.gazeHistory.reduce((s, p) => s + p.y, 0) /
			this.gazeHistory.length;

		// Screen bounds with margin based on sensitivity
		const margin =
			this.sensitivity === "high"
				? 0.05
				: this.sensitivity === "low"
				? 0.2
				: 0.12;
		const minX = -window.innerWidth * margin;
		const maxX = window.innerWidth * (1 + margin);
		const minY = -window.innerHeight * margin;
		const maxY = window.innerHeight * (1 + margin);

		const onScreen =
			avgX >= minX && avgX <= maxX && avgY >= minY && avgY <= maxY;

		if (onScreen) {
			this.setAttention("focused", "On screen");
			this.updateFaceBoxDummy(true);
		} else {
			let dir = "Off Screen";
			if (avgX < minX) dir = "← Left";
			else if (avgX > maxX) dir = "→ Right";
			else if (avgY < minY) dir = "↑ Up";
			else if (avgY > maxY) dir = "↓ Down";
			this.setAttention("distracted", dir);
			this.updateFaceBoxDummy(false);
		}
	}

	startCalibration() {
		if (!this.isRunning || !this.wgReady) {
			this.setStatus("Start monitoring first", "warning");
			return;
		}
		// Re-enable mouse for calibration clicks
		if (typeof webgazer !== "undefined") {
			webgazer.addMouseEventListeners();
		}
		this.isCalibrating = true;
		this.isCalibrated = false;
		this.calibrationSamples = 0;
		this.calibrationIndex = 0;
		this.buildCalibrationPoints();
		this.showCalibrationOverlay(true);
		this.activateCalibrationPoint(0);
		this.setStatus("Calibrating...", "warning");
	}

	buildCalibrationPoints() {
		this.calibrationPoints = [];
		if (!this.calibrationGrid) return;
		this.calibrationGrid.innerHTML = "";
		const positions = [
			[10, 10],
			[50, 10],
			[90, 10],
			[10, 50],
			[50, 50],
			[90, 50],
			[10, 90],
			[50, 90],
			[90, 90],
		];
		positions.forEach(([x, y], idx) => {
			const dot = document.createElement("div");
			dot.className = "calibration-point";
			dot.style.left = `${x}%`;
			dot.style.top = `${y}%`;
			dot.addEventListener("click", () =>
				this.handleCalibrationClick(idx)
			);
			this.calibrationGrid.appendChild(dot);
			this.calibrationPoints.push(dot);
		});
	}

	handleCalibrationClick(idx) {
		if (!this.isCalibrating) return;
		if (idx !== this.calibrationIndex) return;
		const dot = this.calibrationPoints[idx];
		const rect = dot.getBoundingClientRect();
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;
		// Record gaze sample tied to this point
		try {
			webgazer.recordScreenPosition(x, y, "click");
		} catch (e) {
			console.warn("Calibration record failed", e);
		}
		this.calibrationSamples++;
		dot.classList.remove("active");
		dot.style.opacity = 0.4;
		this.calibrationIndex++;
		if (this.calibrationIndex >= this.calibrationPoints.length) {
			this.finishCalibration();
		} else {
			this.activateCalibrationPoint(this.calibrationIndex);
		}
	}

	activateCalibrationPoint(idx) {
		this.calibrationPoints.forEach((p, i) => {
			p.classList.toggle("active", i === idx);
			p.style.opacity = i === idx ? 1 : 0.6;
		});
	}

	finishCalibration() {
		this.isCalibrating = false;
		this.isCalibrated = true;
		this.showCalibrationOverlay(false);
		// Disable mouse learning again after calibration
		if (typeof webgazer !== "undefined") {
			webgazer.removeMouseEventListeners();
		}

		// Capture the current head delta as the calibration baseline.
		// This lets us detect changes relative to the user's calibrated/neutral posture.
		if (
			typeof this.lastHeadDelta === "number" &&
			!isNaN(this.lastHeadDelta)
		) {
			this.calibratedHeadDelta = this.lastHeadDelta;
		} else {
			this.calibratedHeadDelta = 0;
		}
		this.setStatus("Monitoring (calibrated)", "active");
		console.log(
			"[FocusMonitor] Calibration samples:",
			this.calibrationSamples,
			"calibratedHeadDelta:",
			this.calibratedHeadDelta
		);
	}

	showCalibrationOverlay(show) {
		if (!this.calibrationOverlay) return;
		this.calibrationOverlay.style.display = show ? "flex" : "none";
	}
}

// Initialize when DOM ready
document.addEventListener("DOMContentLoaded", () => {
	window.focusMonitor = new FocusMonitor();
});
