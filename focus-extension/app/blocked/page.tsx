"use client";

import React, { useEffect, useMemo, useState } from "react";

function safeChrome() {
  return typeof chrome !== "undefined" ? chrome : null;
}

export default function BlockedPage() {
  const [goal, setGoal] = useState("your focus");

  useEffect(() => {
    // Parse ?goal=... from URL (works in exported static pages)
    try {
      const params = new URLSearchParams(window.location.search);
      const g = params.get("goal");
      setGoal(g || "your focus");
    } catch {
      setGoal("your focus");
    }
  }, []);

  const goalText = useMemo(() => goal || "your focus", [goal]);

  async function closeCurrentTab() {
    const c = safeChrome();
    if (!c?.tabs?.query || !c?.tabs?.remove) return;

    try {
      const tabs = await c.tabs.query({ active: true, currentWindow: true });
      const tab = tabs?.[0];
      if (tab?.id != null) await c.tabs.remove(tab.id);
    } catch {
      // ignore
    }
  }

  async function handleBack() {
    // Try going back first
    try {
      history.back();
    } catch {
      // ignore
    }

    // If still here, close tab
    await closeCurrentTab();
  }

  async function handleBreak() {
    const c = safeChrome();
    try {
      c?.runtime?.sendMessage?.({ action: "endSession" });
    } catch {
      // ignore
    }

    await closeCurrentTab();
  }

  return (
    <div className="container">
      <div className="icon-circle">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="5" r="3" />
          <path d="M12 22V8" />
          <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
        </svg>
      </div>

      <h1>Gentle Nudge</h1>

      <p className="message">
        You seem to be drifting. Shall we get back to <span className="goal" id="goalText">{goalText}</span>?
      </p>

      <div className="buttons">
        <button id="backBtn" className="primary-btn" onClick={handleBack}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          I&apos;m Back
        </button>

        <button id="breakBtn" className="secondary-btn" onClick={handleBreak}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
            <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
            <line x1="6" y1="1" x2="6" y2="4" />
            <line x1="10" y1="1" x2="10" y2="4" />
            <line x1="14" y1="1" x2="14" y2="4" />
          </svg>
          Take a Break
        </button>
      </div>
    </div>
  );
}
