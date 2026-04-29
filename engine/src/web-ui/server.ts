import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import {
  resolvePaths,
  loadIdentity,
  readMetrics,
  readManualCompactStatus,
  utcnow,
  type AgentPaths,
  type AgentIdentity,
} from "../harness-core/index.js";
import { readMessages, appendMessage, writePendingMessage } from "../shared/mailbox-io.js";

function parseArgs(argv: string[]): { agentDir: string; port: number; host: string } {
  let agentDir = "";
  let port = 8080;
  let host = "127.0.0.1";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--agent-dir" && argv[i + 1]) agentDir = argv[++i];
    else if (argv[i] === "--port" && argv[i + 1]) port = Number(argv[++i]);
    else if (argv[i] === "--host" && argv[i + 1]) host = argv[++i];
  }
  if (!agentDir) throw new Error("web-ui: missing --agent-dir");
  return { agentDir, port, host };
}

function readText(file: string): string {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function pidStatus(file: string): { state: string; pid: string } {
  const raw = readText(file);
  if (!raw) return { state: "stopped", pid: "" };
  const pid = Number(raw);
  if (!Number.isFinite(pid)) return { state: "stale", pid: raw };
  return { state: isRunning(pid) ? "running" : "stale", pid: String(pid) };
}

function formatTs(value: string): string {
  const text = (value ?? "").trim();
  if (!text) return "none";
  const d = new Date(text);
  if (Number.isNaN(d.getTime())) return text.replace("T", " ").replace("Z", "").trim();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function buildStatus(paths: AgentPaths, identity: AgentIdentity): Record<string, unknown> {
  const heartbeat = readText(paths.heartbeatFile);
  const awaitingDir = paths.awaitingDir;
  let awaiting = false;
  try {
    awaiting = fs.statSync(awaitingDir).isDirectory() && fs.readdirSync(awaitingDir).length > 0;
  } catch {
    awaiting = false;
  }
  return {
    agent: identity.agent_name,
    interaction_mode: identity.interaction.mode,
    provider: identity.provider,
    runtime_state: readText(paths.stateFile) || "unknown",
    runner: pidStatus(path.join(paths.pidsDir, "runtime")),
    supervisor: pidStatus(path.join(paths.pidsDir, "supervisor")),
    bridge: pidStatus(path.join(paths.pidsDir, "bridge")),
    web_ui: pidStatus(path.join(paths.pidsDir, "web-ui")),
    last_heartbeat: heartbeat ? formatTs(heartbeat) : "none",
    awaiting_human: awaiting,
  };
}

function buildHistory(paths: AgentPaths, limit: number): Array<Record<string, string>> {
  const mb = path.join(paths.mailboxDir, "human.jsonl");
  const messages = readMessages(mb);
  return messages.slice(-limit).map((m) => ({
    id: String(m.id ?? ""),
    ts: formatTs(String(m.ts ?? "")),
    from: String(m.from ?? ""),
    to: String(m.to ?? ""),
    task_id: String(m.task_id ?? ""),
    message: String(m.message ?? ""),
  }));
}

const HTML = (agentName: string): string => `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${agentName} MailBox</title>
  <style>
    :root {
      --bg-0: #f4efe9; --bg-1: #e6f0ec;
      --card: rgba(255, 255, 255, 0.86);
      --ink: #1f2831; --muted: #5f6b78;
      --line: rgba(31, 40, 49, 0.14);
      --accent: #2f7a5f;
      --on-bg: #d5f2e5; --on-fg: #186246;
      --off-bg: #eceef0; --off-fg: #6c7782;
      --human-bg: #dff3e7; --agent-bg: #f4f4f1;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; color: var(--ink);
      font-family: "Space Grotesk", "Avenir Next", "Segoe UI", sans-serif;
      background:
        radial-gradient(circle at 12% 10%, rgba(47, 122, 95, 0.16), transparent 45%),
        radial-gradient(circle at 85% 90%, rgba(185, 122, 91, 0.16), transparent 48%),
        linear-gradient(140deg, var(--bg-0), var(--bg-1));
    }
    .app { width: min(980px, 100%); margin: 0 auto; padding: 28px 16px 40px; }
    .top { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
    .top-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    h1 { margin: 2px 0 0; font-size: clamp(1.6rem, 3vw, 2rem); }
    .kicker { margin: 0; text-transform: uppercase; letter-spacing: 0.09em; color: var(--muted); font-size: 12px; font-weight: 700; }
    .panel { border: 1px solid var(--line); border-radius: 16px; padding: 16px; margin: 12px 0;
      background: var(--card); backdrop-filter: blur(6px); box-shadow: 0 10px 30px rgba(25, 38, 32, 0.07); }
    .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
    h2, h3 { margin: 0; font-size: 1.02rem; }
    .meta { color: var(--muted); font-size: 12px; }
    .toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); user-select: none; }
    .toggle input { accent-color: var(--accent); }
    .status-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 12px; }
    .status-card { border: 1px solid var(--line); border-radius: 12px; padding: 10px; display: grid; gap: 8px; background: #fff; }
    .status-title { font-size: 13px; color: var(--muted); }
    .status-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .badge { border-radius: 999px; padding: 3px 9px; font-size: 11px; font-weight: 700; letter-spacing: 0.03em; }
    .badge.on { background: var(--on-bg); color: var(--on-fg); }
    .badge.off { background: var(--off-bg); color: var(--off-fg); }
    .status-meta { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
    .fact { border: 1px dashed var(--line); border-radius: 10px; padding: 8px 10px; background: rgba(255, 255, 255, 0.58);
      display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
    .pills { display: flex; flex-wrap: wrap; gap: 8px; }
    .pill { border-radius: 999px; padding: 6px 11px; font-size: 12px; font-weight: 700; }
    .pill.on { background: var(--on-bg); color: var(--on-fg); }
    .pill.off { background: var(--off-bg); color: var(--off-fg); }
    .metric-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .metric-card { border: 1px solid var(--line); border-radius: 12px; padding: 12px; background: #fff;
      display: grid; gap: 6px; }
    .metric-title { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; }
    .metric-row { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
    .metric-row span:last-child { font-variant-numeric: tabular-nums; font-weight: 600; }
    .metric-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 6px; }
    .metric-actions button { padding: 5px 10px; font-size: 12px; border-radius: 8px; }
    .metric-note { overflow-wrap: anywhere; }
    .bar { height: 8px; border-radius: 6px; background: var(--off-bg); overflow: hidden; }
    .bar > div { height: 100%; background: var(--accent); transition: width 0.4s ease; }
    @media (max-width: 760px) { .metric-grid { grid-template-columns: 1fr; } }
    .history { max-height: 48vh; overflow: auto; display: grid; gap: 10px; padding-right: 4px; }
    .msg { display: grid; gap: 4px; }
    .msg.human { justify-items: end; }
    .msg.agent { justify-items: start; }
    .msg-meta { color: var(--muted); font-size: 12px; }
    .bubble { max-width: min(780px, 100%); border-radius: 14px; border: 1px solid var(--line); padding: 10px 12px;
      white-space: pre-wrap; word-break: break-word; line-height: 1.45; box-shadow: 0 5px 16px rgba(31, 40, 49, 0.06); }
    .bubble.human { background: var(--human-bg); }
    .bubble.agent { background: var(--agent-bg); }
    .row { margin-top: 10px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    textarea { width: 100%; min-height: 112px; border-radius: 12px; border: 1px solid var(--line);
      padding: 12px; font: inherit; color: inherit; background: rgba(255, 255, 255, 0.86); resize: vertical; }
    button { border: none; border-radius: 10px; padding: 9px 14px; font: inherit; font-size: 14px; font-weight: 700;
      color: #fff; background: var(--accent); cursor: pointer; }
    button:hover { filter: brightness(0.95); }
    button:disabled { opacity: 0.7; cursor: not-allowed; }
    @media (max-width: 760px) {
      .status-grid { grid-template-columns: 1fr; }
      .facts { grid-template-columns: 1fr; }
      .top { align-items: flex-start; flex-direction: column; }
    }
  </style>
</head>
<body>
  <main class="app">
    <header class="top">
      <div>
        <p class="kicker">MailBox</p>
        <h1>${agentName} MailBox</h1>
      </div>
      <div class="top-actions">
        <label class="toggle">
          <input id="autoSync" type="checkbox" checked onchange="toggleAutoSync()" />
          Auto Sync
        </label>
        <span id="syncMeta" class="meta">Syncing...</span>
        <button onclick="refreshAll(true)">Refresh</button>
      </div>
    </header>

    <section class="panel">
      <div class="panel-head"><h2>Status</h2><span id="heartbeatMeta" class="meta"></span></div>
      <div class="status-grid">
        <div class="status-card"><div class="status-title">Runner</div>
          <div class="status-row"><span id="runnerBadge" class="badge off">OFF</span><span id="runnerMeta" class="status-meta">none</span></div></div>
        <div class="status-card"><div class="status-title">Bridge</div>
          <div class="status-row"><span id="bridgeBadge" class="badge off">OFF</span><span id="bridgeMeta" class="status-meta">none</span></div></div>
        <div class="status-card"><div class="status-title">MailBox UI</div>
          <div class="status-row"><span id="uiBadge" class="badge off">OFF</span><span id="uiMeta" class="status-meta">none</span></div></div>
      </div>
      <div class="facts">
        <div class="fact"><span>Agent</span><strong id="agentName">-</strong></div>
        <div class="fact"><span>Interaction Mode</span><strong id="interactionMode">-</strong></div>
        <div class="fact"><span>Provider</span><strong id="provider">-</strong></div>
        <div class="fact"><span>Runtime State</span><strong id="runtimeState">-</strong></div>
      </div>
      <div id="statusPills" class="pills"></div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Observability</h2><span id="metricsMeta" class="meta">—</span></div>
      <div class="metric-grid">
        <div class="metric-card">
          <div class="metric-title">Heartbeats</div>
          <div class="metric-row"><span>Count</span><span id="hbCount">—</span></div>
          <div class="metric-row"><span>Last</span><span id="hbLast">—</span></div>
          <div class="metric-row"><span>Avg</span><span id="hbAvg">—</span></div>
          <div class="metric-row"><span>Total</span><span id="hbTotal">—</span></div>
        </div>
        <div class="metric-card">
          <div class="metric-title">Compact</div>
          <div class="metric-row"><span id="compactProgressText">—</span><span id="compactProgressNum">—</span></div>
          <div class="bar"><div id="compactBar" style="width:0%"></div></div>
          <div class="metric-row"><span>Total</span><span id="compactTotal">—</span></div>
          <div class="metric-row"><span>Avg gap</span><span id="compactAvgGap">—</span></div>
          <div class="metric-row"><span>Last at</span><span id="compactLastAt">—</span></div>
          <div class="metric-row"><span>Manual</span><span id="compactManual">—</span></div>
          <div class="metric-actions"><button id="compactNowButton" onclick="compactNow()">Compact now</button><span id="compactResult" class="meta"></span></div>
          <div id="compactError" class="meta metric-note"></div>
        </div>
        <div class="metric-card">
          <div class="metric-title">Tokens (last turn)</div>
          <div class="metric-row"><span>Context est.</span><span id="tokCtx">—</span></div>
          <div class="metric-row"><span>Input</span><span id="tokIn">—</span></div>
          <div class="metric-row"><span>Output</span><span id="tokOut">—</span></div>
          <div class="metric-row"><span>Cache read</span><span id="tokCacheRead">—</span></div>
          <div class="metric-row"><span>Cache create</span><span id="tokCacheCreate">—</span></div>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>Mailbox History</h2><span class="meta">Latest 50 messages</span></div>
      <div id="history" class="history"></div>
    </section>

    <section class="panel">
      <h2>Send Human Message</h2>
      <textarea id="message" placeholder="Type message"></textarea>
      <div class="row"><button onclick="sendMessage()">Send</button><span id="sendResult" class="meta"></span></div>
    </section>
  </main>
<script>
let autoSyncTimer = null, statusBusy = false, historyBusy = false, metricsBusy = false, compactBusy = false;
let lastStatusFingerprint = '', lastHistoryFingerprint = '', lastMetricsFingerprint = '';
let currentProvider = '', runnerOnline = false, compactActive = false;
function nowText() { return new Date().toLocaleTimeString(); }
function setSyncMeta(t) { document.getElementById('syncMeta').textContent = t; }
function shouldStickToBottom(root) { return (root.scrollHeight - root.scrollTop - root.clientHeight) < 80; }
function setBadge(id, on) { const n = document.getElementById(id); n.textContent = on ? 'OPEN' : 'OFF'; n.className = 'badge ' + (on ? 'on' : 'off'); }
function setProcess(prefix, p) {
  const on = p && p.state === 'running';
  setBadge(prefix + 'Badge', on);
  const state = p && p.state ? p.state : 'unknown';
  const pid = p && p.pid ? 'PID ' + p.pid : 'PID none';
  document.getElementById(prefix + 'Meta').textContent = pid + ' \u00b7 ' + state;
}
function renderPills(d) {
  const items = [
    {label: 'Awaiting Human', on: Boolean(d.awaiting_human)},
    {label: 'Runner Online', on: d.runner && d.runner.state === 'running'},
    {label: 'Bridge Online', on: d.bridge && d.bridge.state === 'running'},
    {label: 'UI Online', on: d.web_ui && d.web_ui.state === 'running'},
  ];
  const root = document.getElementById('statusPills');
  root.innerHTML = '';
  for (const it of items) {
    const n = document.createElement('span');
    n.className = 'pill ' + (it.on ? 'on' : 'off');
    n.textContent = it.label + ': ' + (it.on ? 'ON' : 'OFF');
    root.appendChild(n);
  }
}
function updateCompactButton() {
  const btn = document.getElementById('compactNowButton');
  if (!btn) return;
  const unsupported = currentProvider !== 'codex' && currentProvider !== 'claude';
  btn.disabled = compactBusy || compactActive || unsupported || !runnerOnline;
  btn.textContent = compactBusy ? 'Requesting...' : 'Compact now';
  if (unsupported) document.getElementById('compactResult').textContent = 'Unsupported provider';
  else if (!runnerOnline) document.getElementById('compactResult').textContent = 'Runner offline';
  else if (compactActive) document.getElementById('compactResult').textContent = 'In progress';
}
function statusFingerprint(d) {
  return [d.agent||'', d.interaction_mode||'', d.provider||'', d.runtime_state||'', d.last_heartbeat||'',
    d.awaiting_human?'1':'0',
    d.runner?(d.runner.state||'')+':'+(d.runner.pid||''):'',
    d.bridge?(d.bridge.state||'')+':'+(d.bridge.pid||''):'',
    d.web_ui?(d.web_ui.state||'')+':'+(d.web_ui.pid||''):''].join('|');
}
async function loadStatus(force = false) {
  if (statusBusy) return;
  statusBusy = true;
  try {
    const resp = await fetch('/api/status');
    const d = await resp.json();
    const fp = statusFingerprint(d);
    if (!force && fp === lastStatusFingerprint) return;
    lastStatusFingerprint = fp;
    setProcess('runner', d.runner);
    setProcess('bridge', d.bridge);
    setProcess('ui', d.web_ui);
    document.getElementById('agentName').textContent = d.agent || '-';
    document.getElementById('interactionMode').textContent = d.interaction_mode || '-';
    document.getElementById('provider').textContent = d.provider || '-';
    currentProvider = d.provider || '';
    runnerOnline = Boolean(d.runner && d.runner.state === 'running');
    document.getElementById('runtimeState').textContent = d.runtime_state || '-';
    document.getElementById('heartbeatMeta').textContent = 'Last heartbeat: ' + (d.last_heartbeat || 'none');
    renderPills(d);
    updateCompactButton();
  } finally { statusBusy = false; }
}
function renderMessage(item) {
  const wrap = document.createElement('div');
  const isHuman = item.from === 'human';
  wrap.className = 'msg ' + (isHuman ? 'human' : 'agent');
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.textContent = item.ts + ' \u00b7 ' + item.from + ' \u00b7 ' + item.task_id;
  wrap.appendChild(meta);
  const bubble = document.createElement('div');
  bubble.className = 'bubble ' + (isHuman ? 'human' : 'agent');
  bubble.textContent = item.message;
  wrap.appendChild(bubble);
  return wrap;
}
async function loadHistory() {
  if (historyBusy) return;
  historyBusy = true;
  try {
    const resp = await fetch('/api/history?limit=50');
    const d = await resp.json();
    const items = d.items || [];
    const last = items.length ? items[items.length - 1] : null;
    const fp = items.length + ':' + (last ? last.id : '') + ':' + (last ? last.ts : '');
    if (fp === lastHistoryFingerprint) return;
    lastHistoryFingerprint = fp;
    const root = document.getElementById('history');
    const keepBottom = shouldStickToBottom(root);
    root.innerHTML = '';
    for (const it of items) root.appendChild(renderMessage(it));
    if (keepBottom) root.scrollTop = root.scrollHeight;
  } finally { historyBusy = false; }
}
async function sendMessage() {
  const input = document.getElementById('message');
  const text = input.value.trim();
  const result = document.getElementById('sendResult');
  result.textContent = '';
  if (!text) { result.textContent = 'Message is empty'; return; }
  const resp = await fetch('/api/send', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({message: text}),
  });
  const d = await resp.json();
  if (!resp.ok) { result.textContent = 'Error: ' + (d.error || 'send failed'); return; }
  input.value = '';
  result.textContent = 'Sent as ' + d.id;
  await refreshAll(true);
}
async function compactNow() {
  if (compactBusy) return;
  compactBusy = true;
  document.getElementById('compactResult').textContent = '';
  document.getElementById('compactError').textContent = '';
  updateCompactButton();
  try {
    const resp = await fetch('/api/compact', { method: 'POST' });
    const d = await resp.json();
    if (!resp.ok) throw new Error(d.error || 'compact failed');
    document.getElementById('compactResult').textContent = 'Requested';
    await loadMetrics();
  } catch (err) {
    document.getElementById('compactResult').textContent = 'Failed: ' + (err && err.message ? err.message : 'unknown');
  } finally {
    compactBusy = false;
    updateCompactButton();
  }
}
function fmtNum(n) { if (typeof n !== 'number' || !isFinite(n)) return '—'; return n.toLocaleString(); }
function fmtSec(s) { if (typeof s !== 'number' || !isFinite(s)) return '—'; if (s < 60) return s.toFixed(1) + 's'; const m = Math.floor(s / 60), r = s - m * 60; return m + 'm ' + r.toFixed(0) + 's'; }
function fmtTs(s) { if (!s) return 'never'; const d = new Date(s); if (isNaN(d.getTime())) return s; const p = (n) => String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes()); }
async function loadMetrics() {
  if (metricsBusy) return;
  metricsBusy = true;
  try {
    const resp = await fetch('/api/metrics');
    const m = await resp.json();
    const fp = JSON.stringify([m.heartbeat, m.compact, m.manual_compact, m.tokens && m.tokens.estimated_context_tokens, m.tokens && m.tokens.last_turn, m.last_updated]);
    if (fp === lastMetricsFingerprint) return;
    lastMetricsFingerprint = fp;
    const hb = m.heartbeat || {}, c = m.compact || {}, t = (m.tokens && m.tokens.last_turn) || {};
    document.getElementById('hbCount').textContent = fmtNum(hb.count);
    document.getElementById('hbLast').textContent = fmtSec(hb.last_duration_seconds);
    document.getElementById('hbAvg').textContent = fmtSec(hb.avg_duration_seconds);
    document.getElementById('hbTotal').textContent = fmtSec(hb.total_duration_seconds);
    const thr = c.threshold || 0, cur = c.count_since_last || 0;
    const pct = thr > 0 ? Math.min(100, Math.round(cur * 100 / thr)) : 0;
    document.getElementById('compactProgressText').textContent = thr > 0 ? 'Progress' : 'Disabled';
    document.getElementById('compactProgressNum').textContent = thr > 0 ? (cur + ' / ' + thr) : '—';
    document.getElementById('compactBar').style.width = pct + '%';
    document.getElementById('compactTotal').textContent = fmtNum(c.total_compacts);
    document.getElementById('compactAvgGap').textContent = c.total_compacts ? (c.avg_heartbeats_between || 0).toFixed(2) + ' hb' : '—';
    document.getElementById('compactLastAt').textContent = fmtTs(c.last_compact_at);
    const manual = m.manual_compact || {};
    compactActive = manual.state === 'pending' || manual.state === 'running';
    document.getElementById('compactManual').textContent = manual.state || 'idle';
    document.getElementById('compactError').textContent = manual.error || '';
    if (!compactActive && !manual.error && !document.getElementById('compactResult').textContent) {
      document.getElementById('compactResult').textContent = manual.finished_at ? fmtTs(manual.finished_at) : '';
    }
    updateCompactButton();
    document.getElementById('tokCtx').textContent = fmtNum((m.tokens && m.tokens.estimated_context_tokens) || 0);
    document.getElementById('tokIn').textContent = fmtNum(t.input_tokens);
    document.getElementById('tokOut').textContent = fmtNum(t.output_tokens);
    document.getElementById('tokCacheRead').textContent = fmtNum(t.cache_read_input_tokens);
    document.getElementById('tokCacheCreate').textContent = t.cache_creation_input_tokens != null ? fmtNum(t.cache_creation_input_tokens) : (t.cached_input_tokens != null ? ('cached ' + fmtNum(t.cached_input_tokens)) : '—');
    document.getElementById('metricsMeta').textContent = 'Updated ' + fmtTs(m.last_updated);
  } finally { metricsBusy = false; }
}
async function refreshAll(force = false) {
  try { await Promise.all([loadStatus(force), loadHistory(), loadMetrics()]); setSyncMeta('Last sync ' + nowText()); }
  catch { setSyncMeta('Sync failed'); }
}
function toggleAutoSync() {
  const enabled = document.getElementById('autoSync').checked;
  if (!enabled) {
    if (autoSyncTimer) { clearInterval(autoSyncTimer); autoSyncTimer = null; }
    setSyncMeta('Auto sync off'); return;
  }
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  const interval = document.hidden ? 5000 : 2000;
  autoSyncTimer = setInterval(() => { if (!document.getElementById('autoSync').checked) return; refreshAll(false); }, interval);
  refreshAll(false);
}
document.addEventListener('visibilitychange', () => { if (document.getElementById('autoSync').checked) toggleAutoSync(); });
refreshAll(true);
toggleAutoSync();
</script>
</body>
</html>`;

async function main(): Promise<void> {
  const { agentDir, port, host } = parseArgs(process.argv.slice(2));
  const paths = resolvePaths(agentDir);
  const identity = loadIdentity(paths);

  const app = Fastify({ logger: false });

  app.get("/", async (_req, reply) => {
    reply.type("text/html; charset=utf-8").send(HTML(identity.agent_name));
  });
  app.get("/api/status", async () => buildStatus(paths, identity));
  app.get("/api/metrics", async () => ({
    ...readMetrics(paths),
    manual_compact: readManualCompactStatus(paths),
  }));
  app.get<{ Querystring: { limit?: string } }>("/api/history", async (req) => {
    let limit = parseInt(req.query.limit ?? "50", 10);
    if (!Number.isFinite(limit)) limit = 50;
    limit = Math.max(1, Math.min(limit, 200));
    return { items: buildHistory(paths, limit) };
  });
  app.post<{ Body: { message?: string } }>("/api/send", async (req, reply) => {
    const message = String(req.body?.message ?? "").trim();
    if (!message) return reply.code(400).send({ error: "message must not be empty" });
    const mailbox = path.join(paths.mailboxDir, "human.jsonl");
    const entry = appendMessage(mailbox, "human", identity.agent_name, "task.human.reply", message, {
      source: "web-ui",
    });
    writePendingMessage(paths.runtimeDir, "human", entry.id, "web-ui");
    return { ok: true, id: entry.id, ts: entry.ts };
  });
  app.post("/api/compact", async (_req, reply) => {
    if (identity.provider !== "codex" && identity.provider !== "claude") {
      return reply.code(400).send({ error: "manual compact is only supported for codex or claude agents" });
    }
    const runtimeStatus = pidStatus(path.join(paths.pidsDir, "runtime"));
    if (runtimeStatus.state !== "running") {
      return reply.code(409).send({ error: "agent runtime is not running" });
    }
    if (fs.existsSync(paths.compactRequestFile)) {
      let existing: unknown = {};
      try {
        existing = JSON.parse(fs.readFileSync(paths.compactRequestFile, "utf8"));
      } catch {
        existing = {};
      }
      return { ok: true, already_pending: true, request: existing };
    }
    const now = utcnow();
    const request = {
      id: `compact-${randomUUID().replaceAll("-", "")}`,
      provider: identity.provider,
      requested_at: now,
      requested_by: "web-ui",
    };
    const status = {
      state: "pending",
      request_id: request.id,
      provider: identity.provider,
      requested_at: now,
    };
    fs.mkdirSync(paths.runtimeDir, { recursive: true });
    writeJsonAtomic(paths.compactStatusFile, status);
    writeJsonAtomic(paths.compactRequestFile, request);
    return { ok: true, request, status };
  });

  const address = await app.listen({ host, port });
  console.log(`[web-ui] ${identity.agent_name} serving at ${address}`);

  const shutdown = async (sig: NodeJS.Signals) => {
    console.log(`[web-ui] ${sig} received`);
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(`[web-ui] fatal: ${(err as Error).stack || err}`);
  process.exit(1);
});
