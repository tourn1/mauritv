const CACHE_NAME = 'mauris-movies-v1';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './mauritv.png',
    './icon-192.png',
    './icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

self.addEventListener('fetch', (event) => {
    // Estrategia: Network First (Red primero, luego Caché)
    // Esto asegura que si hay conexión, siempre se cargue lo último.
    event.respondWith(
        fetch(event.request).catch(() => {
            return caches.match(event.request);
        })
    );
});
