// offscreen.js
// Captures desktop frames in an offscreen document and sends them to background.

let stream = null;
let videoEl = null;
let canvasEl = null;
let ctx = null;
let tickTimer = null;

// Guard to prevent double-start races (common cause of "Invalid state")
let starting = false;
let isCapturing = false;

// Tell background we're ready to receive messages
chrome.runtime.sendMessage({ action: "offscreenReady" });

function cleanup() {
  // Stop ticking first
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }

  // Stop media tracks
  if (stream) {
    for (const t of stream.getTracks()) {
      try {
        t.stop();
      } catch (_) {}
    }
    stream = null;
  }

  // Release elements/ctx
  if (videoEl) {
    try {
      videoEl.pause();
    } catch (_) {}
    videoEl.srcObject = null;
  }

  videoEl = null;
  canvasEl = null;
  ctx = null;

  isCapturing = false;
  starting = false;
}

async function startCapture(payload) {
  // If we're already starting or capturing, hard reset first to avoid races
  if (starting || isCapturing) {
    cleanup();
  }
  starting = true;

  const {
    streamId,
    intervalMs = 1000,
    maxWidth = 1280,
    maxHeight = 720,
    quality = 0.7,
  } = payload || {};

  if (!streamId) {
    starting = false;
    throw new Error("Missing streamId for capture.");
  }

  // IMPORTANT: For chrome.desktopCapture streamIds
  const chromeMediaSource = "desktop";

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: streamId,
        },
      },
    });

  } catch (e) {
    chrome.runtime.sendMessage({
      action: "captureError",
      message: `getUserMedia failed: ${String(e)} (streamIdLen=${String(streamId).length})`,
    });
    cleanup();
    return;
  }

  // If user stops sharing, track ends
  const [track] = stream.getVideoTracks();
  if (track) {
    track.onended = () => {
      chrome.runtime.sendMessage({
        action: "captureError",
        message: "Capture ended by user",
      });
      cleanup();
    };
  }

  videoEl = document.createElement("video");
  videoEl.srcObject = stream;
  videoEl.muted = true;
  videoEl.playsInline = true;

  // Wait for dimensions
  await new Promise((resolve) => {
    videoEl.onloadedmetadata = () => resolve(true);
  });

  try {
    await videoEl.play();
  } catch (e) {
    chrome.runtime.sendMessage({
      action: "captureError",
      message: `video.play() failed: ${String(e)}`,
    });
    cleanup();
    return;
  }

  canvasEl = document.createElement("canvas");
  ctx = canvasEl.getContext("2d", { willReadFrequently: false });

  isCapturing = true;
  starting = false;

  tickTimer = setInterval(async () => {
    try {
      if (!videoEl || !canvasEl || !ctx) return;
      if (videoEl.readyState < 2) return;

      const w = videoEl.videoWidth || maxWidth;
      const h = videoEl.videoHeight || maxHeight;

      const scale = Math.min(1, maxWidth / w, maxHeight / h);
      const cw = Math.max(1, Math.floor(w * scale));
      const ch = Math.max(1, Math.floor(h * scale));

      // Resize canvas to output dims
      canvasEl.width = cw;
      canvasEl.height = ch;

      ctx.drawImage(videoEl, 0, 0, cw, ch);

      const blob = await new Promise((resolve) =>
        canvasEl.toBlob(resolve, "image/webp", quality)
      );
      if (!blob) return;

      const dataUrl = await new Promise((resolve) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result);
        r.readAsDataURL(blob);
      });

      chrome.runtime.sendMessage({
        action: "captureFrame",
        tabId: -1, // desktop capture has no single tab id
        ts: Date.now(),
        dataUrl,
      });
    } catch (e) {
      chrome.runtime.sendMessage({
        action: "captureError",
        message: `tick error: ${String(e)}`,
      });
      cleanup();
    }
  }, intervalMs);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.action === "offscreenStartCapture") {
    // Always cleanup first so we don't reuse old stream/video/canvas
    cleanup();

    startCapture(msg.payload).catch((e) => {
      chrome.runtime.sendMessage({
        action: "captureError",
        message: `startCapture failed: ${String(e)}`,
      });
      cleanup();
    });
  }

  if (msg?.action === "offscreenStopCapture") {
    cleanup();
  }
});
