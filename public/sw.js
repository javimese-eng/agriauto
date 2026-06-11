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
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
