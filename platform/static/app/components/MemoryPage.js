import { html } from '../../vendor/htm.mjs';
import { useStore } from '../useStore.js';
import { goDetail } from '../main.js';
import { MemoryPanel } from './MemoryPanel.js';


export function MemoryPage() {
  const name = useStore((s) => s.currentAgent);
  if (!name) return null;

  return html`
    <div class="memory-page">
      <div class="detail-header memory-page-header">
        <button class="back-btn" onClick=${() => goDetail(name)}>← Agent</button>
        <h1>${name} Memory</h1>
      </div>
      <${MemoryPanel} name=${name} />
    </div>
  `;
}
