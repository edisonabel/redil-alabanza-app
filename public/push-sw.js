self.addEventListener('push', (event) => {
  const fallbackPayload = {
    title: 'Redil Worship',
    body: 'Tienes una nueva notificación.',
    url: '/',
  };

  let payload = fallbackPayload;

  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = {
        ...fallbackPayload,
        ...(parsed && typeof parsed === 'object' ? parsed : {}),
      };
    }
  } catch (error) {
    try {
      const text = event.data ? event.data.text() : '';
      payload = {
        ...fallbackPayload,
        body: text || fallbackPayload.body,
      };
    } catch (_) {
      payload = fallbackPayload;
    }
  }

  const title = payload.title || fallbackPayload.title;
  const options = {
    body: payload.body || payload.mensaje || fallbackPayload.body,
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    image: payload.image || undefined,
    tag: payload.tag || 'redil-push',
    renotify: Boolean(payload.renotify),
    requireInteraction: Boolean(payload.requireInteraction),
    data: {
      url: payload.url || payload.link || '/',
      payload,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const rawUrl = event.notification?.data?.url || '/';
  const targetUrl = new URL(rawUrl, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const clientList = await clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.href === targetUrl || clientUrl.pathname === new URL(targetUrl).pathname) {
            await client.focus();
            return;
          }
        } catch (_) {
          // no-op
        }
      }

      if (clients.openWindow) {
        await clients.openWindow(targetUrl);
      }
    })()
  );
});
