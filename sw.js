/* GPAstimate Service Worker — オフライン対応 + 出席確認のプッシュ通知 */
const CACHE = 'gpastimate-v4';
// mark-attendance Edge Function（出席/欠席ボタンのタップ送信先）。Authorizationはanon keyで十分
// （本人確認は通知ペイロード内のHMAC署名付きtokenで行うため）。
const MARK_ATTENDANCE_URL = 'https://dxoxkngbsugtnkiusnoz.supabase.co/functions/v1/mark-attendance';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4b3hrbmdic3VndG5raXVzbm96Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2ODU1MDIsImV4cCI6MjA5NjI2MTUwMn0.s3Xd2tACQaNE5LnBZQnqhKZ4Dl1FqMWCQgi_OGdZwmA';
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

// ===== 出席確認のプッシュ通知 =====
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch (_) { return; }
  e.waitUntil(self.registration.showNotification(d.title || '出席確認', {
    body: d.body || '出席しましたか？',
    tag: 'attend-' + (d.courseId || '') + '-' + (d.date || ''),
    data: d,
    actions: [
      { action: 'present', title: '出席' },
      { action: 'absent',  title: '欠席' },
    ],
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  if (e.action === 'present' || e.action === 'absent') {
    e.waitUntil(fetch(MARK_ATTENDANCE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY },
      body: JSON.stringify({ token: d.token, status: e.action }),
    }).catch(() => {}));
  } else {
    e.waitUntil(self.clients.openWindow('./?attend=' + (d.courseId || '') + ':' + (d.date || '')));
  }
});
