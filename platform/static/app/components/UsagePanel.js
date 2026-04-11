import { html } from '../../vendor/htm.mjs';


function UsageRow({ label, percent, resets }) {
  const pct = Math.max(0, Math.min(100, percent));
  const cls = pct < 10 ? 'danger' : pct < 25 ? 'warn' : '';
  return html`
    <div>
      <div class="usage-row">
        <span class="label">${label}</span>
        <div class="usage-bar"><div class=${`fill ${cls}`} style=${`width:${pct}%`}></div></div>
        <span class="val">${pct}%</span>
      </div>
      ${resets ? html`<div class="usage-reset">resets ${resets}</div>` : null}
    </div>
  `;
}

function claudeRows(cl) {
  const rows = [];
  if (typeof cl.session_percent_used === 'number') {
    rows.push(html`<${UsageRow} key="s" label="Session" percent=${100 - cl.session_percent_used} resets=${cl.session_resets} />`);
  }
  if (typeof cl.week_percent_used === 'number') {
    rows.push(html`<${UsageRow} key="w" label="Week" percent=${100 - cl.week_percent_used} resets=${cl.week_resets} />`);
  }
  return rows;
}

function codexRows(cx) {
  const rows = [];
  if (typeof cx['5h_percent_left'] === 'number') {
    rows.push(html`<${UsageRow} key="5h" label="5h" percent=${cx['5h_percent_left']} resets=${cx['5h_resets']} />`);
  }
  if (typeof cx.weekly_percent_left === 'number') {
    rows.push(html`<${UsageRow} key="wk" label="Weekly" percent=${cx.weekly_percent_left} resets=${cx.weekly_resets} />`);
  }
  if (cx.spark) {
    rows.push(html`<div key="spark-h" class="usage-section">Spark</div>`);
    if (typeof cx.spark['5h_percent_left'] === 'number') {
      rows.push(html`<${UsageRow} key="s5h" label="5h" percent=${cx.spark['5h_percent_left']} resets=${cx.spark['5h_resets']} />`);
    }
    if (typeof cx.spark.weekly_percent_left === 'number') {
      rows.push(html`<${UsageRow} key="swk" label="Weekly" percent=${cx.spark.weekly_percent_left} resets=${cx.spark.weekly_resets} />`);
    }
  }
  return rows;
}

export function UsagePanel({ usage }) {
  if (!usage || (!usage.claude && !usage.codex && !usage.errors)) {
    return null;
  }

  const meta = usage.updated_at
    ? `Updated ${usage.updated_at.replace('T', ' ').replace('Z', ' UTC')} · refreshes hourly`
    : 'refreshes hourly';

  const cl = usage.claude;
  const cx = usage.codex;
  const clErr = (usage.errors && usage.errors.claude) || 'unavailable';
  const cxErr = (usage.errors && usage.errors.codex) || 'unavailable';

  return html`
    <section class="panel">
      <div class="panel-head">
        <h2>LLM Quota</h2>
        <span class="meta">${meta}</span>
      </div>
      <div class="usage-grid">
        <div class="usage-card">
          <div class="usage-title">Claude</div>
          ${cl
            ? (claudeRows(cl).length ? claudeRows(cl) : html`<div class="usage-empty">no data</div>`)
            : html`<div class="usage-empty">${clErr}</div>`
          }
        </div>
        <div class="usage-card">
          <div class="usage-title">
            Codex ${cx && cx.model ? html`<span class="sub">${cx.model}</span>` : null}
          </div>
          ${cx
            ? (codexRows(cx).length ? codexRows(cx) : html`<div class="usage-empty">no data</div>`)
            : html`<div class="usage-empty">${cxErr}</div>`
          }
        </div>
      </div>
    </section>
  `;
}
