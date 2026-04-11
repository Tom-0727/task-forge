import { html } from '../../vendor/htm.mjs';
import { useRef, useEffect } from '../../vendor/preact-hooks.mjs';
import { useStore } from '../useStore.js';
import { setHistoryContact } from '../main.js';


export function HistoryPanel({ detail }) {
  const historyContact = useStore((s) => s.historyContact);
  const contacts = detail.contacts || [];
  const messages = detail.messages || [];
  const historyRef = useRef(null);

  // Stick to bottom when user is already near it.
  useEffect(() => {
    const el = historyRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages.length, messages.length ? messages[messages.length - 1].id : '']);

  const options = contacts.length
    ? contacts
    : [{ name: 'human', type: 'human' }];

  return html`
    <section class="panel">
      <div class="panel-head">
        <h2>Mailbox History</h2>
        <div style="display:flex;align-items:center;gap:8px">
          <select value=${historyContact} onChange=${(e) => setHistoryContact(e.target.value)}
            style="padding:3px 6px;border:1px solid var(--line);border-radius:6px;font:inherit;font-size:12px">
            ${options.map((c) => html`<option key=${c.name} value=${c.name}>${c.name}</option>`)}
          </select>
          <span class="meta">Latest 50 messages</span>
        </div>
      </div>
      <div ref=${historyRef} class="history">
        ${messages.map((item) => {
          const sender = item.from || item.role || '';
          const isHuman = sender === 'human';
          return html`
            <div key=${item.id || `${item.ts}-${sender}`} class=${`msg ${isHuman ? 'human' : 'agent'}`}>
              <div class="msg-meta">
                ${item.ts} · ${sender}${item.to ? ' → ' + item.to : ''} · ${item.task_id}
              </div>
              <div class=${`bubble ${isHuman ? 'human' : 'agent'}`}>${item.message}</div>
            </div>
          `;
        })}
      </div>
    </section>
  `;
}
