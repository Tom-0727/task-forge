import { render } from '../vendor/preact.mjs';
import { html } from '../vendor/htm.mjs';
import { useEffect } from '../vendor/preact-hooks.mjs';

import { getState, setState } from './store.js';
import { useStore } from './useStore.js';
import * as api from './api.js';

import { Dashboard } from './components/Dashboard.js';
import { AgentDetail } from './components/AgentDetail.js';
import { MemoryPage } from './components/MemoryPage.js';
import { CreateModal } from './components/CreateModal.js';
import { ImportModal } from './components/ImportModal.js';


function emptyMemoryIndex() {
  return {
    knowledge: { items: [], nextCursor: null, loaded: false, loading: false, error: null, dates: [] },
    episodes: { items: [], nextCursor: null, loaded: false, loading: false, error: null, dates: [] },
  };
}

function emptyMemoryBucket(dates = []) {
  return { items: [], nextCursor: null, loaded: false, loading: false, error: null, dates };
}

// ── Data loaders ──
async function loadOverview() {
  try {
    const data = await api.getOverview();
    setState({ overview: data, overviewError: null, lastSync: new Date(), connected: true });
  } catch (err) {
    setState({ overviewError: err.message || 'failed' });
  }
}

async function loadDetail(name) {
  const s = getState();
  if (!name) return;
  try {
    const data = await api.getAgentDetail(name, { contact: s.historyContact });
    setState({ detail: data, detailError: null, lastSync: new Date() });
  } catch (err) {
    setState({ detailError: err.message || 'failed' });
  }
}

export async function loadMetrics(name) {
  if (!name) return;
  try {
    const data = await api.getAgentMetrics(name);
    if (getState().currentAgent !== name) return;
    setState({ metrics: data, metricsError: null });
  } catch (err) {
    if (getState().currentAgent !== name) return;
    setState({ metricsError: err.message || 'failed' });
  }
}

export async function loadMemoryIndex(name, kind = 'knowledge', { cursor = '', append = false, date = null } = {}) {
  if (!name) return;
  const s = getState();
  const selectedDate = kind === 'episodes' ? (date ?? s.memoryEpisodeDate) : '';
  const prev = s.memoryIndex[kind] || emptyMemoryBucket();
  setState({
    memoryIndex: {
      ...s.memoryIndex,
      [kind]: { ...prev, loading: true, error: null },
    },
  });

  try {
    const data = await api.getAgentMemoryIndex(name, { kind, limit: 20, cursor, date: selectedDate });
    if (getState().currentAgent !== name) return;
    const current = getState().memoryIndex[kind] || prev;
    const items = append ? [...current.items, ...(data.items || [])] : (data.items || []);
    const dates = data.dates || current.dates || [];
    setState({
      memoryIndex: {
        ...getState().memoryIndex,
        [kind]: {
          items,
          nextCursor: data.next_cursor ?? null,
          loaded: true,
          loading: false,
          error: null,
          dates,
        },
      },
    });
  } catch (err) {
    if (getState().currentAgent !== name) return;
    const current = getState().memoryIndex[kind] || prev;
    setState({
      memoryIndex: {
        ...getState().memoryIndex,
        [kind]: { ...current, loading: false, error: err.message || 'failed' },
      },
    });
  }
}

export async function loadMemoryFile(name, path) {
  if (!name || !path) return;
  const s = getState();
  setState({
    memorySelectedPath: path,
    memoryFiles: {
      ...s.memoryFiles,
      [path]: { ...(s.memoryFiles[path] || { path }), loading: true, error: null },
    },
  });

  try {
    const data = await api.getAgentMemoryFile(name, path);
    if (getState().currentAgent !== name) return;
    setState({
      memoryFiles: {
        ...getState().memoryFiles,
        [path]: { ...data, loading: false, error: null },
      },
    });
  } catch (err) {
    if (getState().currentAgent !== name) return;
    const current = getState().memoryFiles[path] || { path };
    setState({
      memoryFiles: {
        ...getState().memoryFiles,
        [path]: { ...current, loading: false, error: err.message || 'failed' },
      },
    });
  }
}

function setPath(path) {
  if (`${window.location.pathname}${window.location.search}` !== path) {
    window.history.pushState({}, '', path);
  }
}

function memoryPath(name, kind = 'episodes', date = '') {
  const qs = new URLSearchParams({ kind });
  if (date) qs.set('date', date);
  return `/agents/${encodeURIComponent(name)}/memory?${qs}`;
}

function resetMemoryState(kind = 'episodes', date = '') {
  return {
    memoryIndex: emptyMemoryIndex(),
    memoryFiles: {},
    memoryKind: kind,
    memoryEpisodeDate: kind === 'episodes' ? date : '',
    memorySelectedPath: null,
  };
}

