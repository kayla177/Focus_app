// capture.js
// Runs in a normal extension tab (NOT offscreen) and captures desktop frames.

let stream = null;
let videoEl = null;
let canvasEl = null;
let ctx = null;
let tickTimer = null;

let starting = false;
let isCapturing = false;

// Keep a long-lived Port to the service worker.
// This also helps keep the SW alive while capturing.
const port = chrome.runtime.connect({ name: "capturePage" });
console.log("[capture] page loaded", { url: location.href, time: Date.now() });


// Tell background we exist
port.postMessage({ action: "ready" });


function cleanup() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }

  if (stream) {
    for (const t of stream.getTracks()) {
      try {
        t.stop();
      } catch (_) {}
    }
    stream = null;
  }

  if (videoEl) {
    try {
      videoEl.pause();
    } catch (_) {}
    try {
      videoEl.srcObject = null;
    } catch (_) {}
  }

  videoEl = null;
  canvasEl = null;
  ctx = null;

  starting = false;
  isCapturing = false;
}

function chooseEntireScreen() {
    console.log("[capture] opening picker (screen only)");

  return new Promise((resolve) => {
    chrome.desktopCapture.chooseDesktopMedia(["screen"], (streamId) => {
      resolve(streamId || null);
    });
  });
}

function getDesktopStream(streamId) {
  const constraints = {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: streamId,
      },
    },
  };

  return new Promise((resolve, reject) => {
    const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia;

    if (legacy) {
      legacy.call(navigator, constraints, resolve, reject);
      return;
    }

    // fallback
    navigator.mediaDevices
      .getUserMedia(constraints)
      .then(resolve)
      .catch(reject);
  });
}

async function startCapture(payload) {
  // Prevent racing starts
  if (starting || isCapturing) cleanup();
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
    port.postMessage({ action: "captureError", message: "Missing streamId" });
    return;
  }

  // IMPORTANT: For desktopCapture streamIds, use legacy constraints.
  // Keep it minimal — many systems choke if you include maxWidth/maxHeight here.
  try {
    console.log("[capture] start requested", {
      streamIdLen: String(streamId).length,
      time: Date.now(),
    });

    stream = await getDesktopStream(streamId);

    console.log(
      "[capture] got stream",
      stream.getTracks().map((t) => t.readyState)
    );
  } catch (e) {
    port.postMessage({
      action: "captureError",
      message: `getUserMedia failed: ${String(e)} (streamIdLen=${
        String(streamId).length
      })`,
    });
    cleanup();
    return;
  }

  const [track] = stream.getVideoTracks();
  if (track) {
    track.onended = () => {
      port.postMessage({
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

  await new Promise((resolve) => {
    videoEl.onloadedmetadata = () => resolve(true);
  });

  try {
    await videoEl.play();
  } catch (e) {
    port.postMessage({
      action: "captureError",
      message: `video.play() failed: ${String(e)}`,
    });
    cleanup();
    return;
  }

  canvasEl = document.createElement("canvas");
  ctx = canvasEl.getContext("2d");

  isCapturing = true;
  starting = false;

  tickTimer = setInterval(async () => {
    try {
      if (!videoEl || !canvasEl || !ctx) return;
      if (videoEl.readyState < 2) return;

      const w = videoEl.videoWidth || 1280;
      const h = videoEl.videoHeight || 720;

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

      port.postMessage({
        action: "captureFrame",
        ts: Date.now(),
        tabId: -1,
        dataUrl,
      });
    } catch (e) {
      port.postMessage({
        action: "captureError",
        message: `tick error: ${String(e)}`,
      });
      cleanup();
    }
  }, intervalMs);
}

// Messages from the service worker
port.onMessage.addListener((msg) => {
  if (!msg?.action) return;

  if (msg.action === "start") {
    startCapture(msg.payload).catch((e) => {
      port.postMessage({
        action: "captureError",
        message: `startCapture failed: ${String(e)}`,
      });
      cleanup();
    });
  }

  if (msg.action === "pickAndStart") {
    (async () => {
      cleanup();

      const picked = await chooseEntireScreen();
      if (!picked) {
        port.postMessage({
          action: "captureError",
          message: "User cancelled screen picker",
        });
        return;
      }

      await startCapture({ ...msg.payload, streamId: picked });
    })().catch((e) => {
      port.postMessage({
        action: "captureError",
        message: `pickAndStart failed: ${String(e)}`,
      });
      cleanup();
    });
  }

  if (msg.action === "stop") {
    cleanup();
  }
});

// Safety: if port disconnects, stop capture
port.onDisconnect.addListener(() => {
  cleanup();
});
