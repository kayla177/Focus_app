import "dotenv/config";
import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
app.use(express.json({ limit: "15mb" })); // screenshots are big
let sessionLogs = []; // Global session log list

// Initialize Google Generative AI with your API Key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function guessMimeFromBase64(b64) {
  const head = b64.slice(0, 30);
  if (head.startsWith("iVBORw0KGgo")) return "image/png";
  if (head.startsWith("/9j/")) return "image/jpeg";
  if (head.startsWith("UklGR")) return "image/webp";
  return "image/webp";
}

// Helper to extract raw base64 and mime type for Google API
function parseBase64(input) {
  if (typeof input !== "string") return null;
  const b64 = input.includes("base64,") ? input.split("base64,")[1] : input;
  const mimeType = guessMimeFromBase64(b64);
  return {
    inlineData: {
      data: b64,
      mimeType
    }
  };
}

app.get("/ping", (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.post("/analyze", async (req, res) => {
  try {
    const { goal, url, title, screenshotDataUrl, ts } = req.body ?? {};
    if (!goal || !screenshotDataUrl) {
      return res.status(400).json({ ok: false, error: "Missing goal or screenshotDataUrl" });
    }

    const imageData = parseBase64(String(screenshotDataUrl));

    // Initialize the Gemma model as requested
    const model = genAI.getGenerativeModel({ model: "models/gemma-3-27b-it" });

    const systemInstruction = `
You are Anchor, a focus coach. Decide if the user's current screen is aligned with their goal.
Return ONLY valid JSON with keys:
- distracted: boolean
- confidence: number (0..1)
- reason: string (short)
- suggested_action: "none" | "nudge" | "block"
- categories: string[]
`;

    const prompt = `
${systemInstruction}

GOAL: ${goal}
URL: ${url ?? ""}
TITLE: ${title ?? ""}
TIME: ${ts ?? Date.now()}
Assess whether the screen content is helping the goal.
`;

    // Google API uses a parts array for multimodal input
    const result = await model.generateContent([prompt, imageData]);
    const response = await result.response;
    const outText = response.text();

    if (!outText) return res.status(500).json({ ok: false, error: "No output from model" });

    let verdict;
    try {
      // Clean markdown formatting if the model includes it
      const cleanJson = outText.replace(/```json|```/g, '').trim();
      verdict = JSON.parse(cleanJson);
    } catch (e) {
      return res.status(500).json({ ok: false, error: "Invalid JSON from model" });
    }

    // Add entry to session log
    sessionLogs.push({
      timestamp: ts ?? Date.now(),
      reason: verdict.reason,
      on_track: !verdict.distracted
    });

    return res.json({ ok: true, verdict });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

app.post("/summarize-session", async (req, res) => {
  try {
    if (sessionLogs.length === 0) return res.json({ ok: true, report: "No data captured." });

    // Initialize the Gemini 2.5 Flash model as requested
    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    const summaryPrompt = `
      Below is a log of user activities and focus verdicts. 
      Generate a concise "Deep Work Report" in under 70 words, summarizing their focus levels, 
      main distractions, and overall productivity. 
      Then, use point forms to randomly point out 5 times where on_track was equal to False. 
      The point form should include time_stamp of that entry and the reason. The time_stamp should be hours:minutes:seconds, determined by the unix timestamp given.
      If there are less than 5 points, output that number of points. If there are no instances, don't output pointform. 
      Do not output any other information, including markdown, code.
      LOGS: ${JSON.stringify(sessionLogs)}
    `;

    const result = await model.generateContent(summaryPrompt);
    const response = await result.response;
    const reportText = response.text();

    sessionLogs.length = 0; // Clear logs after summary
    return res.json({ ok: true, report: reportText });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

app.listen(3001, () => console.log("Anchor server on http://localhost:3001"));