function showDashboard({ push = false } = {}) {
  if (push) setPath('/');
  setState({
    view: 'dashboard',
    currentAgent: null,
    detail: null,
    metrics: null,
    metricsError: null,
    ...resetMemoryState(),
  });
  loadOverview();
}

function showDetail(name, { push = false } = {}) {
  if (push) setPath(`/agents/${encodeURIComponent(name)}`);
  setState({
    view: 'detail',
    currentAgent: name,
    detail: null,
    detailError: null,
    metrics: null,
    metricsError: null,
    ...resetMemoryState(),
    historyContact: 'human',
  });
  loadDetail(name);
  loadMetrics(name);
}

function showMemory(name, { push = false, kind = 'episodes', date = '' } = {}) {
  if (kind !== 'knowledge' && kind !== 'episodes') kind = 'episodes';
  if (push) setPath(memoryPath(name, kind, date));
  setState({
    view: 'memory',
    currentAgent: name,
    detail: null,
    detailError: null,
    metrics: null,
    metricsError: null,
    ...resetMemoryState(kind, date),
    historyContact: 'human',
  });
}

function routeFromLocation() {
  const path = window.location.pathname;
  const memoryMatch = path.match(/^\/agents\/(.+)\/memory$/);
  if (memoryMatch) {
    const params = new URLSearchParams(window.location.search);
    showMemory(decodeURIComponent(memoryMatch[1]), {
      kind: params.get('kind') || 'episodes',
      date: params.get('date') || '',
    });
    return;
  }
  const detailMatch = path.match(/^\/agents\/(.+)$/);
  if (detailMatch) {
    showDetail(decodeURIComponent(detailMatch[1]));
    return;
  }
  showDashboard();
}

// ── Navigation ──
export function goDashboard() {
  showDashboard({ push: true });
}

export function goDetail(name) {
  showDetail(name, { push: true });
}

export function goMemory(name, kind = 'episodes') {
  showMemory(name, { push: true, kind });
}

export function setHistoryContact(contact) {
  setState({ historyContact: contact });
  const s = getState();
  if (s.currentAgent) loadDetail(s.currentAgent);
}

export function setMemoryKind(kind) {
  const s = getState();
  if (s.view === 'memory' && s.currentAgent) {
    setPath(memoryPath(s.currentAgent, kind, kind === 'episodes' ? s.memoryEpisodeDate : ''));
  }
  setState({ memoryKind: kind, memorySelectedPath: null });
}

export function setMemoryEpisodeDate(date) {
  const s = getState();
  const current = s.memoryIndex.episodes || emptyMemoryBucket();
  if (s.view === 'memory' && s.currentAgent) {
    setPath(memoryPath(s.currentAgent, 'episodes', date || ''));
  }
  setState({
    memoryEpisodeDate: date || '',
    memorySelectedPath: null,
    memoryIndex: {
      ...s.memoryIndex,
      episodes: emptyMemoryBucket(current.dates || []),
    },
  });
}

export function refreshCurrent() {
  const s = getState();
  if (s.view === 'dashboard') loadOverview();
  else if (s.view === 'detail' && s.currentAgent) {
    loadDetail(s.currentAgent);
    loadMetrics(s.currentAgent);
  }
}

export function openModal(name) {
  setState({ modal: name });
}

export function closeModal() {
  setState({ modal: null });
}

// ── SSE wiring ──
function wireEvents() {
  api.subscribeEvents((event) => {
    if (event.type !== 'dirty') return;
    const s = getState();
    if (s.view === 'dashboard' && (event.scope === 'overview' || event.scope === 'agent')) {
      loadOverview();
    } else if (s.view === 'detail' && s.currentAgent) {
      if (event.scope === 'overview' || (event.scope === 'agent' && event.name === s.currentAgent)) {
        loadDetail(s.currentAgent);
        loadMetrics(s.currentAgent);
      }
    }
  });
}

// ── Root ──
function App() {
  const view = useStore((s) => s.view);
  const modal = useStore((s) => s.modal);

  useEffect(() => {
    routeFromLocation();
    window.addEventListener('popstate', routeFromLocation);
    wireEvents();
    return () => window.removeEventListener('popstate', routeFromLocation);
  }, []);

  return html`
    <main class=${view === 'memory' ? 'app app-wide' : 'app'}>
      ${view === 'dashboard' ? html`<${Dashboard} />` : null}
      ${view === 'detail' ? html`<${AgentDetail} />` : null}
      ${view === 'memory' ? html`<${MemoryPage} />` : null}
      ${modal === 'create' ? html`<${CreateModal} />` : null}
      ${modal === 'import' ? html`<${ImportModal} />` : null}
    </main>
  `;
}

const root = document.getElementById('root');
render(html`<${App} />`, root);
