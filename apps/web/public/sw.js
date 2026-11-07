// Chorly service worker: push notifications only (no offline caching).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// A proof bigger than this isn't put in the notification; the parent still sees it in Approvals.
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

self.addEventListener('push', (event) => {
  let data = { title: 'Chorly', body: '', url: '/' };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(show(data));
});

async function show(data) {
  const approval = data.approval;
  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url, approval },
  };
  if (approval) {
    // One notification per chore: a second push for it, or the outcome of pressing Approve, replaces it.
    options.tag = `approval-${approval.instanceId}`;
    if (approval.canApprove) options.actions = [{ action: 'approve', title: approval.strings.approve }];
    if (approval.image) {
      const image = await proofImage(approval.image);
      if (image) options.image = image;
    }
  }
  return self.registration.showNotification(data.title, options);
}

// The proof only loads with the parent's login, which the browser doesn't send for notification
// images, so it's fetched here and handed over as a data URL.
async function proofImage(path) {
  try {
    const response = await fetch(new URL(path, self.location.origin), { credentials: 'same-origin' });
    if (!response.ok || !(response.headers.get('content-type') || '').startsWith('image/')) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) return null;
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return `data:image/jpeg;base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

// Approves right from the notification, signed in as the parent, without opening Chorly.
async function approve(notification) {
  const { approval, url } = notification.data;
  const done = (title) =>
    self.registration.showNotification(title, {
      body: notification.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: notification.tag,
      // The parent just pressed the button: no second buzz.
      silent: true,
      data: { url },
    });
  try {
    const response = await fetch(new URL(`/api/instances/${encodeURIComponent(approval.instanceId)}/approve`, self.location.origin), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (response.ok) return done(approval.strings.approved);
    // Another parent got to it first, or the kid took it back.
    if (response.status === 400 || response.status === 404) return done(approval.strings.handled);
  } catch {
    // Offline: fall through.
  }
  return done(approval.strings.failed);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'approve' && event.notification.data?.approval) {
    event.waitUntil(approve(event.notification));
    return;
  }
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const win of wins) {
        if ('focus' in win) {
          win.navigate(target);
          return win.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
