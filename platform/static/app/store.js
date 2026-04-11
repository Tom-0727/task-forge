// Minimal pub/sub store. One global instance holds UI state;
// components re-render via the useStore hook in components/useStore.js.

const listeners = new Set();

const state = {
  view: 'dashboard',       // 'dashboard' | 'detail'
  currentAgent: null,      // name string when view === 'detail'
  overview: null,          // { agents, connections, usage, revision }
  overviewError: null,
  detail: null,            // full detail payload for currentAgent
  detailError: null,
  historyContact: 'human',
  connected: false,        // SSE connection state
  modal: null,             // 'create' | 'import' | null
  lastSync: null,          // Date of last successful refresh
};

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setState(patch) {
  Object.assign(state, patch);
  for (const l of listeners) l();
}
