import { html } from '../../vendor/htm.mjs';
import { useState } from '../../vendor/preact-hooks.mjs';
import * as api from '../api.js';
import { closeModal, refreshCurrent } from '../main.js';
import { Modal } from './Modal.js';


export function ImportModal() {
  const [workdir, setWorkdir] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [result, setResult] = useState('');

  const onImport = async () => {
    setResult('Importing…');
    if (!workdir.trim()) {
      setResult('Workdir is required');
      return;
    }
    try {
      await api.importAgent({
        workdir: workdir.trim(),
        tags: tagsText.split(',').map((s) => s.trim()).filter(Boolean),
      });
      closeModal();
      refreshCurrent();
    } catch (err) {
      setResult('Error: ' + (err.message || 'import failed'));
    }
  };

  return html`
    <${Modal} onClose=${closeModal}>
      <h2>Import Existing Agent</h2>
      <div class="form-group">
        <label>Workdir *</label>
        <input type="text" value=${workdir} onInput=${(e) => setWorkdir(e.target.value)}
          placeholder="/Users/tom/agents/existing-agent" />
      </div>
      <div class="form-group">
        <label>Tags (comma-separated)</label>
        <input type="text" value=${tagsText} onInput=${(e) => setTagsText(e.target.value)}
          placeholder="imported" />
      </div>
      <div class="row">
        <button onClick=${onImport}>Import</button>
        <button class="secondary" onClick=${closeModal}>Cancel</button>
        <span class="meta">${result}</span>
      </div>
    <//>
  `;
}
