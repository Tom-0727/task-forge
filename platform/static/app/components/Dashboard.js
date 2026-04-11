import { html } from '../../vendor/htm.mjs';
import { useStore } from '../useStore.js';
import { openModal } from '../main.js';
import { AgentCard } from './AgentCard.js';
import { UsagePanel } from './UsagePanel.js';
import { ConnectionsPanel } from './ConnectionsPanel.js';
import { nowText } from '../util.js';


export function Dashboard() {
  const overview = useStore((s) => s.overview);
  const error = useStore((s) => s.overviewError);
  const lastSync = useStore((s) => s.lastSync);

  const agents = overview ? overview.agents : [];
  const connections = overview ? overview.connections : [];
  const usage = overview ? overview.usage : null;

  const running = agents.filter(
    (a) => a.status && a.status.state === 'running' && a.status.runner_alive,
  ).length;

  const syncText = error
    ? `Sync failed: ${error}`
    : lastSync
    ? `Last sync ${nowText(lastSync)}`
    : 'Loading…';

  return html`
    <div>
      <header class="top">
        <div>
          <p class="kicker">Dashboard</p>
          <h1>Agent Platform</h1>
        </div>
        <div class="top-actions">
          <span class="meta">${syncText}</span>
          <button onClick=${() => openModal('import')}>Import</button>
          <button onClick=${() => openModal('create')}>+ New Agent</button>
        </div>
      </header>

      <${UsagePanel} usage=${usage} />

      <section class="panel">
        <div class="panel-head">
          <h2>Agents</h2>
          <span class="meta">Active: ${running} / ${agents.length} agents</span>
        </div>
        <div class="agents-grid">
          ${agents.map((a) => html`<${AgentCard} key=${a.name} agent=${a} />`)}
        </div>
      </section>

      <${ConnectionsPanel} agents=${agents} connections=${connections} />
    </div>
  `;
}
