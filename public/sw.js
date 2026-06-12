self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); } catch(e) { data = { title: 'AGRIAUTO', body: event.data?.text() || 'Tienes una notificación nueva' }; }

  const title = data.title || 'AGRIAUTO';
  const options = {
    body: data.body || '',
    icon: '/agriauto_logotipo.jpg',
    badge: '/agriauto_logotipo.jpg',
    data: { url: data.url || '/' },
    vibrate: [100, 50, 100],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  const fullUrl = new URL(url, self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.focus();
          if ('navigate' in client) return client.navigate(fullUrl);
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(fullUrl);
    })
  );
});
