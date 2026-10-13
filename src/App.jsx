import { useEffect, useRef, useState } from 'react';
import './App.css';

const LEGACY_STORAGE_KEY = 'gorev-defteri-tasks';

const priorityLabels = {
  Düşük: { label: 'Low', className: 'low' },
  Orta: { label: 'Medium', className: 'medium' },
  Yüksek: { label: 'High', className: 'high' },
};

const priorityOptions = [
  { value: 'Düşük', label: 'Low' },
  { value: 'Orta', label: 'Medium' },
  { value: 'Yüksek', label: 'High' },
];

const apiErrors = {
  'İstek gövdesi çok büyük.': 'This request is too large. Please shorten your notes.',
  'Geçerli bir JSON gövdesi gönder.': 'Something went wrong. Please try again.',
  'Görev adı 1 ile 90 karakter arasında olmalı.': 'Task title must be between 1 and 90 characters.',
  'Açıklama en fazla 240 karakter olabilir.': 'Notes can be up to 240 characters.',
  'Öncelik Düşük, Orta veya Yüksek olmalı.': 'Choose a valid priority.',
  'Aktarılacak görev listesi geçersiz.': 'Saved tasks could not be imported.',
  'Görev bulunamadı.': 'This task could not be found.',
  'Bu API adresi bulunamadı.': 'This request could not be found.',
};

