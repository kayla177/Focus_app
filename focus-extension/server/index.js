import "dotenv/config";
import express from "express";
import { OpenRouter } from '@openrouter/sdk';

const app = express();
app.use(express.json({ limit: "15mb" })); // screenshots are big
let sessionLogs = []  // Global session log list

const openRouter = new OpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    'HTTP-Referer': 'http://localhost:3001', // Optional. Site URL for rankings on openrouter.ai.
  },
});

function guessMimeFromBase64(b64) {
  const head = b64.slice(0, 30);
  if (head.startsWith("iVBORw0KGgo")) return "image/png";
  if (head.startsWith("/9j/")) return "image/jpeg";
  if (head.startsWith("UklGR")) return "image/webp";
  return "image/webp";
}

function toDataUrl(input) {
  if (typeof input !== "string") return "";
  if (input.startsWith("data:image/")) return input;

  const b64 = input.includes("base64,") ? input.split("base64,")[1] : input;
  const mime = guessMimeFromBase64(b64);
  return `data:${mime};base64,${b64}`;
}

app.get("/ping", (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.post("/analyze", async (req, res) => {
  try {
    const { goal, url, title, screenshotDataUrl, ts } = req.body ?? {};
    if (!goal || !screenshotDataUrl) {
      return res.status(400).json({ ok: false, error: "Missing goal or screenshotDataUrl" });
    }

    const imageUrl = toDataUrl(String(screenshotDataUrl));

    const system = `
You are Anchor, a focus coach. Decide if the user's current screen is aligned with their goal.
Return ONLY valid JSON with keys:
- distracted: boolean
- confidence: number (0..1)
- reason: string (short)
- suggested_action: "none" | "nudge" | "block"
- categories: string[]
`;

    const user = `
GOAL: ${goal}
URL: ${url ?? ""}
TITLE: ${title ?? ""}
TIME: ${ts ?? Date.now()}
Assess whether the screen content is helping the goal.
`;

    const completion = await openRouter.chat.send({
      model: 'google/gemini-2.0-flash-001',
      messages: [
        {
          role: "system",
          content: [
            {
              type: 'text',
              text: system,
            }
          ]
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: user,
            },
            {
              type: 'image_url',
              imageUrl: {
                url: imageUrl,
              },
            },
          ],
        },
      ],
      stream: false,
    });

    const outText = completion.choices[0].message.content ?? "";
    if (!outText) return res.status(500).json({ ok: false, error: "No output_text from model" });
    
    let verdict;
    try {
      // CLEANUP: specific fix for VLMs that wrap output in markdown code blocks
      const cleanJson = outText.replace(/```json|```/g, '').trim(); 
      verdict = JSON.parse(cleanJson);
    } catch (e) {
      return res.status(500).json({ ok: false, error: "Invalid JSON from VLM" });
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

    const summaryPrompt = `
      Below is a log of user activities and focus verdicts. 
      Generate a concise "Deep Work Report" in under 70 words, summarizing their focus levels, 
      main distractions, and overall productivity. 
      Then, use point forms to randomly point out 5 times where on_track was equal to False. 
      The point form should include time_stamp of that entry and the reason.
      Do not output any other information, including markdown, code.
      LOGS: ${JSON.stringify(sessionLogs)}
    `;

    const reportResp = await openRouter.chat.send({ // Corrected to chat completion
      model: "google/gemini-3-flash-preview",
      messages: [{ role: "user", content: summaryPrompt }],
      stream: false,
    });

    res.json({ ok: true, report: reportResp.choices[0].message.content });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.listen(3001, () => console.log("Anchor server on http://localhost:3001"));
