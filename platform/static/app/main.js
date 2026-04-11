import { render } from '../vendor/preact.mjs';
import { html } from '../vendor/htm.mjs';
import { useEffect } from '../vendor/preact-hooks.mjs';

import { getState, setState } from './store.js';
import { useStore } from './useStore.js';
import * as api from './api.js';

import { Dashboard } from './components/Dashboard.js';
import { AgentDetail } from './components/AgentDetail.js';
import { CreateModal } from './components/CreateModal.js';
import { ImportModal } from './components/ImportModal.js';


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

// ── Navigation ──
export function goDashboard() {
  setState({ view: 'dashboard', currentAgent: null, detail: null });
  loadOverview();
}

export function goDetail(name) {
  setState({ view: 'detail', currentAgent: name, detail: null, historyContact: 'human' });
  loadDetail(name);
}

export function setHistoryContact(contact) {
  setState({ historyContact: contact });
  const s = getState();
  if (s.currentAgent) loadDetail(s.currentAgent);
}

export function refreshCurrent() {
  const s = getState();
  if (s.view === 'dashboard') loadOverview();
  else if (s.view === 'detail' && s.currentAgent) loadDetail(s.currentAgent);
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
      }
    }
  });
}

// ── Root ──
function App() {
  const view = useStore((s) => s.view);
  const modal = useStore((s) => s.modal);

  useEffect(() => {
    loadOverview();
    wireEvents();
  }, []);

  return html`
    <main class="app">
      ${view === 'dashboard' ? html`<${Dashboard} />` : html`<${AgentDetail} />`}
      ${modal === 'create' ? html`<${CreateModal} />` : null}
      ${modal === 'import' ? html`<${ImportModal} />` : null}
    </main>
  `;
}

const root = document.getElementById('root');
render(html`<${App} />`, root);
