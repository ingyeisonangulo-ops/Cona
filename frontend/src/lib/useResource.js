import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from './api.js';

// Carga un recurso GET y expone recarga manual. Si cambia la ruta mientras una
// petición sigue en curso, la respuesta vieja se descarta.
export function useResource(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const ultima = useRef(0);

  const reload = useCallback(async () => {
    if (!path) return;
    const id = ++ultima.current;
    setLoading(true);
    setError('');
    try {
      const d = await get(path);
      if (id === ultima.current) setData(d);
    } catch (err) {
      if (id === ultima.current) setError(err.message);
    } finally {
      if (id === ultima.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload };
}
