import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyB7pNObwdvRJ1zuRkdqi7nBFsb43-fP49g",
  authDomain: "haiku-quiz.firebaseapp.com",
  projectId: "haiku-quiz",
  storageBucket: "haiku-quiz.firebasestorage.app",
  messagingSenderId: "22024455002",
  appId: "1:22024455002:web:1513775bad8c2a12aee963"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
