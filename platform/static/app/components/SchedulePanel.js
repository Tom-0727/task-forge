import { html } from '../../vendor/htm.mjs';
import { useState, useEffect } from '../../vendor/preact-hooks.mjs';
import * as api from '../api.js';
import { refreshCurrent } from '../main.js';


const DAY_LABELS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function emptyWindow() {
  return { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' };
}

export function SchedulePanel({ name, schedule }) {
  const [windows, setWindows] = useState(() => (schedule && schedule.windows) ? schedule.windows.map((w) => ({ ...w, days: [...w.days] })) : []);
  const [tz, setTz] = useState((schedule && schedule.timezone) || 'Asia/Shanghai');
  const [result, setResult] = useState('');

  useEffect(() => {
    setWindows(schedule && schedule.windows ? schedule.windows.map((w) => ({ ...w, days: [...w.days] })) : []);
    setTz((schedule && schedule.timezone) || 'Asia/Shanghai');
  }, [schedule]);

  const toggleDay = (wIdx, d) => {
    setWindows((prev) => prev.map((w, i) => {
      if (i !== wIdx) return w;
      const has = w.days.includes(d);
      return { ...w, days: has ? w.days.filter((x) => x !== d) : [...w.days, d].sort() };
    }));
  };

  const updateField = (wIdx, field, val) => {
    setWindows((prev) => prev.map((w, i) => (i === wIdx ? { ...w, [field]: val } : w)));
  };

  const removeWindow = (wIdx) => {
    setWindows((prev) => prev.filter((_, i) => i !== wIdx));
  };

  const addWindow = () => setWindows((prev) => [...prev, emptyWindow()]);

  const onSave = async () => {
    const normalized = windows
      .filter((w) => w.days.length > 0 && w.start && w.end)
      .map((w) => ({ days: [...w.days].sort(), start: w.start, end: w.end }));
    if (normalized.length === 0) {
      setResult('Add at least one window, or use Clear for 24/7');
      return;
    }
    setResult('Saving…');
    try {
      await api.saveSchedule(name, { timezone: tz.trim() || 'UTC', windows: normalized });
      setResult('Saved');
      setTimeout(() => setResult(''), 1500);
      refreshCurrent();
    } catch (err) {
      setResult('Failed: ' + (err.message || 'unknown'));
    }
  };

  const onClear = async () => {
    setResult('Clearing…');
    try {
      await api.saveSchedule(name, null);
      setWindows([]);
      setResult('Cleared (24/7)');
      setTimeout(() => setResult(''), 1500);
      refreshCurrent();
    } catch (err) {
      setResult('Failed: ' + (err.message || 'unknown'));
    }
  };

  return html`
    <div style="margin-top:14px;border-top:1px dashed var(--line);padding-top:12px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="color:var(--muted);font-weight:700;font-size:13px">Work Schedule</span>
        <span class="meta">${result}</span>
      </div>
      <div>
        ${windows.map((w, i) => html`
          <div key=${i} class="sched-row">
            ${[1, 2, 3, 4, 5, 6, 7].map((d) => html`
              <span key=${d}
                class=${`sched-day ${w.days.includes(d) ? 'active' : ''}`}
                onClick=${() => toggleDay(i, d)}>
                ${DAY_LABELS[d]}
              </span>
            `)}
            <input type="time" class="sched-start" value=${w.start}
              onInput=${(e) => updateField(i, 'start', e.target.value)} />
            <span>-</span>
            <input type="time" class="sched-end" value=${w.end}
              onInput=${(e) => updateField(i, 'end', e.target.value)} />
            <span class="sched-del" onClick=${() => removeWindow(i)}>×</span>
          </div>
        `)}
      </div>
      <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
        <button class="secondary" onClick=${addWindow} style="padding:4px 10px;font-size:12px">+ Add Window</button>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="color:var(--muted);font-size:12px">Timezone</span>
          <input type="text" value=${tz} onInput=${(e) => setTz(e.target.value)}
            style="width:140px;padding:4px 6px;border:1px solid var(--line);border-radius:6px;font:inherit;font-size:12px" />
        </div>
        <button onClick=${onSave} style="padding:4px 10px;font-size:12px">Save</button>
        <button class="secondary" onClick=${onClear} style="padding:4px 10px;font-size:12px">Clear (24/7)</button>
      </div>
    </div>
  `;
}
