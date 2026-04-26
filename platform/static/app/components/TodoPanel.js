import { html } from '../../vendor/htm.mjs';
import { useEffect, useState } from '../../vendor/preact-hooks.mjs';
import * as api from '../api.js';
import { refreshCurrent } from '../main.js';


const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function cloneTodoPayload(payload) {
  return {
    date: payload?.date || '',
    todos: (payload?.todos || []).map((item) => ({
      id: item.id || '',
      title: item.title || '',
      description: item.description || '',
      done: !!item.done,
      subtasks: (item.subtasks || []).map((sub) => ({
        id: sub.id,
        text: sub.text || '',
        done: !!sub.done,
      })),
    })),
    scheduledTasks: (payload?.scheduled_tasks || []).map((item) => ({
      id: item.id || '',
      title: item.title || '',
      description: item.description || '',
      subtasks: (item.subtasks || []).map((sub) => ({ id: sub.id, text: sub.text || '' })),
      reminder_at: {
        kind: item.reminder_at?.kind || 'weekly',
        time: item.reminder_at?.time || '09:00',
        weekdays: [...(item.reminder_at?.weekdays || ['MON', 'TUE', 'WED', 'THU', 'FRI'])],
        date: item.reminder_at?.date || '',
      },
    })),
    dueReminders: payload?.due_reminders || [],
  };
}

function newTodo() {
  return { id: '', title: 'New todo', description: '', done: false, subtasks: [] };
}

function newScheduled(date) {
  return {
    id: '',
    title: 'New scheduled task',
    description: '',
    subtasks: [],
    reminder_at: {
      kind: 'weekly',
      time: '09:00',
      weekdays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
      date,
    },
  };
}

function normalizeScheduledForSave(tasks, currentDate) {
  return tasks.map((task) => {
    const reminder = task.reminder_at || {};
    const base = {
      id: task.id || '',
      title: task.title || '',
      description: task.description || '',
      subtasks: task.subtasks || [],
      reminder_at: {
        kind: reminder.kind || 'weekly',
        time: reminder.time || '09:00',
      },
    };
    if (base.reminder_at.kind === 'date') {
      base.reminder_at.date = reminder.date || currentDate;
    } else {
      base.reminder_at.kind = 'weekly';
      base.reminder_at.weekdays = reminder.weekdays || [];
    }
    return base;
  });
}

