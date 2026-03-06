// Service Worker for browser notification actions
self.addEventListener('notificationclick', (event) => {
  const { notification, action } = event;
  notification.close();

  if (action === 'go-to-session' || !action) {
    const data = notification.data || {};
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        // Focus existing window and post navigation data
        for (const client of clients) {
          client.postMessage({
            type: 'notification-click',
            sessionId: data.sessionId,
            sessionIdx: data.sessionIdx,
          });
          client.focus();
          return;
        }
        // Fallback: open a new window
        return self.clients.openWindow('/');
      })
    );
  }
});
