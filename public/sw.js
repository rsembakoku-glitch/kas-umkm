// Service worker minimal -- syarat wajib agar Chrome menganggap situs ini
// "installable" sebagai aplikasi. Tidak melakukan caching agresif supaya
// data & tampilan selalu versi terbaru setiap dibuka.
self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Selalu ambil dari jaringan (tidak menyimpan cache), lalu fallback ke cache jika offline.
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
