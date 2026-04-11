export function stateBadge(status) {
  if (!status) return { text: 'unknown', cls: 'off' };
  const s = status.state;
  if (s === 'off_hours') return { text: 'off hours', cls: 'offhours' };
  if (s === 'stopped') return { text: 'stopped', cls: 'off' };
  if (status.awaiting_human) return { text: 'awaiting human', cls: 'wait' };
  if (s === 'running' && status.runner_alive) return { text: 'running', cls: 'on' };
  if (s === 'running') return { text: 'stale', cls: 'warn' };
  return { text: s || 'unknown', cls: 'off' };
}

export function isStoppedLike(badge) {
  return badge.text === 'stopped' || badge.text === 'stale';
}

export function nowText(d) {
  const t = d || new Date();
  return t.toLocaleTimeString();
}
