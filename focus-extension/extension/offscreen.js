let stream = null;
let videoEl = null;
let canvasEl = null;
let ctx = null;
let tickTimer = null;

// Tell background we're ready to receive messages
chrome.runtime.sendMessage({ action: "offscreenReady" });

function cleanup() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  if (stream) {
    for (const t of stream.getTracks()) t.stop();
    stream = null;
  }
  videoEl = null;
  canvasEl = null;
  ctx = null;
}

async function startCapture({
  tabId,
  streamId,
  intervalMs = 1000,
  maxWidth = 1280,
  maxHeight = 720,
  quality = 0.6
}) {
  cleanup();

  if (!streamId) {
    throw new Error("Missing streamId for tab capture.");
  }

  // Get MediaStream using streamId from background
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
        maxWidth,
        maxHeight,
        maxFrameRate: 5
      }
    }
  });

  videoEl = document.createElement("video");
  videoEl.srcObject = stream;
  videoEl.muted = true;
  videoEl.playsInline = true;

  await videoEl.play();

  canvasEl = document.createElement("canvas");
  ctx = canvasEl.getContext("2d", { willReadFrequently: false });

  tickTimer = setInterval(async () => {
    try {
      if (!videoEl || videoEl.readyState < 2) return;

      const w = videoEl.videoWidth || maxWidth;
      const h = videoEl.videoHeight || maxHeight;

      const scale = Math.min(1, maxWidth / w, maxHeight / h);
      const cw = Math.max(1, Math.floor(w * scale));
      const ch = Math.max(1, Math.floor(h * scale));

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
        tabId,
        ts: Date.now(),
        dataUrl
      });
    } catch (e) {
      chrome.runtime.sendMessage({ action: "captureError", message: String(e) });
      cleanup();
    }
  }, intervalMs);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.action === "offscreenStartCapture") {
    startCapture(msg.payload);
  }
  if (msg?.action === "offscreenStopCapture") {
    cleanup();
  }
});
