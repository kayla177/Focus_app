// content_capture.js
let captureInterval = null;
let captureStream = null;
let prevHash = null;
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

    // 2. Check for conditions every second
    captureInterval = setInterval(async () => {
      if (!captureStream.active) { // Stop if user stops sharing via browser UI
        stopContentCapture();
        return;
      }
      const currentHash = getVisualHash(video)
      if (currentHash === prevHash){
        console.log("no significant changes detected, skipping...")
        return;
      }
      prevHash = currentHash
      
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

function getVisualHash(videoElement) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    // 1. Shrink to a small square (8x8 is standard for pHash)
    // This naturally filters out high-frequency noise like text cursors.
    canvas.width = 8;
    canvas.height = 8;

    // 2. Convert to Grayscale while drawing to simplify data
    ctx.filter = 'grayscale(100%)';
    ctx.drawImage(videoElement, 0, 0, 8, 8);

    const imageData = ctx.getImageData(0, 0, 8, 8);
    const pixels = imageData.data; // Now 64 pixels (RGBA)

    // 3. Calculate the Average Luminance
    let total = 0;
    for (let i = 0; i < pixels.length; i += 4) {
        total += pixels[i];
    }
    const avg = total / (pixels.length / 4);

    // 4. Generate a 64-bit Binary String
    // If pixel > avg, bit is 1; else 0. 
    // This makes the hash resistant to overall brightness/gamma changes.
    let hash = "";
    for (let i = 0; i < pixels.length; i += 4) {
        hash += pixels[i] > avg ? "1" : "0";
    }
    return hash;
}