import { html } from '../../vendor/htm.mjs';
import { useState } from '../../vendor/preact-hooks.mjs';
import * as api from '../api.js';
import { closeModal, refreshCurrent } from '../main.js';
import { Modal } from './Modal.js';


export function CreateModal() {
  const [goal, setGoal] = useState('');
  const [firstInstruction, setFirstInstruction] = useState('');
  const [provider, setProvider] = useState('claude');
  const [workdir, setWorkdir] = useState('');
  const [agentName, setAgentName] = useState('');
  const [interval, setIntervalVal] = useState('20');
  const [tagsText, setTagsText] = useState('');
  const [result, setResult] = useState('');

  const onCreate = async () => {
    setResult('Creating…');
    if (!goal.trim() || !firstInstruction.trim() || !workdir.trim()) {
      setResult('Goal, first instruction, and workdir are required');
      return;
    }
    try {
      await api.createAgent({
        goal: goal.trim(),
        first_instruction: firstInstruction.trim(),
        provider,
        workdir: workdir.trim(),
        agent_name: agentName.trim(),
        interval: parseInt(interval, 10) || 20,
        tags: tagsText.split(',').map((s) => s.trim()).filter(Boolean),
      });
      closeModal();
      refreshCurrent();
    } catch (err) {
      let msg = 'Error: ' + (err.message || 'create failed');
      if (err.data && err.data.stderr) msg += '\n' + err.data.stderr;
      setResult(msg);
    }
  };

  return html`
    <${Modal} onClose=${closeModal}>
      <h2>Create New Agent</h2>
      <div class="form-group">
        <label>Goal *</label>
        <textarea value=${goal} onInput=${(e) => setGoal(e.target.value)}
          placeholder="Agent's task goal" style="min-height:60px"></textarea>
      </div>
      <div class="form-group">
        <label>First Instruction *</label>
        <textarea value=${firstInstruction} onInput=${(e) => setFirstInstruction(e.target.value)}
          placeholder="Agent's first concrete instruction" style="min-height:80px"></textarea>
      </div>
      <div class="form-group">
        <label>Provider *</label>
        <select value=${provider} onChange=${(e) => setProvider(e.target.value)}>
          <option value="claude">Claude</option>
          <option value="codex">Codex</option>
        </select>
      </div>
      <div class="form-group">
        <label>Workdir *</label>
        <input type="text" value=${workdir} onInput=${(e) => setWorkdir(e.target.value)}
          placeholder="/Users/tom/agents/my-agent" />
      </div>
      <div class="form-group">
        <label>Agent Name (optional)</label>
        <input type="text" value=${agentName} onInput=${(e) => setAgentName(e.target.value)}
          placeholder="auto-derived from workdir" />
      </div>
      <div class="form-group">
        <label>Interval (minutes)</label>
        <input type="text" value=${interval} onInput=${(e) => setIntervalVal(e.target.value)} />
      </div>
      <div class="form-group">
        <label>Tags (comma-separated)</label>
        <input type="text" value=${tagsText} onInput=${(e) => setTagsText(e.target.value)}
          placeholder="security, auth" />
      </div>
      <div class="row">
        <button onClick=${onCreate}>Create</button>
        <button class="secondary" onClick=${closeModal}>Cancel</button>
        <span class="meta" style="white-space:pre-wrap">${result}</span>
      </div>
    <//>
  `;
}
