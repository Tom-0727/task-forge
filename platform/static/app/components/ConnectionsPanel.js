import { html } from '../../vendor/htm.mjs';
import { useState, useEffect } from '../../vendor/preact-hooks.mjs';
import * as api from '../api.js';
import { refreshCurrent } from '../main.js';


export function ConnectionsPanel({ agents, connections }) {
  const names = agents.map((a) => a.name);
  const [a, setA] = useState(names[0] || '');
  const [b, setB] = useState(names[1] || '');
  const [result, setResult] = useState('');

  useEffect(() => {
    if (!names.includes(a)) setA(names[0] || '');
    if (!names.includes(b) || b === a) {
      const alt = names.find((n) => n !== a) || '';
      setB(alt);
    }
  }, [agents.map((x) => x.name).join('|')]);

  const onConnect = async () => {
    if (!a || !b || a === b) {
      setResult('Select two different agents');
      return;
    }
    setResult('Connecting…');
    try {
      await api.connectAgents(a, b);
      setResult('Connected');
      setTimeout(() => setResult(''), 1000);
      refreshCurrent();
    } catch (err) {
      setResult('Error: ' + (err.message || 'failed'));
    }
  };

  const onDisconnect = async (ax, bx) => {
    if (!confirm(`Disconnect ${ax} and ${bx}?`)) return;
    try {
      await api.disconnectAgents(ax, bx);
      refreshCurrent();
    } catch { /* ignore */ }
  };

  return html`
    <section class="panel">
      <div class="panel-head">
        <h2>Agent Connections</h2>
        <span class="meta">${connections.length} connections</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
        <select value=${a} onChange=${(e) => setA(e.target.value)}
          style="padding:4px 8px;border:1px solid var(--line);border-radius:6px;font:inherit;font-size:13px">
          ${names.map((n) => html`<option key=${n} value=${n}>${n}</option>`)}
        </select>
        <span style="color:var(--muted)">↔</span>
        <select value=${b} onChange=${(e) => setB(e.target.value)}
          style="padding:4px 8px;border:1px solid var(--line);border-radius:6px;font:inherit;font-size:13px">
          ${names.map((n) => html`<option key=${n} value=${n}>${n}</option>`)}
        </select>
        <button onClick=${onConnect} style="padding:4px 10px;font-size:12px">Connect</button>
        <span class="meta">${result}</span>
      </div>
      <div>
        ${connections.map(({ a: ax, b: bx }) => html`
          <div key=${`${ax}<>${bx}`} style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px">
            <span>${ax} ↔ ${bx}</span>
            <button class="warn" onClick=${() => onDisconnect(ax, bx)} style="padding:2px 8px;font-size:11px">Disconnect</button>
          </div>
        `)}
      </div>
    </section>
  `;
}
