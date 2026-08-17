# Kas UMKM — Arus Kas dengan Pencadangan Otomatis

Aplikasi pencatatan arus kas harian untuk UMKM dengan sistem pencadangan dana otomatis (Cadangan Angsuran, Gaji, Simpanan, Dana Bebas) yang selalu dijaga tetap **balanced** terhadap Cash + Rekening.

Versi ini menggunakan **Firebase** (Authentication + Firestore) sebagai database gratis — sehingga mendukung **login per pengguna** dan **sinkron data real-time di semua perangkat** (HP & komputer otomatis sama datanya).

---

## 1. Buat Project Firebase (gratis)

1. Buka https://console.firebase.google.com → **Add project** → beri nama (mis. `kas-umkm`) → ikuti langkahnya sampai selesai (Google Analytics boleh dimatikan).
2. Di sidebar kiri, klik **Build → Authentication → Get started**. Pada tab **Sign-in method**, aktifkan provider **Email/Password**.
3. Klik **Build → Firestore Database → Create database**. Pilih lokasi server (mis. `asia-southeast2` / Jakarta agar lebih cepat), lalu mulai dalam **production mode**.
4. Setelah database dibuat, buka tab **Rules** dan ganti isinya dengan aturan berikut, lalu **Publish**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /kasumkm_users/{uid} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```

   Aturan ini memastikan setiap pengguna **hanya bisa membaca/menulis datanya sendiri** — inilah yang membuat aplikasi multi-user aman meski gratis.

5. Kembali ke **Project Overview** (ikon rumah) → klik ikon **`</>`** (Web app) → daftarkan app (nama bebas) → **jangan** centang Firebase Hosting kalau Anda deploy ke Netlify/Vercel. Firebase akan menampilkan objek `firebaseConfig` — salin nilai-nilainya.

## 2. Isi kredensial di proyek ini

Salin file `.env.example` menjadi `.env`, lalu isi dengan nilai dari `firebaseConfig` tadi:

```
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=kas-umkm-xxxxx.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=kas-umkm-xxxxx
VITE_FIREBASE_STORAGE_BUCKET=kas-umkm-xxxxx.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=xxxxxxxxxxxx
VITE_FIREBASE_APP_ID=1:xxxxxxxxxxxx:web:xxxxxxxxxxxxxxxx
```

Nilai-nilai ini aman ditaruh di kode frontend (bukan rahasia) — keamanan sesungguhnya dijaga oleh Firestore Security Rules di atas.

## 3. Jalankan di komputer

Butuh [Node.js](https://nodejs.org) versi 18 ke atas.

```bash
npm install
npm run dev
```

Buka alamat yang muncul di terminal, lalu **Daftar** akun (email + password) untuk mulai memakai aplikasi.

## 4. Build untuk produksi

```bash
npm run build
```

Hasilnya ada di folder `dist/`.

## 5. Deploy

### Netlify
1. Push folder ini ke GitHub.
2. Netlify → **Add new site → Import an existing project** → pilih repo.
3. Build command: `npm run build`, Publish directory: `dist`.
4. **Site settings → Environment variables** → tambahkan ke-6 variabel `VITE_FIREBASE_*` dari file `.env` Anda (Netlify tidak membaca file `.env` otomatis dari repo, harus diisi manual di sini).
5. Deploy ulang (Trigger deploy) setelah environment variables tersimpan.

### Vercel
1. Push ke GitHub → Vercel → **Add New → Project** → pilih repo (framework Vite terdeteksi otomatis).
2. Di **Settings → Environment Variables**, tambahkan ke-6 variabel `VITE_FIREBASE_*` yang sama.
3. Deploy.

> Setelah deploy, tambahkan domain Netlify/Vercel Anda (mis. `nama-app.netlify.app`) ke **Firebase Console → Authentication → Settings → Authorized domains**, kalau tidak login akan ditolak oleh Firebase.

## Tentang data & keamanan

- Setiap pengguna login dengan email/password sendiri (fitur **multi-user** sungguhan).
- Data tersimpan di Firestore, disinkronkan **real-time** — mencatat pemasukan di HP langsung muncul di komputer dan sebaliknya, tanpa perlu backup/restore manual.
- Aplikasi tetap bisa dipakai **offline** (mencatat transaksi tanpa internet) berkat cache lokal Firestore, lalu otomatis sinkron begitu online kembali.
- Menu **Backup dan Restore Data** tetap tersedia untuk mengunduh salinan `.json` kapan saja, dan untuk pemulihan darurat.
- Free tier Firestore cukup luas untuk kebutuhan UMKM (50rb baca & 20rb tulis per hari) — jauh lebih dari cukup untuk pencatatan kas harian satu usaha.

## Struktur proyek

```
kas-umkm/
├── .env.example        ← salin jadi .env, isi kredensial Firebase
├── index.html
├── package.json
├── tailwind.config.js
├── postcss.config.js
├── vite.config.js
└── src/
    ├── main.jsx
    ├── index.css
    ├── firebase.js      ← inisialisasi Firebase Auth & Firestore
    ├── AuthGate.jsx      ← halaman login/daftar + pengecekan sesi
    └── App.jsx           ← seluruh logika & tampilan aplikasi
```
