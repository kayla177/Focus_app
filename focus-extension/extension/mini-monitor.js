/**
 * Mini Focus Monitor - Tiny popup window for background tracking
 */

class MiniMonitor {
  constructor() {
    this.statusDot = document.getElementById('statusDot');
    this.statusLabel = document.getElementById('statusLabel');
    this.canvas = document.getElementById('trackingCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.closeBtn = document.getElementById('closeBtn');
    
    this.isRunning = false;
    this.wgReady = false;
    this.lastWgCheck = 0;
    this.lastFaceSeen = 0;
    this.faceGoneTimeout = 1200;
    
    // Head tracking
    this.headBaseline = null;
    this.headBaselineFrames = [];
    this.isCapturingHeadBaseline = false;
    this.headBaselineStartTime = null;
    this.calibratedHeadDelta = null;
    this.lastHeadDelta = null;
    
    // Alert
    this.currentState = 'focused';
    this.distractedSince = null;
    this.alertDelay = 3;
    this.isAlertShowing = false;
    this.alertSound = this.createAlertSound();
    
    this.init();
  }
  
  async init() {
    // Close button - stops monitoring and closes window
    this.closeBtn?.addEventListener('click', () => {
      this.stop();
      window.close();
    });
    
    this.setStatus('loading', 'Starting...');
    try {
      await this.startTracking();
    } catch (err) {
      console.error('Mini monitor error:', err);
      this.setStatus('away', 'Error');
    }
  }
  
  stop() {
    this.isRunning = false;
    if (typeof webgazer !== 'undefined') {
      try { webgazer.pause(); } catch(e) {}
    }
  }
  
  createAlertSound() {
    let ctx = null;
    return {
      play: () => {
        try {
          if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 440;
          osc.type = 'sine';
          gain.gain.setValueAtTime(0.3, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.5);
        } catch (e) {}
      }
    };
  }
  
  setStatus(state, label) {
    this.statusDot.className = 'status-dot ' + state;
    this.statusLabel.textContent = label;
  }
  
  async startTracking() {
    if (typeof webgazer === 'undefined') {
      throw new Error('WebGazer not loaded');
    }
    
    await webgazer
      .setRegression('ridge')
      .setGazeListener(() => {})
      .showVideoPreview(false)
      .showPredictionPoints(false)
      .showFaceOverlay(false)
      .showFaceFeedbackBox(false)
      .begin();
    
    // Disable mouse learning
    webgazer.removeMouseEventListeners();
    
    // Hide any webgazer UI
    const wgElements = ['webgazerVideoFeed', 'webgazerVideoCanvas', 'webgazerFaceOverlay', 'webgazerFaceFeedbackBox', 'webgazerGazeDot'];
    wgElements.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    
    this.wgReady = true;
    this.isRunning = true;
    this.lastFaceSeen = Date.now();
    
    // Start baseline capture
    this.headBaseline = null;
    this.headBaselineFrames = [];
    this.isCapturingHeadBaseline = true;
    this.headBaselineStartTime = Date.now();
    
    this.setStatus('loading', 'Calibrating...');
    this.detect();
  }
  
  detect() {
    if (!this.isRunning) return;
    this.pollTracker();
    requestAnimationFrame(() => this.detect());
  }
  
  pollTracker() {
    if (typeof webgazer === 'undefined') return;
    const now = Date.now();
    if (now - this.lastWgCheck < 80) return;
    this.lastWgCheck = now;
    
    const tracker = webgazer.getTracker?.();
    const positions = tracker?.getPositions?.();
    
    const hasValidPositions = positions && Array.isArray(positions) && positions.length >= 15;
    const hasActualLandmarks = hasValidPositions && positions.slice(0, 15).some(p => p && typeof p[0] === 'number');
    
    if (!hasActualLandmarks) {
      if (now - this.lastFaceSeen > this.faceGoneTimeout) {
        this.handleState('away', 'Not visible');
      }
      return;
    }
    
    this.lastFaceSeen = now;
    
    const headMetrics = this.computeHeadMetrics(positions);
    
    // Baseline capture
    if (this.isCapturingHeadBaseline) {
      if (headMetrics) {
        this.headBaselineFrames.push(headMetrics);
      }
      const timeout = this.headBaselineStartTime && (now - this.headBaselineStartTime > 3000);
      if (this.headBaselineFrames.length >= 18 || timeout) {
        if (this.headBaselineFrames.length > 0) {
          this.headBaseline = this.averageHeadBaseline(this.headBaselineFrames);
          this.calibratedHeadDelta = 0; // Since baseline IS the average, delta should be 0
        } else {
          this.headBaseline = { asymmetry: 0, ipd: 0 };
          this.calibratedHeadDelta = 0;
        }
        this.isCapturingHeadBaseline = false;
        console.log('[MiniMonitor] Baseline captured:', this.headBaseline);
      } else {
        return; // Still calibrating
      }
    }
    
    const head = this.classifyHeadDirection(headMetrics);
    
    if (!head.facingScreen) {
      this.handleState('distracted', 'Not focused');
    } else {
      this.handleState('focused', 'Focused');
    }
  }
  
  computeHeadMetrics(positions) {
    const leftEyeOuter = positions[23];
    const leftEyeInner = positions[25];
    const rightEyeInner = positions[30];
    const rightEyeOuter = positions[28];
    const nose = positions[62] || positions[41] || positions[37];
    
    if (!leftEyeOuter || !leftEyeInner || !rightEyeInner || !rightEyeOuter || !nose) return null;
    
    const leftEyeCenter = [(leftEyeOuter[0] + leftEyeInner[0]) / 2, (leftEyeOuter[1] + leftEyeInner[1]) / 2];
    const rightEyeCenter = [(rightEyeOuter[0] + rightEyeInner[0]) / 2, (rightEyeOuter[1] + rightEyeInner[1]) / 2];
    
    const leftDist = Math.hypot(leftEyeCenter[0] - nose[0], leftEyeCenter[1] - nose[1]);
    const rightDist = Math.hypot(rightEyeCenter[0] - nose[0], rightEyeCenter[1] - nose[1]);
    const sumDist = leftDist + rightDist;
    if (sumDist < 1) return null;
    
    const asymmetry = (rightDist - leftDist) / sumDist;
    const ipd = Math.hypot(leftEyeCenter[0] - rightEyeCenter[0], leftEyeCenter[1] - rightEyeCenter[1]);
    
    return { asymmetry, ipd, leftDist, rightDist };
  }
  
  averageHeadBaseline(frames) {
    const vals = frames.map(f => f.asymmetry).filter(v => typeof v === 'number' && !isNaN(v));
    const avg = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    const ipdVals = frames.map(f => f.ipd).filter(v => typeof v === 'number' && !isNaN(v));
    const avgIpd = ipdVals.reduce((a, b) => a + b, 0) / Math.max(1, ipdVals.length);
    return { asymmetry: avg, ipd: avgIpd };
  }
  
  classifyHeadDirection(metrics) {
    const thresholdLeft = 0.007;
    const thresholdRight = 0.010;
    const baselineDelta = (typeof this.calibratedHeadDelta === 'number') ? this.calibratedHeadDelta : 0;
    
    if (!metrics) return { facingScreen: true };
    
    const asym = metrics.asymmetry;
    const baseAsym = this.headBaseline?.asymmetry ?? 0;
    const delta = asym - baseAsym;
    
    const deltaRounded = Math.round(delta * 1000) / 1000;
    const baselineDeltaRounded = Math.round(baselineDelta * 1000) / 1000;
    const deltaChangeRounded = deltaRounded - baselineDeltaRounded;
    
    const notFocused = (deltaChangeRounded >= thresholdLeft) || (deltaChangeRounded <= -thresholdRight);
    
    return { facingScreen: !notFocused };
  }
  
  handleState(state, label) {
    const now = Date.now();
    
    if (state !== this.currentState) {
      if (state === 'distracted' || state === 'away') {
        this.distractedSince = now;
        this.isAlertShowing = false;
      } else {
        this.distractedSince = null;
        this.isAlertShowing = false;
      }
      this.currentState = state;
    }
    
    // Check if should alert
    if ((state === 'distracted' || state === 'away') && this.distractedSince) {
      const distractedFor = (now - this.distractedSince) / 1000;
      if (distractedFor >= this.alertDelay && !this.isAlertShowing) {
        this.isAlertShowing = true;
        this.alertSound.play();
        // Send notification via background
        chrome.runtime?.sendMessage({ type: 'FOCUS_ALERT', title: 'Focus Alert!', message: 'You seem distracted!' }).catch(() => {});
      }
    }
    
    this.setStatus(state, label);
  }
}

// Start when loaded
document.addEventListener('DOMContentLoaded', () => {
  window.miniMonitor = new MiniMonitor();
});
