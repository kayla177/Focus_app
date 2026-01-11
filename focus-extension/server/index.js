import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json({ limit: "15mb" })); // screenshots are big

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

    const resp = await client.responses.create({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: [{ type: "input_text", text: system }] },
        {
          role: "user",
          content: [
            { type: "input_text", text: user },
            { type: "input_image", image_url: imageUrl, detail: "high" }
          ],
        },
      ],
      text: { format: { type: "json_object" } },
    });

    const outText = resp.output_text ?? "";
    if (!outText) return res.status(500).json({ ok: false, error: "No output_text from model" });

    return res.json({ ok: true, verdict: JSON.parse(outText) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e) });
  }
});

app.listen(3001, () => console.log("Anchor server on http://localhost:3001"));
