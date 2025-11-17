// js/dashboards.js
// Unified dashboard logic: auth guard, chat (RTDB), uploads (Storage), AI (proxy)
// Requires: js/firebase-config.js exporting `firebaseConfig` (v12.5.0)

// -------- IMPORTS (Firebase v12.5.0) --------
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";
import {
  getDatabase,
  ref as dbRef,
  push,
  onChildAdded,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-storage.js";

import { firebaseConfig } from "./firebase-config.js";

// -------- INIT APPS --------
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
export const storage = getStorage(app);

// -------- CONFIG --------
// Default chat room (can be overridden)
const DEFAULT_ROOM = "general";
// Your OpenAI proxy endpoint (deploy to Vercel and set real URL)
const OPENAI_PROXY_URL = "/api/ask"; // change if your proxy URL is different

// -------- UTIL (DOM safe getters) --------
const $ = (id) => document.getElementById(id);
const exists = (id) => !!$(id);

// -------- AUTH STATE & USER LOADING --------
let currentUser = null;
let currentUserData = null;
let currentRoom = DEFAULT_ROOM;

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) {
    // if not on public pages (index/register) redirect to login
    if (!/index\.html$|register\.html$/.test(window.location.pathname)) {
      window.location.href = "/index.html";
    }
    return;
  }

  // load user profile from Firestore
  try {
    const udoc = await getDoc(doc(db, "users", user.uid));
    if (!udoc.exists()) {
      console.warn("No user doc; signing out for safety.");
      await signOut(auth);
      window.location.href = "/register.html";
      return;
    }
    currentUserData = udoc.data();
    applyUserToUI(currentUserData);

    // choose default room: role-based room + "general"
    if (currentUserData.role) currentRoom = `room_${currentUserData.role}`; // e.g., room_admin
    subscribeToRoom(currentRoom);

  } catch (err) {
    console.error("Error loading user doc:", err);
  }
});

// Put user info in common UI elements if present
function applyUserToUI(userData) {
  if (exists("userName")) $("userName").textContent = userData.fullName || userData.name || userData.email;
  if (exists("userNameHeader")) $("userNameHeader").textContent = userData.fullName || userData.name || userData.email;
  if (exists("roleDisplay")) $("roleDisplay").textContent = userData.role || "citizen";
  if (exists("adminName")) $("adminName").textContent = userData.fullName || userData.email;
  if (exists("managerName")) $("managerName").textContent = userData.fullName || userData.email;
  if (exists("staffName")) $("staffName").textContent = userData.fullName || userData.email;
  if (exists("intelName")) $("intelName").textContent = userData.fullName || userData.email;
  if (exists("citizenName")) $("citizenName").textContent = userData.fullName || userData.email;
}

// -------- THEME TOGGLE --------
const themeKey = "hisbah-theme";
const themeBtn = $("themeToggle");
if (themeBtn) {
  themeBtn.addEventListener("click", () => {
    document.body.classList.toggle("dark-mode");
    localStorage.setItem(themeKey, document.body.classList.contains("dark-mode") ? "dark" : "light");
  });
  // load saved
  if (localStorage.getItem(themeKey) === "dark") document.body.classList.add("dark-mode");
}

// -------- LOGOUT BINDING --------
const logoutIdCandidates = ["logoutBtn", "logout"];
logoutIdCandidates.forEach(id => {
  if (exists(id)) {
    $(id).addEventListener("click", async () => {
      try { await signOut(auth); } catch (e) { console.warn(e); }
      window.location.href = "/index.html";
    });
  }
});

// -------- CHAT (Realtime) --------
const messagesEl = $("messages") || $("messagesArea") || $("messagesAreaMain"); // friendly
const aiMessagesEl = $("aiMessages");
const chatInputEl = $("chatInput") || $("messageInput") || $("chat-input") || $("aiInput");
const sendBtn = $("sendBtn") || $("send-message");
const fileInput = $("fileInput") || $("uploadFile") || $("fileUpload") || $("empPhoto");
const chatTabBtn = $("tab-chat") || $("chatTab");
const aiTabBtn = $("tab-ai") || $("aiTab");

