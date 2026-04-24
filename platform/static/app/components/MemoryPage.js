import { html } from '../../vendor/htm.mjs';
import { useStore } from '../useStore.js';
import { goDetail } from '../main.js';
import { MemoryPanel } from './MemoryPanel.js';


export function MemoryPage() {
  const name = useStore((s) => s.currentAgent);
  const kind = useStore((s) => s.memoryKind);
  if (!name) return null;
  const title = kind === 'knowledge' ? 'Knowledge' : 'Episodes';

  return html`
    <div class="memory-page">
      <div class="detail-header memory-page-header">
        <button class="back-btn" onClick=${() => goDetail(name)}>← Agent</button>
        <h1>${name} ${title}</h1>
      </div>
      <${MemoryPanel} name=${name} />
    </div>
  `;
}
