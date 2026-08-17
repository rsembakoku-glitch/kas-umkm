import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager } from "firebase/firestore";

// Nilai-nilai ini diambil dari file .env (lihat .env.example).
// Jangan pernah menaruh kredensial rahasia lain (selain config Firebase Web,
// yang memang dirancang aman untuk terlihat publik) di file ini.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const missingConfig = Object.entries(firebaseConfig)
  .filter(([, v]) => !v)
  .map(([k]) => k);

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Firestore dengan cache lokal persisten -> aplikasi tetap bisa dibuka &
// mencatat transaksi saat offline, lalu otomatis sinkron saat online lagi.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) }),
});
