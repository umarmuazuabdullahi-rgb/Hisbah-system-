// server/openai-proxy.js (Node/Express example)
// Deploy to your hosting as e.g. https://yourdomain.com/api/openai

import express from "express";
import fetch from "node-fetch"; // or native fetch in Node 18+
const app = express();
app.use(express.json());

const OPENAI_KEY = process.env.OPENAI_KEY; // set in env vars

app.post("/api/openai", async (req, res) => {
  try {
    const { prompt, lang } = req.body;
    // build messages for Chat Completions
    // Ask model to reply bilingual when lang == "bilingual"
    const system = lang === "bilingual"
      ? "You are Hisbah Assistant. Reply in Hausa and English both. First give a short Hausa reply, then English translation. Be concise and helpful and stick to community guidance."
      : "You are Hisbah Assistant. Be concise and helpful.";
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // or text-davinci-003 etc depending on your access
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt }
        ],
        max_tokens: 500,
        temperature: 0.2
      })
    });
    const data = await resp.json();
    const reply = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || "No response";
    res.json({ ok:true, reply });
  } catch (err) {
    console.error("OpenAI proxy error:", err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

export default app;