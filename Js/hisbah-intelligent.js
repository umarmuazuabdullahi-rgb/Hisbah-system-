// js/hisbah-intelligent.js
// This module posts user prompt to your server endpoint which forwards to OpenAI.
// It then pushes the AI reply into the same RTDB chat room as a message with type "ai".

import { rtdb } from "./firebase-config.js";
import { push, ref as dbRef } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let currentUser = null;
onAuthStateChanged(auth, (u) => { currentUser = u; });

/**
 * sendToAI(prompt, room)
 * - prompt: user question / text
 * - room: chat room id e.g. "general"
 */
export async function sendToAI(prompt, room = "general"){
  if (!prompt) return;
  try {
    // call your serverless endpoint (you must deploy it). Replace /api/openai with your endpoint.
    const res = await fetch("/api/openai", {
      method: "POST",
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ prompt, lang: "bilingual" }) // "bilingual" instructs server to ask for Hausa+English answers
    });
    if (!res.ok) throw new Error("AI server error");
    const data = await res.json();
    const reply = data.reply || "No response";

    // push AI reply into RTDB as a message (type ai)
    await push(dbRef(rtdb, `chats/${room}`), {
      uid: "ai-bot",
      name: "Hisbah AI",
      type: "ai",
      text: reply,
      ts: Date.now()
    });

    return reply;
  } catch (err) {
    console.error("AI error:", err);
    // push an error message
    await push(dbRef(rtdb, `chats/${room}`), {
      uid: "ai-bot",
      name: "Hisbah AI",
      type: "ai",
      text: "Sorry, AI service is currently unavailable.",
      ts: Date.now()
    });
    return null;
  }
}