// If chat UI exists, wire it
if (messagesEl && chatInputEl && sendBtn) {
  // subscribe handlers
  sendBtn.addEventListener("click", sendTextMessage);
  chatInputEl.addEventListener("keypress", (e) => { if (e.key === "Enter") sendTextMessage(); });
  if (fileInput) fileInput.addEventListener("change", handleFileSelected);
  if (chatTabBtn) chatTabBtn.addEventListener("click", () => setActiveChatTab("chat"));
  if (aiTabBtn) aiTabBtn.addEventListener("click", () => setActiveChatTab("ai"));
}

// Active tab toggling
function setActiveChatTab(tab) {
  // add/remove active classes on provided buttons
  if (chatTabBtn) chatTabBtn.classList.toggle("active", tab === "chat");
  if (aiTabBtn) aiTabBtn.classList.toggle("active", tab === "ai");
  // show/hide message containers if both exist
  if (messagesEl && aiMessagesEl) {
    messagesEl.parentElement.style.display = (tab === "chat") ? "flex" : "none";
    aiMessagesEl.parentElement.style.display = (tab === "ai") ? "flex" : "none";
  }
  // focus input
  chatInputEl.focus();
}

// Render message helper
function renderMessage(msg) {
  // msg: { uid, name, type, text, fileUrl, ts }
  const wrap = document.createElement("div");
  wrap.className = "msg " + ((currentUser && msg.uid === currentUser.uid) ? "me" : "other");
  const meta = document.createElement("div");
  meta.className = "meta";
  const displayName = msg.name || (msg.uid === "ai-bot" ? "Hisbah AI" : "User");
  meta.textContent = `${displayName} • ${new Date(msg.ts || Date.now()).toLocaleString()}`;
  wrap.appendChild(meta);

  if (msg.type === "text") {
    const t = document.createElement("div"); t.textContent = msg.text; wrap.appendChild(t);
  } else if (msg.type === "image") {
    const img = document.createElement("img"); img.src = msg.fileUrl; img.style.maxWidth = "280px"; img.style.borderRadius = "8px"; wrap.appendChild(img);
  } else if (msg.type === "video") {
    const v = document.createElement("video"); v.src = msg.fileUrl; v.controls = true; v.style.maxWidth = "320px"; wrap.appendChild(v);
  } else if (msg.type === "audio") {
    const a = document.createElement("audio"); a.src = msg.fileUrl; a.controls = true; wrap.appendChild(a);
  } else if (msg.type === "ai") {
    const p = document.createElement("div"); p.textContent = msg.text; p.style.fontStyle = "italic"; wrap.appendChild(p);
  } else {
    const p = document.createElement("div"); p.textContent = msg.text || "[unsupported message]"; wrap.appendChild(p);
  }

  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Subscribe to room (listen for new messages)
let roomListenerRef = null;
function subscribeToRoom(roomId = DEFAULT_ROOM) {
  currentRoom = roomId || DEFAULT_ROOM;
  // clear messages UI if present
  if (messagesEl) messagesEl.innerHTML = "";

  try {
    const ref = dbRef(rtdb, `chats/${currentRoom}`);
    // onChildAdded automatically fires for existing + new children
    onChildAdded(ref, (snap) => {
      const data = snap.val();
      if (!data) return;
      renderMessage(data);
    });
    roomListenerRef = ref;
  } catch (err) {
    console.error("subscribeToRoom error:", err);
  }
}

// Send a text message to RTDB
async function sendTextMessage() {
  if (!currentUser) { alert("Please login first."); return; }
  const text = chatInputEl.value?.trim();
  if (!text) return;
  const payload = {
    uid: currentUser.uid,
    name: currentUser.displayName || currentUser.email || (currentUserData && (currentUserData.fullName || currentUserData.name)),
    type: "text",
    text,
    ts: Date.now()
  };
  try {
    await push(dbRef(rtdb, `chats/${currentRoom}`), payload);
    chatInputEl.value = "";
  } catch (err) {
    console.error("sendTextMessage error:", err);
    alert("Failed to send message.");
  }
}

// Handle file selection/upload
async function handleFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file || !currentUser) return;
  const kind = file.type.split("/")[0]; // image, video, audio, etc.
  const ext = file.name.split(".").pop();
  const path = `uploads/${currentRoom}/${Date.now()}_${currentUser.uid}.${ext}`;
  const sRef = storageRef(storage, path);
  const uploadTask = uploadBytesResumable(sRef, file);

  // Simple progress
  uploadTask.on("state_changed",
    (snapshot) => { /* could implement progress bar here */ },
    (err) => { console.error("Upload failed:", err); alert("Upload failed: "+err.message); },
    async () => {
      try {
        const url = await getDownloadURL(uploadTask.snapshot.ref);
        const fileType = (kind === "image") ? "image" : (kind === "video") ? "video" : (kind === "audio") ? "audio" : "file";
        const payload = {
          uid: currentUser.uid,
          name: currentUser.displayName || currentUser.email || (currentUserData && (currentUserData.fullName || currentUserData.name)),
          type: fileType,
          fileUrl: url,
          ts: Date.now()
        };
        await push(dbRef(rtdb, `chats/${currentRoom}`), payload);
        // clear file input if possible
        if (fileInput) fileInput.value = "";
      } catch (err) {
        console.error("Upload finalize error:", err);
      }
    }
  );
}

