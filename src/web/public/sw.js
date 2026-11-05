/**
 * OpenExam PWA Service Worker
 *
 * 策略：
 *   - 导航请求（index.html）network-first：每次发版刷新即可拿到新页面，离线回退缓存；
 *   - 静态资源 cache-first：文件名带 hash，命中即返回，未命中回源并回填；
 *   - 发版时改动 VERSION 可强制清空全部旧缓存。
 */
const VERSION = 'v3';
const CACHE = `openexam-${VERSION}`;
const PRECACHE = ['./', './index.html', './manifest.webmanifest'];
const NAV_TIMEOUT = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);

    if (request.mode === 'navigate') {
      try {
        const fresh = await withTimeout(fetch(request), NAV_TIMEOUT);
        if (fresh && fresh.ok) cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (error) {
        const cached = (await cache.match(request)) || (await cache.match('./index.html'));
        if (cached) return cached;
        throw error;
      }
    }

    const cached = await cache.match(request);
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    } catch (error) {
      throw error;
    }
  })());
});
