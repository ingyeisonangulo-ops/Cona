// Registro del Service Worker SOLO en producción.
export async function registerPwa() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const { registerSW } = await import('virtual:pwa-register');
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      // Nueva versión disponible: se aplica al confirmar (evita recargas inesperadas
      // en medio de un formulario).
      if (window.confirm('Hay una nueva versión de la aplicación. ¿Actualizar ahora?')) update(true);
    },
  });
}

// Borra los datos de API cacheados por el SW (se llama al cerrar sesión).
export async function clearDataCache() {
  if (!('caches' in window)) return;
  try {
    await caches.delete('api-data');
  } catch {
    /* sin caché disponible */
  }
}
