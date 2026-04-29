import { html } from '../../vendor/htm.mjs';
import { useEffect, useState } from '../../vendor/preact-hooks.mjs';
import { useStore } from '../useStore.js';
import { loadMetrics } from '../main.js';
import * as api from '../api.js';


function fmtNum(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat().format(value);
}

function fmtTokens(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(1)}k`;
}

function fmtSeconds(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  if (value < 60) return `${value.toFixed(1)}s`;
  return `${(value / 60).toFixed(1)}m`;
}

function fmtTs(value) {
  return value || '-';
}

function MetricCard({ title, rows, children = null }) {
  return html`
    <div class="metric-card">
      <h3>${title}</h3>
      ${rows.map(([label, value]) => html`
        <div key=${label} class="metric-row">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `)}
      ${children}
    </div>
  `;
}

function compactStateText(manual) {
  if (!manual || !manual.state) return 'idle';
  if (manual.state === 'succeeded') return 'succeeded';
  if (manual.state === 'failed') return 'failed';
  if (manual.state === 'running') return 'running';
  if (manual.state === 'pending') return 'pending';
  return manual.state;
}

function tokenRows(provider, lastTurn, lifetime) {
  const rows = [
    ['Last Turn input / output', `${fmtTokens(lastTurn.input_tokens)} / ${fmtTokens(lastTurn.output_tokens)}`],
    ['Lifetime input / output', `${fmtTokens(lifetime.input_tokens)} / ${fmtTokens(lifetime.output_tokens)}`],
  ];
  if (provider === 'codex') {
    rows.splice(1, 0, ['Last Turn cached', fmtTokens(lastTurn.cached_input_tokens)]);
    rows.push(['Lifetime cached', fmtTokens(lifetime.cached_input_tokens)]);
  } else {
    rows.splice(1, 0, ['Last Turn cache read / create', `${fmtTokens(lastTurn.cache_read_input_tokens)} / ${fmtTokens(lastTurn.cache_creation_input_tokens)}`]);
    rows.push(['Lifetime cache read / create', `${fmtTokens(lifetime.cache_read_input_tokens)} / ${fmtTokens(lifetime.cache_creation_input_tokens)}`]);
  }
  return rows;
}

export function ObservabilityPanel({ name }) {
  const metrics = useStore((s) => s.metrics);
  const error = useStore((s) => s.metricsError);
  const detail = useStore((s) => s.detail);
  const provider = detail?.provider;
  const runnerAlive = Boolean(detail?.status?.runtime_alive);
  const [compactBusy, setCompactBusy] = useState(false);
  const [compactResult, setCompactResult] = useState('');

  useEffect(() => {
    if (name && !metrics && !error) loadMetrics(name);
  }, [name]);

  const heartbeat = metrics?.heartbeat || {};
  const compact = metrics?.compact || {};
  const manualCompact = metrics?.manual_compact || null;
  const tokens = metrics?.tokens || {};
  const lastTurn = tokens.last_turn || {};
  const lifetime = tokens.lifetime || {};
  const compactActive = manualCompact?.state === 'pending' || manualCompact?.state === 'running';
  const compactUnsupported = provider !== 'codex' && provider !== 'claude';
  const compactDisabled = compactBusy || compactActive || compactUnsupported || !runnerAlive;
  const compactDisabledReason = compactUnsupported
    ? 'Unsupported provider'
    : !runnerAlive
      ? 'Runner offline'
      : compactActive
        ? 'In progress'
        : '';

  async function onCompactNow() {
    if (compactDisabled) return;
    setCompactBusy(true);
    setCompactResult('');
    try {
      await api.compactAgent(name);
      setCompactResult('Requested');
      await loadMetrics(name);
    } catch (err) {
      setCompactResult(`Failed: ${err.message || 'unknown'}`);
    } finally {
      setCompactBusy(false);
    }
  }

  return html`
    <section class="panel">
      <div class="panel-head">
        <h2>Observability</h2>
        <span class="meta">${error ? `Error: ${error}` : `Updated: ${fmtTs(metrics?.last_updated)}`}</span>
      </div>
      <div class="metric-grid">
        <${MetricCard}
          title="Heartbeats"
          rows=${[
            ['Count', fmtNum(heartbeat.count)],
            ['Last duration', fmtSeconds(heartbeat.last_duration_seconds)],
            ['Avg duration', fmtSeconds(heartbeat.avg_duration_seconds)],
          ]}
        />
        <${MetricCard}
          title="Compaction"
          rows=${[
            ['Count since last', fmtNum(compact.count_since_last)],
            ['Total compacts', fmtNum(compact.total_compacts)],
            ['Last compact at', fmtTs(compact.last_compact_at)],
            ['Manual status', compactStateText(manualCompact)],
          ]}
        >
          <div class="metric-actions">
            <button onClick=${onCompactNow} disabled=${compactDisabled}>
              ${compactBusy ? 'Requesting...' : 'Compact now'}
            </button>
            <span class="meta">${compactResult || compactDisabledReason || fmtTs(manualCompact?.finished_at)}</span>
          </div>
          ${manualCompact?.error ? html`<div class="meta metric-note">${manualCompact.error}</div>` : null}
        <//>
        <${MetricCard}
          title="Tokens"
          rows=${tokenRows(provider, lastTurn, lifetime)}
        />
      </div>
    </section>
  `;
}
