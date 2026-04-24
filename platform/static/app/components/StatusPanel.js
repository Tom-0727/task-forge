import { html } from '../../vendor/htm.mjs';
import { useState, useEffect, useRef } from '../../vendor/preact-hooks.mjs';
import * as api from '../api.js';
import { goMemory, refreshCurrent } from '../main.js';
import { SchedulePanel } from './SchedulePanel.js';
import { CompactPanel } from './CompactPanel.js';


export function StatusPanel({ detail }) {
  const status = detail.status || {};
  const [intervalVal, setIntervalVal] = useState(String(detail.interval || 20));
  const [intervalResult, setIntervalResult] = useState('');
  const [passive, setPassive] = useState(!!detail.passive_mode);
  const [passiveResult, setPassiveResult] = useState('');
  const touched = useRef(false);

  // Sync from props unless the user is editing.
  useEffect(() => {
    if (!touched.current) setIntervalVal(String(detail.interval || 20));
  }, [detail.interval]);

  useEffect(() => { setPassive(!!detail.passive_mode); }, [detail.passive_mode]);

  const onIntervalChange = (e) => {
    touched.current = true;
    setIntervalVal(e.target.value);
  };

  const onTogglePassive = async () => {
    const next = !passive;
    setPassiveResult('Saving…');
    try {
      await api.setPassiveMode(detail.name, next);
      setPassive(next);
      setPassiveResult('Saved');
      setTimeout(() => setPassiveResult(''), 1500);
      refreshCurrent();
    } catch (err) {
      setPassiveResult('Failed: ' + (err.message || 'unknown'));
    }
  };

  const onSetInterval = async () => {
    const val = parseInt(intervalVal, 10);
    if (!val || val < 1) { setIntervalResult('Must be >= 1'); return; }
    setIntervalResult('Saving…');
    try {
      await api.setInterval(detail.name, val);
      setIntervalResult('Saved');
      touched.current = false;
      setTimeout(() => setIntervalResult(''), 1500);
      refreshCurrent();
    } catch (err) {
      setIntervalResult('Failed: ' + (err.message || 'unknown'));
    }
  };

  const facts = [
    ['Provider', detail.provider || '-'],
    ['State', status.state || '-'],
    ['Runner PID', status.runner_pid || '-'],
    ['Awaiting Human', status.awaiting_human ? 'YES' : 'NO'],
  ];

  return html`
    <section class="panel">
      <div class="panel-head">
        <h2>Status</h2>
        <div class="status-head-right">
          <div class="memory-entry-actions">
            <button onClick=${() => goMemory(detail.name, 'episodes')}>Episodes</button>
            <button class="secondary" onClick=${() => goMemory(detail.name, 'knowledge')}>Knowledge</button>
          </div>
          <span class="meta">Last heartbeat: ${status.last_heartbeat || 'none'}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:13px">
        <span style="color:var(--muted);font-weight:700">Interval</span>
        <input type="number" min="1" value=${intervalVal} onInput=${onIntervalChange}
          style="width:60px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;font:inherit;font-size:13px;text-align:right" />
        <span>min</span>
        <button onClick=${onSetInterval} style="padding:4px 10px;font-size:12px">Set</button>
        <span class="meta">${intervalResult}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:13px">
        <span style="color:var(--muted);font-weight:700">Passive Mode</span>
        <button onClick=${onTogglePassive} style="padding:4px 10px;font-size:12px">${passive ? 'ON' : 'OFF'}</button>
        <span class="meta" style="font-size:12px">Only wake on messages</span>
        <span class="meta">${passiveResult}</span>
      </div>
      <div class="detail-status-grid">
        ${facts.map(([label, value]) => html`
          <div key=${label} class="detail-fact">
            <span>${label}</span><strong>${String(value)}</strong>
          </div>
        `)}
      </div>
      <${SchedulePanel} name=${detail.name} schedule=${detail.schedule} />
      <${CompactPanel} name=${detail.name} />
    </section>
  `;
}
