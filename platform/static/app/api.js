// Centralized fetch layer. All API calls go through here.

async function jsonRequest(url, options = {}) {
  const resp = await fetch(url, options);
  const text = await resp.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  }
  if (!resp.ok) {
    const err = new Error((data && data.error) || `HTTP ${resp.status}`);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data || {};
}

export function getOverview() {
  return jsonRequest('/api/overview');
}

export function getAgentDetail(name, { contact = 'human', limit = 50 } = {}) {
  const qs = new URLSearchParams({ contact, limit: String(limit) });
  return jsonRequest(`/api/agents/${encodeURIComponent(name)}/detail?${qs}`);
}

export function getAgentMetrics(name) {
  return jsonRequest(`/api/agents/${encodeURIComponent(name)}/metrics`);
}

export function getAgentMemoryIndex(name, { kind = 'knowledge', limit = 20, cursor = '', date = '' } = {}) {
  const params = { kind, limit: String(limit) };
  if (cursor !== '' && cursor !== null && cursor !== undefined) params.cursor = String(cursor);
  if (date) params.date = date;
  const qs = new URLSearchParams(params);
  return jsonRequest(`/api/agents/${encodeURIComponent(name)}/memory/index?${qs}`);
}

export function getAgentMemoryFile(name, path) {
  const qs = new URLSearchParams({ path });
  return jsonRequest(`/api/agents/${encodeURIComponent(name)}/memory/file?${qs}`);
}

export function startAgent(name) {
  return jsonRequest(`/api/agents/${encodeURIComponent(name)}/start`, { method: 'POST' });
}

export function stopAgent(name) {
  return jsonRequest(`/api/agents/${encodeURIComponent(name)}/stop`, { method: 'POST' });
}

export function deleteAgent(name) {
  return jsonRequest(`/api/agents/${encodeURIComponent(name)}/delete`, { method: 'POST' });
}

export function sendMessage(name, message) {
  return jsonRequest(`/api/agents/${encodeURIComponent(name)}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
}

export function setInterval(name, interval) {
  return jsonRequest(`/api/agents/${encodeURIComponent(name)}/interval`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interval }),
  });
}

export function setPassiveMode(name, enabled) {
  return jsonRequest(`/api/agents/${encodeURIComponent(name)}/passive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

export function saveSchedule(name, schedule) {
  return jsonRequest(`/api/agents/${encodeURIComponent(name)}/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schedule }),
  });
}

export function createAgent(payload) {
  return jsonRequest('/api/agents/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function importAgent(payload) {
  return jsonRequest('/api/agents/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function connectAgents(agentA, agentB) {
  return jsonRequest('/api/mailbox/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_a: agentA, agent_b: agentB }),
  });
}

export function disconnectAgents(agentA, agentB) {
  return jsonRequest('/api/mailbox/disconnect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_a: agentA, agent_b: agentB }),
  });
}

// SSE: deliver dirty events to a subscriber callback.
// Returns a cleanup function.
export function subscribeEvents(onEvent) {
  const es = new EventSource('/api/events');
  es.onmessage = (ev) => {
    if (!ev.data) return;
    try {
      onEvent(JSON.parse(ev.data));
    } catch { /* ignore */ }
  };
  es.onerror = () => {
    // EventSource auto-reconnects; nothing to do here.
  };
  return () => es.close();
}
