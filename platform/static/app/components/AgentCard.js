import { html } from '../../vendor/htm.mjs';
import { stateBadge, isStoppedLike } from '../util.js';
import { goDetail, refreshCurrent } from '../main.js';
import * as api from '../api.js';


function hasActiveSelection() {
  const sel = window.getSelection ? window.getSelection() : null;
  return !!(sel && !sel.isCollapsed && String(sel).trim());
}

async function handleStart(name) {
  try {
    await api.startAgent(name);
  } catch (err) {
    alert('Start failed: ' + (err.message || 'unknown'));
  }
  setTimeout(refreshCurrent, 800);
}

async function handleStop(name) {
  try {
    await api.stopAgent(name);
  } catch (err) {
    alert('Stop failed: ' + (err.message || 'unknown'));
  }
  setTimeout(refreshCurrent, 400);
}

async function handleDelete(name) {
  if (!confirm(`Delete agent "${name}"?\n\nThis will STOP the agent and DELETE its entire working directory. This cannot be undone.`)) {
    return;
  }
  try {
    await api.deleteAgent(name);
  } catch (err) {
    alert('Delete failed: ' + (err.message || 'unknown'));
    return;
  }
  refreshCurrent();
}

export function AgentCard({ agent }) {
  const badge = stateBadge(agent.status);
  const stopped = isStoppedLike(badge);
  const lastHb = agent.status ? agent.status.last_heartbeat : 'none';
  const lastMsg = agent.status ? agent.status.last_message : '';
  const goal = agent.goal || '';

  const onCardClick = (e) => {
    if (hasActiveSelection()) return;
    if (e.target.closest('.agent-card-actions')) return;
    goDetail(agent.name);
  };

  return html`
    <div class="agent-card" onClick=${onCardClick}>
      <div class="agent-card-top">
        <span class="agent-card-name">${agent.name}</span>
        <span class=${`badge ${badge.cls}`}>${badge.text}</span>
      </div>
      <div class="agent-card-info">
        ${agent.provider || '?'} · ${agent.interval || '?'}min${agent.passive_mode ? ' · passive' : ''} · ${lastHb}
      </div>
      ${goal ? html`<div class="agent-card-info" style="font-style:italic">${goal.substring(0, 80)}</div>` : null}
      ${lastMsg ? html`<div class="agent-card-msg">${lastMsg}</div>` : null}
      ${(agent.tags && agent.tags.length) ? html`
        <div class="agent-card-tags">
          ${agent.tags.map((t) => html`<span class="tag">${t}</span>`)}
        </div>
      ` : null}
      <div class="agent-card-actions" onClick=${(e) => e.stopPropagation()}>
        ${stopped
          ? html`<button class="card-btn start" onClick=${() => handleStart(agent.name)}>Start</button>`
          : html`<button class="card-btn" onClick=${() => handleStop(agent.name)}>Stop</button>`
        }
        <button class="card-btn danger" onClick=${() => handleDelete(agent.name)}>Delete</button>
      </div>
    </div>
  `;
}
