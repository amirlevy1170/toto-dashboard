import { useState, useEffect } from 'react';
import {
  fetchAllSnapshots,
  fetchFormsIndex, fetchFormsSnapshot,
  fetchWalkforwardIndex, fetchWalkforwardSnapshot,
} from '../api';

// Normalised "selection" record:
// { source: 'daily'|'forms'|'walkforward', type: 'league'|'cup'|'national',
//   league, model, ensemble?, runDate? }
//
// Daily snapshots carry `per_league`, `cup_models`, and `national_models`
// arrays. Forms and walk-forward snapshots only carry per-league winners
// (as a dict keyed by league name). We flatten everything into one list so
// the Models page can tally across any subset.

function flattenDaily(snap) {
  const out = [];
  for (const l of snap?.per_league || []) {
    out.push({ source: 'daily', type: 'league',
               league: l.league, model: l.model, ensemble: l.ensemble });
  }
  for (const m of snap?.cup_models || []) {
    out.push({ source: 'daily', type: 'cup',
               league: m.league, model: m.model, ensemble: m.ensemble });
  }
  for (const m of snap?.national_models || []) {
    out.push({ source: 'daily', type: 'national',
               league: m.league, model: m.model, ensemble: m.ensemble });
  }
  return out;
}

function flattenLeagueWinnersDict(snap, source) {
  const out = [];
  const lw = snap?.league_winners;
  if (!lw || typeof lw !== 'object') return out;
  for (const [league, w] of Object.entries(lw)) {
    if (!w?.model) continue;
    out.push({ source, type: 'league',
               league, model: w.model, ensemble: w.ensemble });
  }
  return out;
}

export function useAllSelections() {
  const [daily, setDaily] = useState([]);
  const [forms, setForms] = useState([]);
  const [wf, setWf] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [dailySnaps, formsDates, wfDates] = await Promise.all([
          fetchAllSnapshots(),
          fetchFormsIndex(),
          fetchWalkforwardIndex(),
        ]);
        const [formsSnaps, wfSnaps] = await Promise.all([
          Promise.all((formsDates || []).map(d =>
            fetchFormsSnapshot(d).catch(() => null))),
          Promise.all((wfDates || []).map(d =>
            fetchWalkforwardSnapshot(d).catch(() => null))),
        ]);
        if (cancelled) return;
        setDaily(dailySnaps.filter(Boolean));
        setForms(formsSnaps.filter(Boolean));
        setWf(wfSnaps.filter(Boolean));
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // Flatten lazily — cheap enough to do every render and avoids stale memo.
  const dailySel = daily.flatMap(flattenDaily);
  const formsSel = forms.flatMap(s => flattenLeagueWinnersDict(s, 'forms'));
  const wfSel    = wf.flatMap(s => flattenLeagueWinnersDict(s, 'walkforward'));

  return {
    loading, error,
    runCounts: { daily: daily.length, forms: forms.length, walkforward: wf.length },
    selections: { daily: dailySel, forms: formsSel, walkforward: wfSel },
  };
}
