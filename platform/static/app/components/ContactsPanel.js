import { html } from '../../vendor/htm.mjs';


export function ContactsPanel({ contacts }) {
  return html`
    <section class="panel">
      <div class="panel-head">
        <h2>Contacts</h2>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${contacts.map((c) => html`
          <span key=${c.name} class="tag">${c.name} (${c.type})</span>
        `)}
      </div>
    </section>
  `;
}
