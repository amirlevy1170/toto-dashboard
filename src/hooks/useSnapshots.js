import { useState, useEffect } from 'react';
import {
  fetchIndex, fetchSnapshot, fetchAllSnapshots, fetchDrawSnapshot,
} from '../api';

export function useSnapshots() {
  const [dates, setDates] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const allDates = await fetchIndex();
        if (cancelled) return;
        setDates(allDates);

        const all = await fetchAllSnapshots();
        if (cancelled) return;
        setSnapshots(all);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return { dates, snapshots, loading, error };
}

export function useSnapshot(date) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    setLoading(true);
    fetchSnapshot(date)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [date]);

  return { data, loading, error };
}

// Draw snapshot for a given date. Null if that date has no draw file yet.
export function useDrawSnapshot(date) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!date) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    fetchDrawSnapshot(date)
      .then(d => { if (!cancelled) setData(d); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [date]);

  return { data, loading };
}
