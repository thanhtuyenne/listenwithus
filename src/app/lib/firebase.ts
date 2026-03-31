import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyA2kFgAn4z-PnpopURdWe2swuR6noAFXIA",
  authDomain: "listenwithus-c9ee5.firebaseapp.com",
  projectId: "listenwithus-c9ee5",
  storageBucket: "listenwithus-c9ee5.firebasestorage.app",
  messagingSenderId: "572442301449",
  appId: "1:572442301449:web:dbb0dd4e3c37acfca214d8",
  measurementId: "G-017QW68S2M"
};

const app: FirebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db: Firestore = getFirestore(app);

export { db };