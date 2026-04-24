import { html } from '../../vendor/htm.mjs';
import { useEffect } from '../../vendor/preact-hooks.mjs';
import { useStore } from '../useStore.js';
import { loadMetrics } from '../main.js';


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

function MetricCard({ title, rows }) {
  return html`
    <div class="metric-card">
      <h3>${title}</h3>
      ${rows.map(([label, value]) => html`
        <div key=${label} class="metric-row">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `)}
    </div>
  `;
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
  const provider = useStore((s) => s.detail?.provider);

  useEffect(() => {
    if (name && !metrics && !error) loadMetrics(name);
  }, [name]);

  const heartbeat = metrics?.heartbeat || {};
  const compact = metrics?.compact || {};
  const tokens = metrics?.tokens || {};
  const lastTurn = tokens.last_turn || {};
  const lifetime = tokens.lifetime || {};

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
          ]}
        />
        <${MetricCard}
          title="Tokens"
          rows=${tokenRows(provider, lastTurn, lifetime)}
        />
      </div>
    </section>
  `;
}
