import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
    getFirestore,
    collection,
    doc,
    setDoc,
    getDocs,
    getDoc,
    updateDoc,
    deleteDoc,
    addDoc,
    onSnapshot,
    query,
    orderBy,
    runTransaction,
    serverTimestamp,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBhfLDZX5DkTt61icaZ8lXbMQ0cNJA46xE",
  authDomain: "anas-library-pos.firebaseapp.com",
  projectId: "anas-library-pos",
  storageBucket: "anas-library-pos.firebasestorage.app",
  messagingSenderId: "38243913470",
  appId: "1:38243913470:web:3b0df4ec9d75371d59dfaf"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

window.FB = {
    db,
    collection,
    doc,
    setDoc,
    getDocs,
    getDoc,
    updateDoc,
    deleteDoc,
    addDoc,
    onSnapshot,
    query,
    orderBy,
    runTransaction,
    serverTimestamp,
    writeBatch
};

window.dispatchEvent(new Event('firebase-ready'));
