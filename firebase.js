import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAOLjWa1ic9CDdy_URXCkyhGSjjJGe3Ne8",
  authDomain: "gestion-taxi-pro.firebaseapp.com",
  projectId: "gestion-taxi-pro",
  storageBucket: "gestion-taxi-pro.firebasestorage.app",
  messagingSenderId: "70701158596",
  appId: "1:70701158596:web:37d28df11b0f89712ef991",
  measurementId: "G-XYKVZWDN8N"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export {
  auth,
  db,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  doc,
  setDoc,
  getDoc,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy
};
