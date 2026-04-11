import { html } from '../../vendor/htm.mjs';
import { useState } from '../../vendor/preact-hooks.mjs';
import { useStore } from '../useStore.js';
import * as api from '../api.js';
import { refreshCurrent } from '../main.js';


export function SendPanel({ name }) {
  const contact = useStore((s) => s.historyContact);
  const [text, setText] = useState('');
  const [result, setResult] = useState('');
  const isHuman = contact === 'human';

  const onSend = async () => {
    const msg = text.trim();
    if (!msg) {
      setResult('Message is empty');
      return;
    }
    setResult('');
    try {
      const data = await api.sendMessage(name, msg);
      setText('');
      setResult('Sent: ' + (data.entry ? data.entry.id : 'ok'));
      setTimeout(refreshCurrent, 400);
    } catch (err) {
      setResult('Error: ' + (err.message || 'send failed'));
    }
  };

  return html`
    <section class="panel" style=${isHuman ? '' : 'opacity:0.5'}>
      <h2>Send Message</h2>
      <textarea
        value=${text}
        onInput=${(e) => setText(e.target.value)}
        disabled=${!isHuman}
        placeholder=${isHuman ? 'Type message...' : 'Cannot send messages to agent-to-agent conversations'}
      ></textarea>
      <div class="row">
        <button onClick=${onSend} disabled=${!isHuman}>Send</button>
        <span class="meta">${result}</span>
      </div>
    </section>
  `;
}
