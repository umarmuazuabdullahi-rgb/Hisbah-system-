import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-storage.js";

export const firebaseConfig = {
  apiKey: "AIzaSyB5UQ-8624b960An1wmwSE_zIgszNYkWZQ",
  authDomain: "hisbah-board.firebaseapp.com",
  databaseURL: "https://hisbah-board-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "hisbah-board",
  storageBucket: "hisbah-board.firebasestorage.app",
  messagingSenderId: "385506606666",
  appId: "1:385506606666:web:11e68844287a0d1d3170b3",
  measurementId: "G-11F46GSTFY"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);