// -------- HISBAH AI (server proxy) --------
// send prompt to your /api/ask proxy; proxy should call OpenAI securely
export async function sendToAI(prompt, room = currentRoom) {
  if (!prompt) return null;
  try {
    // send to proxy
    const res = await fetch(OPENAI_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: prompt, lang: "bilingual" })
    });
    if (!res.ok) throw new Error("AI proxy error");
    const j = await res.json();
    const reply = j.reply || j.result || j.message || "No response from AI.";

    // push AI reply into RTDB as type 'ai'
    await push(dbRef(rtdb, `chats/${room}`), {
      uid: "ai-bot",
      name: "Hisbah AI",
      type: "ai",
      text: reply,
      ts: Date.now()
    });

    return reply;
  } catch (err) {
    console.error("sendToAI error:", err);
    // push error message so user sees it
    await push(dbRef(rtdb, `chats/${room}`), {
      uid: "ai-bot",
      name: "Hisbah AI",
      type: "ai",
      text: "Sorry — AI is unavailable right now.",
      ts: Date.now()
    });
    return null;
  }
}

// If AI send button exists, wire it to sendToAI
const aiSendBtn = $("aiSendBtn") || $("ai-send-btn");
const aiInput = $("aiInput") || $("chatInputAI") || $("aiInputField");
if (aiSendBtn && aiInput) {
  aiSendBtn.addEventListener("click", async () => {
    const prompt = aiInput.value?.trim();
    if (!prompt) return;
    // push user's prompt as a normal text message too
    await push(dbRef(rtdb, `chats/${currentRoom}`), {
      uid: currentUser.uid,
      name: currentUser.displayName || currentUser.email || (currentUserData && (currentUserData.fullName || currentUserData.name)),
      type: "text",
      text: prompt,
      ts: Date.now()
    });
    aiInput.value = "";
    await sendToAI(prompt, currentRoom);
  });
  aiInput.addEventListener("keypress", (e) => { if (e.key === "Enter") aiSendBtn.click(); });
}

// Expose a helper for manual room subscription (useful in per-page scripts)
export function subscribeToRoom(roomId) {
  subscribeToRoom(roomId);
}

// -------- EXPORTS (optional) --------
export default {
  sendToAI,
  subscribeToRoom: (r) => subscribeToRoom(r)
};

