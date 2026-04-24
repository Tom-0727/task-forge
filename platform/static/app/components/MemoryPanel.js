import { html } from '../../vendor/htm.mjs';
import { useEffect } from '../../vendor/preact-hooks.mjs';
import { useStore } from '../useStore.js';
import { loadMemoryFile, loadMemoryIndex, setMemoryEpisodeDate } from '../main.js';


const EMPTY_INDEX = { items: [], nextCursor: null, loaded: false, loading: false, error: null, dates: [] };


function displayTitle(item, kind) {
  if (!item) return '';
  if (kind === 'knowledge') return item.summary || item.name || item.path;
  return item.title || item.objective || item.name || item.path;
}

function itemMeta(item, kind) {
  const parts = [];
  if (kind === 'episodes' && item.objective) parts.push(item.objective);
  if (item.status) parts.push(item.status);
  if (item.last_edited_at) parts.push(item.last_edited_at);
  else if (item.last_modified) parts.push(item.last_modified);
  return parts.join(' · ');
}

export function MemoryPanel({ name }) {
  const kind = useStore((s) => s.memoryKind);
  const memoryIndex = useStore((s) => s.memoryIndex);
  const index = memoryIndex[kind] || EMPTY_INDEX;
  const episodeDate = useStore((s) => s.memoryEpisodeDate);
  const selectedPath = useStore((s) => s.memorySelectedPath);
  const files = useStore((s) => s.memoryFiles);
  const file = selectedPath ? files[selectedPath] : null;

  useEffect(() => {
    if (!name || !kind || index.loaded || index.loading) return;
    loadMemoryIndex(name, kind);
  }, [name, kind, episodeDate, index.loaded, index.loading]);

  useEffect(() => {
    if (kind !== 'episodes' || episodeDate || !index.loaded || !index.dates.length) return;
    setMemoryEpisodeDate(index.dates[0].date);
  }, [kind, episodeDate, index.loaded, index.dates.length]);

  useEffect(() => {
    if (!name || selectedPath || !index.items.length) return;
    loadMemoryFile(name, index.items[0].path);
  }, [name, kind, selectedPath, index.items.length]);

  const loadMore = () => {
    if (index.nextCursor === null || index.loading) return;
    loadMemoryIndex(name, kind, { cursor: index.nextCursor, append: true });
  };

  const rows = [];
  let lastDate = null;
  for (const item of index.items) {
    if (kind === 'episodes' && item.date && item.date !== lastDate) {
      lastDate = item.date;
      rows.push({ type: 'date', date: item.date });
    }
    rows.push({ type: 'item', item });
  }

  return html`
    <section class="panel memory-browser">
      <div class="memory-layout">
        <aside class="memory-list">
          ${kind === 'episodes' && index.dates.length ? html`
            <div class="memory-date-filter">
              ${index.dates.map((entry) => html`
                <button
                  key=${entry.date}
                  class=${episodeDate === entry.date ? 'date-chip active' : 'date-chip'}
                  onClick=${() => setMemoryEpisodeDate(entry.date)}
                >
                  ${entry.date} ${entry.count}
                </button>
              `)}
            </div>
          ` : null}
          ${index.error ? html`<div class="memory-empty">Error: ${index.error}</div>` : null}
          ${!index.error && index.loading && !index.loaded ? html`<div class="memory-empty">Loading...</div>` : null}
          ${!index.error && index.loaded && !index.items.length && kind !== 'episodes' ? html`<div class="memory-empty">No files</div>` : null}
          ${!index.error && index.loaded && !index.items.length && kind === 'episodes' && !index.dates.length ? html`<div class="memory-empty">No dates</div>` : null}
          ${!index.error && index.loaded && !index.items.length && kind === 'episodes' && index.dates.length ? html`<div class="memory-empty">Select a date</div>` : null}
          ${rows.map((row) => row.type === 'date' ? html`
            <div key=${`date-${row.date}`} class="memory-date-separator">${row.date}</div>
          ` : html`
            <button
              key=${row.item.path}
              class=${selectedPath === row.item.path ? 'memory-item active' : 'memory-item'}
              onClick=${() => loadMemoryFile(name, row.item.path)}
            >
              <span class="memory-item-title">${displayTitle(row.item, kind)}</span>
              <span class="memory-item-path">${row.item.path}</span>
              ${itemMeta(row.item, kind) ? html`<span class="memory-item-meta">${itemMeta(row.item, kind)}</span>` : null}
            </button>
          `)}
          ${index.nextCursor !== null ? html`
            <button class="memory-load-more" disabled=${index.loading} onClick=${loadMore}>
              ${index.loading ? 'Loading...' : 'Load more'}
            </button>
          ` : null}
        </aside>
        <article class="memory-content">
          ${!selectedPath ? html`<div class="memory-empty">Select a file</div>` : null}
          ${selectedPath && file?.loading ? html`<div class="memory-empty">Loading...</div>` : null}
          ${selectedPath && file?.error ? html`<div class="memory-empty">Error: ${file.error}</div>` : null}
          ${selectedPath && file && file.content !== undefined && !file.loading && !file.error ? html`
            <div class="memory-file-head">
              <strong>${file.path}</strong>
              <span class="meta">${file.last_modified || ''}</span>
            </div>
            <pre class="memory-markdown">${file.content}</pre>
          ` : null}
        </article>
      </div>
    </section>
  `;
}
