// js/chatbox.js
import { auth, rtdb, storage } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref as dbRef, push, onChildAdded, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// DOM elements (expected to exist in each dashboard)
const chatTabBtn = document.getElementById("tab-chat");
const aiTabBtn = document.getElementById("tab-ai");
const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const fileInput = document.getElementById("fileInput");
const roomSelect = document.getElementById("roomSelect"); // optional: choose room

let currentUser = null;
let currentRoom = "general"; // default room

onAuthStateChanged(auth, (u) => {
  if (!u) return;
  currentUser = u;
  initChat();
});

function initChat(){
  // optionally allow selecting room
  if (roomSelect) roomSelect.addEventListener("change", e => {
    currentRoom = e.target.value;
    subscribeToRoom(currentRoom);
  });
  // tab switching
  if (chatTabBtn) chatTabBtn.addEventListener("click", () => setActiveTab("chat"));
  if (aiTabBtn) aiTabBtn.addEventListener("click", () => setActiveTab("ai"));
  if (sendBtn) sendBtn.addEventListener("click", onSend);
  if (fileInput) fileInput.addEventListener("change", onFileSelected);

  subscribeToRoom(currentRoom);
}

function setActiveTab(tab){
  if (tab === "ai"){
    aiTabBtn?.classList.add("active");
    chatTabBtn?.classList.remove("active");
    // show AI UI as needed (UI code toggles)
    // When user opens AI tab, optionally send a system message
  } else {
    chatTabBtn?.classList.add("active");
    aiTabBtn?.classList.remove("active");
  }
}

function subscribeToRoom(room){
  messagesEl.innerHTML = ""; // clear
  const ref = dbRef(rtdb, `chats/${room}`);
  onChildAdded(ref, (snap) => {
    const msg = snap.val();
    renderMessage(msg);
    // auto-scroll
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

function renderMessage(msg){
  const el = document.createElement("div");
  el.className = "msg " + (msg.uid === currentUser.uid ? "me" : "other");
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${msg.name || "User"} • ${new Date(msg.ts || Date.now()).toLocaleString()}`;
  el.appendChild(meta);
  if (msg.type === "text"){
    const t = document.createElement("div"); t.textContent = msg.text; el.appendChild(t);
  } else if (msg.type === "image"){
    const img = document.createElement("img"); img.src = msg.fileUrl; img.style.maxWidth="240px"; img.style.borderRadius="8px"; el.appendChild(img);
  } else if (msg.type === "video"){
    const v = document.createElement("video"); v.src = msg.fileUrl; v.controls=true; v.style.maxWidth="300px"; el.appendChild(v);
  } else if (msg.type === "audio"){
    const a = document.createElement("audio"); a.src = msg.fileUrl; a.controls=true; el.appendChild(a);
  } else if (msg.type === "ai"){
    const t = document.createElement("div"); t.textContent = msg.text; t.style.fontStyle="italic"; el.appendChild(t);
  }
  messagesEl.appendChild(el);
}

async function onSend(){
  const text = inputEl.value.trim();
  if (!text) return;
  const payload = {
    uid: currentUser.uid,
    name: currentUser.displayName || currentUser.email,
    type: "text",
    text,
    ts: Date.now()
  };
  await push(dbRef(rtdb, `chats/${currentRoom}`), payload);
  inputEl.value = "";
}

async function onFileSelected(e){
  const file = e.target.files[0];
  if (!file) return;
  const ext = file.type.split("/")[0];
  const storagePath = `uploads/${currentRoom}/${Date.now()}_${file.name}`;
  const sRef = storageRef(storage, storagePath);
  const uploadTask = uploadBytesResumable(sRef, file);
  uploadTask.on('state_changed', 
    (snapshot) => { /* progress optionally */ }, 
    (err)=>{console.error("Upload failed",err);alert("Upload failed: "+err.message)},
    async ()=>{
      const url = await getDownloadURL(uploadTask.snapshot.ref);
      const type = ext === "image" ? "image" : ext === "video" ? "video" : ext === "audio" ? "audio" : "file";
      const payload = {
        uid: currentUser.uid,
        name: currentUser.displayName || currentUser.email,
        type: type === "file" ? "file" : (type === "audio" ? "audio" : (type === "video" ? "video" : "image")),
        fileUrl: url,
        ts: Date.now()
      };
      await push(dbRef(rtdb, `chats/${currentRoom}`), payload);
      // reset input
      fileInput.value = "";
    }
  );
}

// Expose for manual usage
export { subscribeToRoom, setActiveTab };