// content_capture.js
let captureInterval = null;
let captureStream = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_CAPTURE") {
    startContentCapture(request.streamId, request.tabId);
  } else if (request.action === "STOP_CAPTURE") {
    stopContentCapture();
  }
});

async function startContentCapture(streamId, tabId) {
  try {
    // 1. We are in the Active Tab, so we CAN use this streamId
    captureStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: streamId,
          maxWidth: 1280,
          maxHeight: 720
        }
      }
    });

    const video = document.createElement("video");
    video.srcObject = captureStream;
    video.muted = true;
    await video.play();

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    // 2. Capture 1 frame per second
    captureInterval = setInterval(async () => {
      if (!captureStream.active) { // Stop if user stops sharing via browser UI
        stopContentCapture();
        return;
      }
      
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      const dataUrl = canvas.toDataURL("image/webp", 0.5);

      // 3. Send frame back to Background
      chrome.runtime.sendMessage({
        action: "captureFrame",
        ts: Date.now(),
        tabId: tabId,
        dataUrl: dataUrl
      });
      
    }, 1000);

  } catch (err) {
    console.error("Capture failed:", err);
    chrome.runtime.sendMessage({ action: "captureError", message: err.message });
  }
}

function stopContentCapture() {
  if (captureInterval) clearInterval(captureInterval);
  if (captureStream) captureStream.getTracks().forEach(t => t.stop());
  captureInterval = null;
  captureStream = null;
}