async function requestApi(path, options) {
  let response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error('Could not connect to the task server. Is it running?');
  }

  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    throw new Error(apiErrors[result?.error] || `Request failed (${response.status}). Please try again.`);
  }
  return result;
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function PriorityPicker({ value, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const pickerRef = useRef(null);
  const triggerRef = useRef(null);
  const selectedIndex = Math.max(0, priorityOptions.findIndex((option) => option.value === value));

  useEffect(() => {
    if (!isOpen) return undefined;

    function closeOnOutsideClick(event) {
      if (!pickerRef.current?.contains(event.target)) setIsOpen(false);
    }

    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [isOpen]);

  function focusOption(index) {
    window.requestAnimationFrame(() => {
      pickerRef.current?.querySelectorAll('[role="option"]')[index]?.focus();
    });
  }

  function handleTriggerKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setIsOpen(true);
      focusOption(selectedIndex);
    } else if (event.key === 'Escape') {
      setIsOpen(false);
    }
  }

  function handleOptionKeyDown(event, index) {
    let nextIndex = index;
    if (event.key === 'ArrowDown') nextIndex = (index + 1) % priorityOptions.length;
    else if (event.key === 'ArrowUp') nextIndex = (index - 1 + priorityOptions.length) % priorityOptions.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = priorityOptions.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
      return;
    } else {
      return;
    }

    event.preventDefault();
    focusOption(nextIndex);
  }

  function choosePriority(nextValue) {
    onChange(nextValue);
    setIsOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div
      className="priority-field"
      ref={pickerRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
      }}
    >
      <span className="field-label" id="task-priority-label">Priority</span>
      <button
        className="text-field priority-select"
        id="task-priority"
        type="button"
        ref={triggerRef}
        aria-labelledby="task-priority-label task-priority-value"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls="task-priority-options"
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span id="task-priority-value">{priorityLabels[value]?.label || 'Medium'}</span>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {isOpen && (
        <div className="priority-menu" id="task-priority-options" role="listbox" aria-labelledby="task-priority-label">
          {priorityOptions.map((option, index) => (
            <button
              className={`priority-option ${option.value === value ? 'selected' : ''}`}
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => choosePriority(option.value)}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
            >
              <span className={`priority-option-dot priority-dot-${priorityLabels[option.value].className}`} />
              {option.label}
              {option.value === value && <span className="priority-option-check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const filters = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'In progress' },
  { id: 'completed', label: 'Completed' },
];

function App() {
  // State keeps the task data and form fields in sync with the screen.
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // The API still stores the original Turkish values for existing SQLite data.
  const [priority, setPriority] = useState('Orta');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  // Load tasks from SQLite. Import an older browser-saved list only once.
  useEffect(() => {
    let active = true;

    async function loadTasks() {
      try {
        let savedTasks = await requestApi('/api/tasks');
        if (savedTasks.length === 0) {
          const legacyTasks = localStorage.getItem(LEGACY_STORAGE_KEY);
          if (legacyTasks) {
            const imported = await requestApi(
              '/api/tasks/import',
              jsonOptions('POST', { tasks: JSON.parse(legacyTasks) }),
            );
            savedTasks = imported.tasks;
            if (imported.imported > 0) localStorage.removeItem(LEGACY_STORAGE_KEY);
          }
        }
        if (active) setTasks(savedTasks);
      } catch (requestError) {
        if (active) setError(requestError.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadTasks();
    return () => { active = false; };
  }, []);

  const completedCount = tasks.filter((task) => task.completed).length;
  const activeCount = tasks.length - completedCount;
  const completionRate = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0;

  const visibleTasks = tasks.filter((task) => {
    const matchesFilter =
      filter === 'all' ||
      (filter === 'active' && !task.completed) ||
      (filter === 'completed' && task.completed);
    const searchText = `${task.title} ${task.description}`.toLocaleLowerCase('tr-TR');
    return matchesFilter && searchText.includes(search.toLocaleLowerCase('tr-TR'));
  });

  async function addTask(event) {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) return;

    try {
      setError('');
      const savedTask = await requestApi('/api/tasks', jsonOptions('POST', {
        title: cleanTitle,
        description: description.trim(),
        priority,
      }));
      setTasks((currentTasks) => [savedTask, ...currentTasks]);
      setTitle('');
      setDescription('');
      setPriority('Orta');
      document.getElementById('task-title')?.focus();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function toggleTask(taskId) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;

    try {
      setError('');
      const updatedTask = await requestApi(
        `/api/tasks/${taskId}`,
        jsonOptions('PATCH', { completed: !task.completed }),
      );
      setTasks((currentTasks) =>
        currentTasks.map((item) => item.id === taskId ? updatedTask : item),
      );
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function deleteTask(taskId) {
    try {
      setError('');
      await requestApi(`/api/tasks/${taskId}`, { method: 'DELETE' });
      setTasks((currentTasks) => currentTasks.filter((task) => task.id !== taskId));
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  const today = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  return (
    <main className="app-shell" id="top">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Taskflow home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="m5.5 12.5 4.2 4.1L18.8 7.8" />
            </svg>
          </span>
          <span className="brand-name">task<span>flow</span></span>
          <span className="brand-divider" />
          <span className="brand-caption">PERSONAL SPACE</span>
        </a>
        <div className="topbar-right">
          <span className="date-label">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
              <path d="M7.5 3.5v3M16.5 3.5v3M4 9.5h16" />
            </svg>
            {today}
          </span>
          <span className="workspace-pill"><span className="live-dot" />Workspace ready</span>
        </div>
      </header>

      <section className="hero-panel" aria-labelledby="welcome-heading">
        <div className="hero-copy">
          <p className="hero-kicker"><span className="sparkle" aria-hidden="true">✳</span> YOUR DAY, YOUR PACE</p>
          <h1 id="welcome-heading">Make space for<br /><span>what matters.</span></h1>
          <p className="hero-description">A clear plan makes room for good work. Start with one small step.</p>
          <a className="hero-button" href="#new-task">
            Add a task <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />
          <div className="hero-spark spark-one">✳</div>
          <div className="hero-spark spark-two">✦</div>
          <div className="progress-card">
            <div className="progress-card-top"><span>DAILY PROGRESS</span><span className="progress-arrow">↗</span></div>
            <div className="progress-ring" style={{ '--progress': `${completionRate * 3.6}deg` }}>
              <div className="progress-ring-inner">
                <strong>{completionRate}<span>%</span></strong>
                <small>COMPLETE</small>
              </div>
            </div>
            <p>
              {tasks.length > 0 && activeCount === 0
                ? <strong>Mission completed!</strong>
                : <><strong>{completedCount}</strong> of {tasks.length} tasks done</>}
            </p>
          </div>
          <span className="hero-art-caption">SMALL STEPS. BIG MOMENTUM.</span>
        </div>
        <span className="hero-index" aria-hidden="true">01 / 01</span>
      </section>

      <section className="stats-grid" aria-label="Task summary">
        <article className="stat-card stat-total">
          <div className="stat-topline"><span className="stat-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M8 6h12M8 12h12M8 18h12M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></svg>
          </span><span className="stat-label">TOTAL TASKS</span><span className="stat-trend">↗</span></div>
          <div className="stat-value-row"><strong>{tasks.length}</strong><span>in your space</span></div>
          <div className="stat-accent accent-lime" />
        </article>
        <article className="stat-card stat-active">
          <div className="stat-topline"><span className="stat-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></svg>
          </span><span className="stat-label">IN PROGRESS</span><span className="stat-trend">↗</span></div>
          <div className="stat-value-row"><strong>{activeCount}</strong><span>ready for you</span></div>
          <div className="stat-accent accent-orange" />
        </article>
        <article className="stat-card stat-done">
          <div className="stat-topline"><span className="stat-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="m5.5 12.5 4.2 4.1L18.8 7.8" /><circle cx="12" cy="12" r="9" /></svg>
          </span><span className="stat-label">COMPLETED</span><span className="stat-trend">✳</span></div>
          <div className="stat-value-row"><strong>{completedCount}</strong><span>mission accomplished</span></div>
          <div className="stat-accent accent-purple" />
        </article>
      </section>

      <section className="workspace">
        <section className="tasks-panel" aria-labelledby="tasks-heading">
          <div className="panel-heading">
            <div>
              <p className="section-kicker"><span className="section-kicker-line" /> YOUR PLAN</p>
              <h2 id="tasks-heading">Task board <span className="heading-period">/</span> <span className="heading-sub">Keep your focus</span></h2>
            </div>
            <span className="task-count"><span className="count-dot" />{visibleTasks.length} {visibleTasks.length === 1 ? 'task' : 'tasks'}</span>
          </div>

          {error && <p className="error-banner" role="alert"><span aria-hidden="true">!</span>{error}</p>}

          <label className="search-box">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="10.8" cy="10.8" r="6.8" />
              <path d="m16 16 4 4" />
            </svg>
            <input
              type="search"
              placeholder="Search your tasks..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search your tasks"
            />
            <span className="search-shortcut" aria-hidden="true">⌕</span>
          </label>

          <div className="filter-row" role="group" aria-label="Filter tasks">
            {filters.map((item) => (
              <button
                className={`filter-button ${filter === item.id ? 'selected' : ''}`}
                key={item.id}
                type="button"
                aria-pressed={filter === item.id}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
                {item.id === 'all' && <span>{tasks.length}</span>}
              </button>
            ))}
          </div>

          <div className="task-list" aria-live="polite">
            {loading ? (
              <div className="empty-state">
                <div className="empty-icon loading-mark" aria-hidden="true">◌</div>
                <h3>Getting things ready...</h3>
                <p>Your tasks are on their way.</p>
              </div>
            ) : visibleTasks.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon" aria-hidden="true">{tasks.length > 0 && completedCount === tasks.length ? '✳' : '↗'}</div>
                <h3>
                  {tasks.length === 0
                    ? 'Ready when you are.'
                    : tasks.length === completedCount && filter === 'all'
                      ? 'Mission completed!'
                      : 'No tasks found.'}
                </h3>
                <p>
                  {tasks.length === 0
                    ? 'Add your first task and make today count.'
                    : tasks.length === completedCount && filter === 'all'
                      ? 'You did what you set out to do. Take a moment to enjoy it.'
                      : 'Try another search or switch your filter.'}
                </p>
              </div>
            ) : (
              visibleTasks.map((task, index) => {
                const taskPriority = priorityLabels[task.priority] || priorityLabels.Orta;
                return (
                  <article className={`task-row ${task.completed ? 'is-completed' : ''}`} key={task.id}>
                    <span className="task-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                    <button
                      className={`task-check ${task.completed ? 'checked' : ''}`}
                      type="button"
                      aria-label={task.completed ? `Mark ${task.title} as in progress` : `Complete ${task.title}`}
                      aria-pressed={task.completed}
                      onClick={() => toggleTask(task.id)}
                    >
                      {task.completed && <span aria-hidden="true">✓</span>}
                    </button>
                    <div className="task-copy">
                      <h3>{task.title}</h3>
                      <p>{task.description || 'No notes added'}</p>
                    </div>
                    <span className={`priority-badge priority-${taskPriority.className}`}>
                      <span />{taskPriority.label}
                    </span>
                    <button
                      className="delete-button"
                      type="button"
                      aria-label={`Delete ${task.title}`}
                      title="Delete task"
                      onClick={() => deleteTask(task.id)}
                    >
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                      </svg>
                    </button>
                  </article>
                );
              })
            )}
          </div>
          <div className="list-footer"><span>MADE FOR YOUR MOMENTUM</span><span>{completedCount} DONE <i>·</i> {activeCount} TO GO</span></div>
        </section>

        <aside className="composer-panel" id="new-task">
          <div className="composer-topline"><span className="composer-icon" aria-hidden="true">＋</span><span className="composer-tag">QUICK CAPTURE</span><span className="composer-step">01</span></div>
          <div className="composer-heading">
            <h2>New task<span>.</span></h2>
            <p>Get it out of your head<br />and onto your list.</p>
          </div>

          <form onSubmit={addTask}>
            <label className="field-label" htmlFor="task-title">Task name <span>*</span></label>
            <input
              className="text-field"
              id="task-title"
              type="text"
              placeholder="e.g. Finish the presentation"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={90}
              required
            />

            <label className="field-label" htmlFor="task-description">Notes <span className="optional">OPTIONAL</span></label>
            <textarea
              className="text-field description-field"
              id="task-description"
              placeholder="Add a little context..."
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={240}
              rows={3}
            />

            <PriorityPicker value={priority} onChange={setPriority} />

            <button className="submit-button" type="submit"><span>Add to my list</span><b aria-hidden="true">↗</b></button>
          </form>

          <div className="privacy-note">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="5" y="10" width="14" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
            </svg>
            Saved on this device
            <span className="saved-dot" />
          </div>
        </aside>
      </section>

      <footer className="footer-note"><span>TAKE IT ONE TASK AT A TIME.</span><span>YOU'VE GOT THIS <b>✳</b></span></footer>
    </main>
  );
}

export default App;
