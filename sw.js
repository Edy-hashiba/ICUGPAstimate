/* GPAstimate Service Worker — オフライン対応 */
const CACHE = 'gpastimate-v3';
const PRECACHE = [
  './',
  './index.html',
  './courses-data.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.prod.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // POST等はそのまま（Supabase書き込み等）
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  // Supabase の API / Realtime は常にネットワーク（キャッシュしない）
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;
  // OCR辞書など極端に大きいものはキャッシュ対象外
  if (url.hostname.indexOf('tessdata') !== -1) return;

  // HTML（ページ遷移）はネットワーク優先 → 更新したindex.htmlを常に最新で表示。
  // オフライン時のみキャッシュにフォールバック。これで「変更が反映されない」を防ぐ。
  const accept = req.headers.get('accept') || '';
  const isHTML = req.mode === 'navigate' || accept.indexOf('text/html') !== -1;
  if (isHTML && url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // それ以外（CDN・courses-data.js・画像）は stale-while-revalidate: まずキャッシュ→裏でネット更新
  e.respondWith(
    caches.match(req).then((cached) => {
      const fetched = fetch(req).then((res) => {
        if (res && res.status === 200 && url.protocol === 'https:') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});