// js/dashboards.js
// Unified dashboard logic: auth guard, chat (RTDB), uploads (Storage), AI (proxy)
// Requires: js/firebase-config.js exporting `firebaseConfig` (v12.5.0)

// -------- IMPORTS (Firebase v12.5.0) --------
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";
import {
  getDatabase,
  ref as dbRef,
  push,
  onChildAdded,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-storage.js";

import { firebaseConfig } from "./firebase-config.js";

// -------- INIT APPS --------
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);
export const storage = getStorage(app);

// -------- CONFIG --------
// Default chat room (can be overridden)
const DEFAULT_ROOM = "general";
// Your OpenAI proxy endpoint (deploy to Vercel and set real URL)
const OPENAI_PROXY_URL = "/api/ask"; // change if your proxy URL is different

// -------- UTIL (DOM safe getters) --------
const $ = (id) => document.getElementById(id);
const exists = (id) => !!$(id);

// -------- AUTH STATE & USER LOADING --------
let currentUser = null;
let currentUserData = null;
let currentRoom = DEFAULT_ROOM;

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (!user) {
    // if not on public pages (index/register) redirect to login
    if (!/index\.html$|register\.html$/.test(window.location.pathname)) {
      window.location.href = "/index.html";
    }
    return;
  }

  // load user profile from Firestore
  try {
    const udoc = await getDoc(doc(db, "users", user.uid));
    if (!udoc.exists()) {
      console.warn("No user doc; signing out for safety.");
      await signOut(auth);
      window.location.href = "/register.html";
      return;
    }
    currentUserData = udoc.data();
    applyUserToUI(currentUserData);

    // choose default room: role-based room + "general"
    if (currentUserData.role) currentRoom = `room_${currentUserData.role}`; // e.g., room_admin
    subscribeToRoom(currentRoom);

  } catch (err) {
    console.error("Error loading user doc:", err);
  }
});

// Put user info in common UI elements if present
function applyUserToUI(userData) {
  if (exists("userName")) $("userName").textContent = userData.fullName || userData.name || userData.email;
  if (exists("userNameHeader")) $("userNameHeader").textContent = userData.fullName || userData.name || userData.email;
  if (exists("roleDisplay")) $("roleDisplay").textContent = userData.role || "citizen";
  if (exists("adminName")) $("adminName").textContent = userData.fullName || userData.email;
  if (exists("managerName")) $("managerName").textContent = userData.fullName || userData.email;
  if (exists("staffName")) $("staffName").textContent = userData.fullName || userData.email;
  if (exists("intelName")) $("intelName").textContent = userData.fullName || userData.email;
  if (exists("citizenName")) $("citizenName").textContent = userData.fullName || userData.email;
}

// -------- THEME TOGGLE --------
const themeKey = "hisbah-theme";
const themeBtn = $("themeToggle");
if (themeBtn) {
  themeBtn.addEventListener("click", () => {
    document.body.classList.toggle("dark-mode");
    localStorage.setItem(themeKey, document.body.classList.contains("dark-mode") ? "dark" : "light");
  });
  // load saved
  if (localStorage.getItem(themeKey) === "dark") document.body.classList.add("dark-mode");
}

// -------- LOGOUT BINDING --------
const logoutIdCandidates = ["logoutBtn", "logout"];
logoutIdCandidates.forEach(id => {
  if (exists(id)) {
    $(id).addEventListener("click", async () => {
      try { await signOut(auth); } catch (e) { console.warn(e); }
      window.location.href = "/index.html";
    });
  }
});

// -------- CHAT (Realtime) --------
const messagesEl = $("messages") || $("messagesArea") || $("messagesAreaMain"); // friendly
const aiMessagesEl = $("aiMessages");
const chatInputEl = $("chatInput") || $("messageInput") || $("chat-input") || $("aiInput");
const sendBtn = $("sendBtn") || $("send-message");
const fileInput = $("fileInput") || $("uploadFile") || $("fileUpload") || $("empPhoto");
const chatTabBtn = $("tab-chat") || $("chatTab");
const aiTabBtn = $("tab-ai") || $("aiTab");

