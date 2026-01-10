"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type View = "setup" | "active" | "summary";

const CIRCUMFERENCE = 565; // matches your original math for r=90

function safeChrome() {
  // avoids crashing in normal web (localhost) where chrome isn't defined
  return typeof (globalThis as any).chrome !== "undefined" ? (globalThis as any).chrome : null;
}

export default function PopupPage() {
  const [view, setView] = useState<View>("setup");

  const [goal, setGoal] = useState("");
  const [duration, setDuration] = useState(25); // minutes
  const [timeRemaining, setTimeRemaining] = useState(25 * 60); // seconds

  const timerRef = useRef<number | null>(null);

  const startDisabled = goal.trim().length === 0;

  const progressDashOffset = useMemo(() => {
    const total = duration * 60;
    const done = Math.max(0, Math.min(total, total - timeRemaining));
    const progress = (done / total) * CIRCUMFERENCE;
    return CIRCUMFERENCE - progress;
  }, [duration, timeRemaining]);

  const timeDisplay = useMemo(() => {
    const mins = Math.floor(timeRemaining / 60);
    const secs = timeRemaining % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }, [timeRemaining]);

  function clearTimer() {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function startTimer() {
    clearTimer();
    timerRef.current = window.setInterval(() => {
      setTimeRemaining((prev) => {
        const next = prev - 1;
        if (next <= 0) return 0;
        return next;
      });
    }, 1000);
  }

  function completeSession() {
    clearTimer();

    const c = safeChrome();
    c?.storage?.local?.set({ isActive: false });
    c?.runtime?.sendMessage?.({ action: "endSession" });

    setView("summary");
  }

  function pauseSession() {
    completeSession();
  }

  function resetToSetup() {
    clearTimer();
    setGoal("");
    setDuration(25);
    setTimeRemaining(25 * 60);
    setView("setup");
  }

  function startSession() {
    const sessionGoal = goal.trim();
    const sessionDuration = duration;

    setTimeRemaining(sessionDuration * 60);

    const c = safeChrome();
    c?.storage?.local?.set({
      isActive: true,
      goal: sessionGoal,
      duration: sessionDuration,
      startTime: Date.now(),
      endTime: Date.now() + sessionDuration * 60 * 1000,
    });

    c?.runtime?.sendMessage?.({
      action: "startSession",
      goal: sessionGoal,
      duration: sessionDuration,
    });

    setView("active");
    startTimer();
  }

  // Load persisted state on mount (resume session)
  useEffect(() => {
    const c = safeChrome();
    if (!c?.storage?.local) return;

    c.storage.local.get(["isActive", "goal", "duration", "endTime"], (data: any) => {
      if (data.isActive && typeof data.endTime === "number" && data.endTime > Date.now()) {
        const g = data.goal || "";
        const d = typeof data.duration === "number" ? data.duration : 25;
        const remaining = Math.floor((data.endTime - Date.now()) / 1000);

        setGoal(g);
        setDuration(d);
        setTimeRemaining(Math.max(0, remaining));
        setView("active");
        startTimer();
      }
    });

    return () => clearTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When timer hits 0, complete
  useEffect(() => {
    if (view === "active" && timeRemaining <= 0) completeSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRemaining, view]);

  const presetDurations = [15, 25, 45, 60];

  return (
    <div>
      {/* Setup View */}
      <div id="setupView" className="view" style={{ display: view === "setup" ? "block" : "none" }}>
        <div className="header">
          <div className="icon-circle">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="5" r="3" />
              <path d="M12 22V8" />
              <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
            </svg>
          </div>
          <h1>Anchor</h1>
          <p className="subtitle">Your AI-powered focus companion</p>
        </div>

        <div className="card">
          <div className="form-group">
            <label>What is your main focus right now?</label>
            <input
              type="text"
              id="goalInput"
              placeholder="e.g., Write project proposal, Study for exam..."
              autoComplete="off"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label>Focus Duration</label>
            <input
              type="range"
              id="durationSlider"
              min={5}
              max={120}
              step={5}
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value, 10))}
            />
            <div className="duration-display">
              <span>5 min</span>
              <span id="durationValue" className="duration-main">
                {duration} minutes
              </span>
              <span>120 min</span>
            </div>

            <div className="preset-buttons">
              {presetDurations.map((d) => (
                <button
                  key={d}
                  className={`preset-btn ${d === duration ? "active" : ""}`}
                  data-duration={d}
                  onClick={() => setDuration(d)}
                  type="button"
                >
                  {d}m
                </button>
              ))}
            </div>
          </div>

          <button id="startBtn" className="primary-btn" disabled={startDisabled} onClick={startSession}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="5" r="3" />
              <path d="M12 22V8" />
              <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
            </svg>
            Drop Anchor
          </button>
        </div>
      </div>

      {/* Active View */}
      <div id="activeView" className="view" style={{ display: view === "active" ? "block" : "none" }}>
        <div className="active-container">
          <div className="ai-badge">
            <span className="pulse-dot"></span>
            AI Copilot Active
          </div>

          <div className="goal-display">
            <p className="goal-label">Currently anchored to:</p>
            <h2 id="activeGoal" className="goal-text">
              {goal || "Your goal here"}
            </h2>
          </div>

          <div className="timer-circle">
            <svg viewBox="0 0 200 200">
              <circle cx="100" cy="100" r="90" className="timer-bg" />
              <circle
                cx="100"
                cy="100"
                r="90"
                className="timer-progress"
                id="timerProgress"
                style={{ strokeDashoffset: progressDashOffset }}
              />
              <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#14b8a6" />
                  <stop offset="100%" stopColor="#0d9488" />
                </linearGradient>
              </defs>
            </svg>

            <div className="timer-text">
              <div id="timeDisplay" className="time-big">
                {timeDisplay}
              </div>
              <div className="time-label">remaining</div>
            </div>
          </div>

          <p className="encouragement">Stay focused. You've got this.</p>

          <button id="pauseBtn" className="secondary-btn" onClick={pauseSession}>
            Pause Session
          </button>
        </div>
      </div>

      {/* Summary View */}
      <div id="summaryView" className="view" style={{ display: view === "summary" ? "block" : "none" }}>
        <div className="summary-container">
          <div className="success-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>

          <h1 className="summary-title">Session Complete!</h1>
          <p className="summary-goal">
            You anchored to: <span id="summaryGoal">{goal}</span>
          </p>

          <button id="newSessionBtn" className="primary-btn dark" onClick={resetToSetup}>
            Start New Session
          </button>
        </div>
      </div>
    </div>
  );
}
