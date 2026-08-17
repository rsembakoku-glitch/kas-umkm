import React, { useState, useEffect } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from "firebase/auth";
import { ShieldCheck, RefreshCcw, AlertTriangle, Mail, Lock, Loader2 } from "lucide-react";
import { auth, missingConfig } from "./firebase";
import App from "./App.jsx";

const ERROR_MESSAGES = {
  "auth/invalid-email": "Format email tidak valid.",
  "auth/user-not-found": "Akun dengan email ini belum terdaftar.",
  "auth/wrong-password": "Password salah.",
  "auth/invalid-credential": "Email atau password salah.",
  "auth/email-already-in-use": "Email ini sudah terdaftar. Coba masuk (login).",
  "auth/weak-password": "Password minimal 6 karakter.",
  "auth/too-many-requests": "Terlalu banyak percobaan. Coba lagi beberapa saat lagi.",
  "auth/network-request-failed": "Koneksi internet bermasalah.",
};
function errMsg(e) {
  return ERROR_MESSAGES[e?.code] || "Terjadi kesalahan. Coba lagi.";
}

function ConfigMissing() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 p-4">
      <div className="max-w-md w-full rounded-2xl border-2 border-amber-300 bg-amber-50 p-6 text-center">
        <AlertTriangle className="mx-auto mb-3 text-amber-600" size={32} />
        <h1 className="font-bold text-stone-800 mb-2">Konfigurasi Firebase Belum Diisi</h1>
        <p className="text-sm text-stone-600">
          Buat file <code className="font-mono bg-white px-1 rounded">.env</code> dari{" "}
          <code className="font-mono bg-white px-1 rounded">.env.example</code> lalu isi kredensial
          project Firebase Anda. Lihat README.md untuk langkah lengkapnya.
        </p>
        <p className="text-xs text-stone-400 mt-3">Variabel belum terisi: {missingConfig.join(", ")}</p>
      </div>
    </div>
  );
}

function AuthForm() {
  const [mode, setMode] = useState("login"); // login | register
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError(""); setInfo(""); setBusy(true);
    try {
      if (mode === "login") {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (e2) {
      setError(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!email.trim()) { setError("Isi email dulu, lalu klik lupa password."); return; }
    setError(""); setInfo(""); setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setInfo("Link reset password sudah dikirim ke email Anda.");
    } catch (e2) {
      setError(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50 dark:bg-stone-950 p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="p-3 rounded-2xl bg-emerald-700 text-white mb-3"><ShieldCheck size={26} /></div>
          <h1 className="font-black text-xl text-stone-800 dark:text-stone-100">Kas UMKM</h1>
          <p className="text-xs text-stone-400">Arus Kas dengan Pencadangan Otomatis</p>
        </div>

        <form onSubmit={submit} className="bg-white dark:bg-stone-900 rounded-2xl border-2 border-stone-200 dark:border-stone-800 p-5 space-y-4">
          <div className="flex gap-2 rounded-xl bg-stone-100 dark:bg-stone-800 p-1">
            {[{ k: "login", label: "Masuk" }, { k: "register", label: "Daftar" }].map((t) => (
              <button key={t.k} type="button" onClick={() => { setMode(t.k); setError(""); setInfo(""); }}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${mode === t.k ? "bg-white dark:bg-stone-900 text-emerald-700 dark:text-emerald-400 shadow-sm" : "text-stone-500"}`}>
                {t.label}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="block text-sm font-medium mb-1 text-stone-600 dark:text-stone-300">Email</span>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usaha@email.com"
                className="w-full pl-9 pr-3 py-3 rounded-xl border-2 border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
            </div>
          </label>

          <label className="block">
            <span className="block text-sm font-medium mb-1 text-stone-600 dark:text-stone-300">Password</span>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
              <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimal 6 karakter"
                className="w-full pl-9 pr-3 py-3 rounded-xl border-2 border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-800 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-emerald-600" />
            </div>
          </label>

          {error && <p className="text-sm text-red-600 flex items-start gap-1.5"><AlertTriangle size={15} className="shrink-0 mt-0.5" />{error}</p>}
          {info && <p className="text-sm text-emerald-700">{info}</p>}

          <button type="submit" disabled={busy} className="w-full py-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold flex items-center justify-center gap-2">
            {busy && <Loader2 size={16} className="animate-spin" />}
            {mode === "login" ? "Masuk" : "Daftar Akun Baru"}
          </button>

          {mode === "login" && (
            <button type="button" onClick={resetPassword} className="w-full text-center text-xs text-stone-400 hover:text-emerald-700">
              Lupa password?
            </button>
          )}
        </form>

        <p className="text-center text-[11px] text-stone-400 mt-4">
          Data Anda tersimpan aman di akun ini dan otomatis sinkron di semua perangkat yang login.
        </p>
      </div>
    </div>
  );
}

export default function AuthGate() {
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setChecking(false);
    });
    return unsub;
  }, []);

  if (missingConfig.length > 0) return <ConfigMissing />;

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="flex items-center gap-2 text-stone-400 text-sm"><RefreshCcw size={16} className="animate-spin" /> Memuat...</div>
      </div>
    );
  }

  if (!user) return <AuthForm />;

  return <App uid={user.uid} email={user.email} onLogout={() => signOut(auth)} />;
}