// If chat UI exists, wire it
if (messagesEl && chatInputEl && sendBtn) {
  // subscribe handlers
  sendBtn.addEventListener("click", sendTextMessage);
  chatInputEl.addEventListener("keypress", (e) => { if (e.key === "Enter") sendTextMessage(); });
  if (fileInput) fileInput.addEventListener("change", handleFileSelected);
  if (chatTabBtn) chatTabBtn.addEventListener("click", () => setActiveChatTab("chat"));
  if (aiTabBtn) aiTabBtn.addEventListener("click", () => setActiveChatTab("ai"));
}

// Active tab toggling
function setActiveChatTab(tab) {
  // add/remove active classes on provided buttons
  if (chatTabBtn) chatTabBtn.classList.toggle("active", tab === "chat");
  if (aiTabBtn) aiTabBtn.classList.toggle("active", tab === "ai");
  // show/hide message containers if both exist
  if (messagesEl && aiMessagesEl) {
    messagesEl.parentElement.style.display = (tab === "chat") ? "flex" : "none";
    aiMessagesEl.parentElement.style.display = (tab === "ai") ? "flex" : "none";
  }
  // focus input
  chatInputEl.focus();
}

// Render message helper
function renderMessage(msg) {
  // msg: { uid, name, type, text, fileUrl, ts }
  const wrap = document.createElement("div");
  wrap.className = "msg " + ((currentUser && msg.uid === currentUser.uid) ? "me" : "other");
  const meta = document.createElement("div");
  meta.className = "meta";
  const displayName = msg.name || (msg.uid === "ai-bot" ? "Hisbah AI" : "User");
  meta.textContent = `${displayName} • ${new Date(msg.ts || Date.now()).toLocaleString()}`;
  wrap.appendChild(meta);

  if (msg.type === "text") {
    const t = document.createElement("div"); t.textContent = msg.text; wrap.appendChild(t);
  } else if (msg.type === "image") {
    const img = document.createElement("img"); img.src = msg.fileUrl; img.style.maxWidth = "280px"; img.style.borderRadius = "8px"; wrap.appendChild(img);
  } else if (msg.type === "video") {
    const v = document.createElement("video"); v.src = msg.fileUrl; v.controls = true; v.style.maxWidth = "320px"; wrap.appendChild(v);
  } else if (msg.type === "audio") {
    const a = document.createElement("audio"); a.src = msg.fileUrl; a.controls = true; wrap.appendChild(a);
  } else if (msg.type === "ai") {
    const p = document.createElement("div"); p.textContent = msg.text; p.style.fontStyle = "italic"; wrap.appendChild(p);
  } else {
    const p = document.createElement("div"); p.textContent = msg.text || "[unsupported message]"; wrap.appendChild(p);
  }

  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Subscribe to room (listen for new messages)
let roomListenerRef = null;
function subscribeToRoom(roomId = DEFAULT_ROOM) {
  currentRoom = roomId || DEFAULT_ROOM;
  // clear messages UI if present
  if (messagesEl) messagesEl.innerHTML = "";

  try {
    const ref = dbRef(rtdb, `chats/${currentRoom}`);
    // onChildAdded automatically fires for existing + new children
    onChildAdded(ref, (snap) => {
      const data = snap.val();
      if (!data) return;
      renderMessage(data);
    });
    roomListenerRef = ref;
  } catch (err) {
    console.error("subscribeToRoom error:", err);
  }
}

// Send a text message to RTDB
async function sendTextMessage() {
  if (!currentUser) { alert("Please login first."); return; }
  const text = chatInputEl.value?.trim();
  if (!text) return;
  const payload = {
    uid: currentUser.uid,
    name: currentUser.displayName || currentUser.email || (currentUserData && (currentUserData.fullName || currentUserData.name)),
    type: "text",
    text,
    ts: Date.now()
  };
  try {
    await push(dbRef(rtdb, `chats/${currentRoom}`), payload);
    chatInputEl.value = "";
  } catch (err) {
    console.error("sendTextMessage error:", err);
    alert("Failed to send message.");
  }
}

// Handle file selection/upload
async function handleFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file || !currentUser) return;
  const kind = file.type.split("/")[0]; // image, video, audio, etc.
  const ext = file.name.split(".").pop();
  const path = `uploads/${currentRoom}/${Date.now()}_${currentUser.uid}.${ext}`;
  const sRef = storageRef(storage, path);
  const uploadTask = uploadBytesResumable(sRef, file);

  // Simple progress
  uploadTask.on("state_changed",
    (snapshot) => { /* could implement progress bar here */ },
    (err) => { console.error("Upload failed:", err); alert("Upload failed: "+err.message); },
    async () => {
      try {
        const url = await getDownloadURL(uploadTask.snapshot.ref);
        const fileType = (kind === "image") ? "image" : (kind === "video") ? "video" : (kind === "audio") ? "audio" : "file";
        const payload = {
          uid: currentUser.uid,
          name: currentUser.displayName || currentUser.email || (currentUserData && (currentUserData.fullName || currentUserData.name)),
          type: fileType,
          fileUrl: url,
          ts: Date.now()
        };
        await push(dbRef(rtdb, `chats/${currentRoom}`), payload);
        // clear file input if possible
        if (fileInput) fileInput.value = "";
      } catch (err) {
        console.error("Upload finalize error:", err);
      }
    }
  );
}

