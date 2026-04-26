// Minimal pub/sub store. One global instance holds UI state;
// components re-render via the useStore hook in components/useStore.js.

const listeners = new Set();

const state = {
  view: 'dashboard',       // 'dashboard' | 'detail' | 'memory' | 'todo'
  currentAgent: null,      // name string for agent-scoped views
  overview: null,          // { agents, connections, usage, revision }
  overviewError: null,
  detail: null,            // full detail payload for currentAgent
  detailError: null,
  metrics: null,
  metricsError: null,
  memoryIndex: {
    knowledge: { items: [], nextCursor: null, loaded: false, loading: false, error: null, dates: [] },
    episodes: { items: [], nextCursor: null, loaded: false, loading: false, error: null, dates: [] },
  },
  memoryFiles: {},         // path -> { path, content, last_modified, loading, error }
  memoryKind: 'knowledge',
  memoryEpisodeDate: '',
  memorySelectedPath: null,
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
