import { html } from '../../vendor/htm.mjs';
import { useStore } from '../useStore.js';
import { goDetail } from '../main.js';
import { TodoPanel } from './TodoPanel.js';


export function TodoPage() {
  const name = useStore((s) => s.currentAgent);
  if (!name) return null;

  return html`
    <div class="todo-page">
      <div class="detail-header memory-page-header">
        <button class="back-btn" onClick=${() => goDetail(name)}>← Agent</button>
        <h1>${name} Todos</h1>
      </div>
      <${TodoPanel} name=${name} />
    </div>
  `;
}