// -------- HISBAH AI (server proxy) --------
// send prompt to your /api/ask proxy; proxy should call OpenAI securely
export async function sendToAI(prompt, room = currentRoom) {
  if (!prompt) return null;
  try {
    // send to proxy
    const res = await fetch(OPENAI_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: prompt, lang: "bilingual" })
    });
    if (!res.ok) throw new Error("AI proxy error");
    const j = await res.json();
    const reply = j.reply || j.result || j.message || "No response from AI.";

    // push AI reply into RTDB as type 'ai'
    await push(dbRef(rtdb, `chats/${room}`), {
      uid: "ai-bot",
      name: "Hisbah AI",
      type: "ai",
      text: reply,
      ts: Date.now()
    });

    return reply;
  } catch (err) {
    console.error("sendToAI error:", err);
    // push error message so user sees it
    await push(dbRef(rtdb, `chats/${room}`), {
      uid: "ai-bot",
      name: "Hisbah AI",
      type: "ai",
      text: "Sorry — AI is unavailable right now.",
      ts: Date.now()
    });
    return null;
  }
}

// If AI send button exists, wire it to sendToAI
const aiSendBtn = $("aiSendBtn") || $("ai-send-btn");
const aiInput = $("aiInput") || $("chatInputAI") || $("aiInputField");
if (aiSendBtn && aiInput) {
  aiSendBtn.addEventListener("click", async () => {
    const prompt = aiInput.value?.trim();
    if (!prompt) return;
    // push user's prompt as a normal text message too
    await push(dbRef(rtdb, `chats/${currentRoom}`), {
      uid: currentUser.uid,
      name: currentUser.displayName || currentUser.email || (currentUserData && (currentUserData.fullName || currentUserData.name)),
      type: "text",
      text: prompt,
      ts: Date.now()
    });
    aiInput.value = "";
    await sendToAI(prompt, currentRoom);
  });
  aiInput.addEventListener("keypress", (e) => { if (e.key === "Enter") aiSendBtn.click(); });
}

// Expose a helper for manual room subscription (useful in per-page scripts)
export function subscribeToRoom(roomId) {
  subscribeToRoom(roomId);
}

// -------- EXPORTS (optional) --------
export default {
  sendToAI,
  subscribeToRoom: (r) => subscribeToRoom(r)
};