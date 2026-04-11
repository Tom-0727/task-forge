import { html } from '../../vendor/htm.mjs';
import { useStore } from '../useStore.js';
import { stateBadge, isStoppedLike } from '../util.js';
import { goDashboard, refreshCurrent } from '../main.js';
import * as api from '../api.js';

import { StatusPanel } from './StatusPanel.js';
import { SchedulePanel } from './SchedulePanel.js';
import { ContactsPanel } from './ContactsPanel.js';
import { HistoryPanel } from './HistoryPanel.js';
import { SendPanel } from './SendPanel.js';


async function handleStart(name) {
  try { await api.startAgent(name); }
  catch (err) { alert('Start failed: ' + (err.message || 'unknown')); return; }
  setTimeout(refreshCurrent, 1200);
}

async function handleStop(name) {
  try { await api.stopAgent(name); }
  catch (err) { alert('Stop failed: ' + (err.message || 'unknown')); }
  setTimeout(refreshCurrent, 800);
}

async function handleDelete(name) {
  if (!confirm(`Delete agent "${name}"?\n\nThis will STOP the agent and DELETE its entire working directory. This cannot be undone.`)) {
    return;
  }
  try { await api.deleteAgent(name); }
  catch (err) { alert('Delete failed: ' + (err.message || 'unknown')); return; }
  goDashboard();
}

export function AgentDetail() {
  const name = useStore((s) => s.currentAgent);
  const detail = useStore((s) => s.detail);
  const error = useStore((s) => s.detailError);

  if (!name) return null;

  if (!detail && !error) {
    return html`
      <div>
        <div class="detail-header">
          <button class="back-btn" onClick=${goDashboard}>← Back</button>
          <h1>${name}</h1>
        </div>
        <p class="meta">Loading…</p>
      </div>
    `;
  }

  if (error && !detail) {
    return html`
      <div>
        <div class="detail-header">
          <button class="back-btn" onClick=${goDashboard}>← Back</button>
          <h1>${name}</h1>
        </div>
        <p class="meta">Error: ${error}</p>
      </div>
    `;
  }

  const status = detail.status || {};
  const badge = stateBadge(status);
  const stopped = isStoppedLike(badge);

  return html`
    <div>
      <div class="detail-header">
        <button class="back-btn" onClick=${goDashboard}>← Back</button>
        <h1>${name}</h1>
        <span class=${`badge ${badge.cls}`}>${badge.text}</span>
        <div style="flex:1"></div>
        ${stopped
          ? html`<button onClick=${() => handleStart(name)}>Start</button>`
          : html`<button class="warn" onClick=${() => handleStop(name)}>Stop</button>`
        }
        <button class="warn" onClick=${() => handleDelete(name)}>Delete</button>
      </div>

      <${StatusPanel} detail=${detail} />
      <${ContactsPanel} contacts=${detail.contacts || []} />
      <${HistoryPanel} detail=${detail} />
      <${SendPanel} name=${name} />
    </div>
  `;
}