export function TodoPanel({ name, initialTodo }) {
  const initial = cloneTodoPayload(initialTodo || {});
  const [date, setDate] = useState(initial.date);
  const [todos, setTodos] = useState(initial.todos);
  const [scheduledTasks, setScheduledTasks] = useState(initial.scheduledTasks);
  const [dueReminders, setDueReminders] = useState(initial.dueReminders);
  const [todoResult, setTodoResult] = useState('');
  const [scheduledResult, setScheduledResult] = useState('');
  const [loading, setLoading] = useState(false);

  const loadDate = async (nextDate) => {
    setDate(nextDate);
    setLoading(true);
    setTodoResult('Loading...');
    try {
      const data = await api.getTodo(name, { date: nextDate });
      const next = cloneTodoPayload(data);
      setDate(next.date);
      setTodos(next.todos);
      setScheduledTasks(next.scheduledTasks);
      setDueReminders(next.dueReminders);
      setTodoResult('');
    } catch (err) {
      setTodoResult('Failed: ' + (err.message || 'unknown'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const next = cloneTodoPayload(initialTodo || {});
    if (!next.date) {
      loadDate('');
      return;
    }
    if (next.date !== date) return;
    setTodos(next.todos);
    setScheduledTasks(next.scheduledTasks);
    setDueReminders(next.dueReminders);
  }, [name, initialTodo?.date, initialTodo?.todos, initialTodo?.scheduled_tasks, initialTodo?.due_reminders]);

  const updateTodo = (idx, patch) => {
    setTodos((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  const updateTodoSubtask = (todoIdx, subIdx, patch) => {
    setTodos((prev) => prev.map((item, i) => {
      if (i !== todoIdx) return item;
      return {
        ...item,
        subtasks: item.subtasks.map((sub, j) => (j === subIdx ? { ...sub, ...patch } : sub)),
      };
    }));
  };

  const addTodoSubtask = (todoIdx) => {
    setTodos((prev) => prev.map((item, i) => {
      if (i !== todoIdx) return item;
      return { ...item, subtasks: [...item.subtasks, { id: '', text: 'New subtask', done: false }] };
    }));
  };

  const removeTodoSubtask = (todoIdx, subIdx) => {
    setTodos((prev) => prev.map((item, i) => {
      if (i !== todoIdx) return item;
      return { ...item, subtasks: item.subtasks.filter((_, j) => j !== subIdx) };
    }));
  };

  const saveTodos = async () => {
    setTodoResult('Saving...');
    try {
      const data = await api.saveTodos(name, date, todos);
      setTodos(cloneTodoPayload({ date: data.date, todos: data.todos }).todos);
      setTodoResult('Saved');
      setTimeout(() => setTodoResult(''), 1500);
      refreshCurrent();
    } catch (err) {
      setTodoResult('Failed: ' + (err.message || 'unknown'));
    }
  };

  const updateScheduled = (idx, patch) => {
    setScheduledTasks((prev) => prev.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  const updateReminder = (idx, patch) => {
    setScheduledTasks((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      return { ...item, reminder_at: { ...item.reminder_at, ...patch } };
    }));
  };

  const toggleWeekday = (idx, day) => {
    setScheduledTasks((prev) => prev.map((item, i) => {
      if (i !== idx) return item;
      const current = item.reminder_at?.weekdays || [];
      const weekdays = current.includes(day)
        ? current.filter((token) => token !== day)
        : [...current, day].sort((a, b) => WEEKDAYS.indexOf(a) - WEEKDAYS.indexOf(b));
      return { ...item, reminder_at: { ...item.reminder_at, weekdays } };
    }));
  };

  const updateScheduledSubtasks = (idx, text) => {
    const subtasks = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, i) => ({ id: i + 1, text: line }));
    updateScheduled(idx, { subtasks });
  };

  const saveScheduledTasks = async () => {
    setScheduledResult('Saving...');
    try {
      const data = await api.saveScheduledTasks(name, normalizeScheduledForSave(scheduledTasks, date));
      setScheduledTasks(cloneTodoPayload({ scheduled_tasks: data.scheduled_tasks }).scheduledTasks);
      setScheduledResult('Saved');
      setTimeout(() => setScheduledResult(''), 1500);
      refreshCurrent();
    } catch (err) {
      setScheduledResult('Failed: ' + (err.message || 'unknown'));
    }
  };

  return html`
    <section class="panel">
      <div class="panel-head">
        <h2>Todos</h2>
        <div class="todo-toolbar">
          <input type="date" value=${date} onInput=${(e) => loadDate(e.target.value)} disabled=${loading} />
          <button class="secondary" onClick=${() => loadDate(date)} disabled=${loading}>Reload</button>
          <button onClick=${saveTodos} disabled=${loading}>Save Todos</button>
          <span class="meta">${todoResult}</span>
        </div>
      </div>

      ${dueReminders.length ? html`
        <div class="todo-due">Due now: ${dueReminders.join(', ')}</div>
      ` : null}

      <div class="todo-list">
        ${todos.length ? todos.map((item, idx) => html`
          <div key=${item.id || idx} class="todo-item">
            <div class="todo-row">
              <input type="checkbox" checked=${item.done} onChange=${(e) => updateTodo(idx, { done: e.target.checked })} />
              <span class="todo-id">${item.id || 'new'}</span>
              <input type="text" value=${item.title} onInput=${(e) => updateTodo(idx, { title: e.target.value })} />
              <button class="secondary todo-small-btn" onClick=${() => setTodos((prev) => prev.filter((_, i) => i !== idx))}>Delete</button>
            </div>
            <textarea rows="2" value=${item.description} onInput=${(e) => updateTodo(idx, { description: e.target.value })}></textarea>
            <div class="todo-subtasks">
              ${item.subtasks.map((sub, subIdx) => html`
                <div key=${sub.id || subIdx} class="todo-subtask">
                  <input type="checkbox" checked=${sub.done} onChange=${(e) => updateTodoSubtask(idx, subIdx, { done: e.target.checked })} />
                  <input type="text" value=${sub.text} onInput=${(e) => updateTodoSubtask(idx, subIdx, { text: e.target.value })} />
                  <button class="secondary todo-icon-btn" onClick=${() => removeTodoSubtask(idx, subIdx)}>×</button>
                </div>
              `)}
            </div>
            <button class="secondary todo-small-btn" onClick=${() => addTodoSubtask(idx)}>+ Subtask</button>
          </div>
        `) : html`<div class="todo-empty">No todos for ${date || 'this date'}</div>`}
      </div>

      <div class="row">
        <button class="secondary" onClick=${() => setTodos((prev) => [...prev, newTodo()])}>+ Add Todo</button>
        <button onClick=${saveTodos} disabled=${loading}>Save Todos</button>
      </div>

      <div class="todo-scheduled">
        <div class="panel-head">
          <h2>Scheduled Tasks</h2>
          <div class="todo-toolbar">
            <button class="secondary" onClick=${() => setScheduledTasks((prev) => [...prev, newScheduled(date)])}>+ Add</button>
            <button onClick=${saveScheduledTasks}>Save Scheduled</button>
            <span class="meta">${scheduledResult}</span>
          </div>
        </div>
        <div class="todo-list">
          ${scheduledTasks.length ? scheduledTasks.map((item, idx) => {
            const reminder = item.reminder_at || {};
            const kind = reminder.kind || 'weekly';
            return html`
              <div key=${item.id || idx} class="todo-item">
                <div class="todo-row">
                  <span class="todo-id">${item.id || 'new'}</span>
                  <input type="text" value=${item.title} onInput=${(e) => updateScheduled(idx, { title: e.target.value })} />
                  <select value=${kind} onChange=${(e) => updateReminder(idx, e.target.value === 'date'
                    ? { kind: 'date', date: reminder.date || date }
                    : { kind: 'weekly', weekdays: reminder.weekdays?.length ? reminder.weekdays : ['MON', 'TUE', 'WED', 'THU', 'FRI'] }
                  )}>
                    <option value="weekly">weekly</option>
                    <option value="date">date</option>
                  </select>
                  <input type="time" value=${reminder.time || '09:00'} onInput=${(e) => updateReminder(idx, { time: e.target.value })} />
                  <button class="secondary todo-small-btn" onClick=${() => setScheduledTasks((prev) => prev.filter((_, i) => i !== idx))}>Delete</button>
                </div>
                ${kind === 'weekly' ? html`
                  <div class="todo-weekdays">
                    ${WEEKDAYS.map((day) => html`
                      <span key=${day}
                        class=${`sched-day ${(reminder.weekdays || []).includes(day) ? 'active' : ''}`}
                        onClick=${() => toggleWeekday(idx, day)}>
                        ${day}
                      </span>
                    `)}
                  </div>
                ` : html`
                  <input type="date" class="todo-date-input" value=${reminder.date || date} onInput=${(e) => updateReminder(idx, { date: e.target.value })} />
                `}
                <textarea rows="2" value=${item.description} onInput=${(e) => updateScheduled(idx, { description: e.target.value })}></textarea>
                <textarea rows="2" value=${(item.subtasks || []).map((sub) => sub.text).join('\n')}
                  onInput=${(e) => updateScheduledSubtasks(idx, e.target.value)}></textarea>
              </div>
            `;
          }) : html`<div class="todo-empty">No scheduled tasks</div>`}
        </div>
      </div>
    </section>
  `;
}
