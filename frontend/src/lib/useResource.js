import { useCallback, useEffect, useState } from 'react';
import { get } from './api.js';

// Carga un recurso GET y expone recarga manual.
export function useResource(path) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError('');
    try {
      setData(await get(path));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, error, loading, reload };
}
