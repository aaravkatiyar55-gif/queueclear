const storageKey = 'queueclear.tasks.v2';
const legacyStorageKey = 'queueclear.tasks.v1';
const themeKey = 'queueclear.theme.v1';
const energyLevels = ['low', 'medium', 'high'];
const estimateOptions = [5, 10, 15, 25, 45, 60];
const maxTitleLength = 110;
const maxFirstStepLength = 180;

let tasks = readTasks();
let filter = 'all';
let focusTimer;

const el = (id) => document.getElementById(id);

function normalizeWhitespace(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

function normalizeTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeTask(candidate) {
  const text = normalizeWhitespace(candidate?.text);

  if (!text) {
    return null;
  }

  const estimatedMinutes = Number(candidate.estimatedMinutes);
  const createdAt = Number(candidate.createdAt);
  const completedAt = normalizeTimestamp(candidate.completedAt);
  const snoozedUntil = normalizeTimestamp(candidate.snoozedUntil);

  return {
    id: typeof candidate.id === 'string' ? candidate.id : crypto.randomUUID(),
    text,
    energy: energyLevels.includes(candidate.energy) ? candidate.energy : 'medium',
    done: Boolean(candidate.done),
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    estimatedMinutes: estimateOptions.includes(estimatedMinutes) ? estimatedMinutes : null,
    firstStep: normalizeWhitespace(candidate.firstStep).slice(0, maxFirstStepLength) || null,
    dueDate: normalizeDate(candidate.dueDate),
    snoozedUntil,
    completedAt,
  };
}

function readTasks() {
  try {
    const savedTasks = JSON.parse(
      localStorage.getItem(storageKey) || localStorage.getItem(legacyStorageKey) || '[]',
    );
    return Array.isArray(savedTasks) ? savedTasks.map(normalizeTask).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveTasks() {
  localStorage.setItem(storageKey, JSON.stringify(tasks));
  localStorage.removeItem(legacyStorageKey);
}

function createTask({ text, energy, estimatedMinutes, firstStep, dueDate }) {
  return normalizeTask({
    id: crypto.randomUUID(),
    text,
    energy,
    done: false,
    createdAt: Date.now(),
    estimatedMinutes,
    firstStep,
    dueDate,
    snoozedUntil: null,
    completedAt: null,
  });
}

function getActiveTasks() {
  return tasks.filter((task) => !task.done);
}

function getNextTask() {
  return getActiveTasks()[0] || null;
}

function showStatus(message) {
  el('form-message').textContent = message;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return entities[character];
  });
}

function renderTaskList() {
  const visibleTasks = tasks.filter((task) => filter === 'all' || task.energy === filter);
  const taskList = el('task-list');

  taskList.innerHTML = '';

  visibleTasks.forEach((task) => {
    const item = document.createElement('li');
    item.className = `task-row ${task.done ? 'is-done' : ''}`;
    item.innerHTML = `
      <input type="checkbox" aria-label="Mark ${escapeHtml(task.text)} complete" ${task.done ? 'checked' : ''}>
      <span class="task-text">${escapeHtml(task.text)}</span>
      <span class="energy-tag">${task.energy} energy</span>
      <button class="text-button delete-task" type="button" aria-label="Delete ${escapeHtml(task.text)}">Delete</button>
    `;

    item.querySelector('input').addEventListener('change', () => {
      task.done = !task.done;
      task.completedAt = task.done ? Date.now() : null;
      saveTasks();
      render();
    });

    item.querySelector('.delete-task').addEventListener('click', () => {
      tasks = tasks.filter((savedTask) => savedTask.id !== task.id);
      saveTasks();
      render();
    });

    taskList.append(item);
  });

  renderEmptyState(visibleTasks);
}

function renderNextAction() {
  const nextTask = getNextTask();

  el('next-task').textContent = nextTask ? nextTask.text : 'Your queue is clear. Take a breath.';
  el('start-focus').disabled = !nextTask;
  el('complete-next').disabled = !nextTask;
}

function renderEmptyState(visibleTasks) {
  el('empty-state').hidden = visibleTasks.length > 0;
}

function render() {
  renderNextAction();
  renderTaskList();
}

function hasDuplicateActiveTitle(text) {
  const comparableTitle = text.toLocaleLowerCase();
  return getActiveTasks().some((task) => task.text.toLocaleLowerCase() === comparableTitle);
}

function clearContextFields() {
  el('estimated-minutes').value = '';
  el('first-step-input').value = '';
  el('due-date-input').value = '';
}

function handleTaskSubmit(event) {
  event.preventDefault();

  const titleInput = el('task-input');
  const text = normalizeWhitespace(titleInput.value);

  if (!text) {
    showStatus('Add a short task title first.');
    titleInput.focus();
    return;
  }

  if (text.length > maxTitleLength) {
    showStatus(`Keep task titles under ${maxTitleLength} characters.`);
    titleInput.focus();
    return;
  }

  if (hasDuplicateActiveTitle(text)) {
    showStatus('That task is already in your active queue.');
    titleInput.focus();
    return;
  }

  const task = createTask({
    text,
    energy: el('energy-input').value,
    estimatedMinutes: el('estimated-minutes').value,
    firstStep: el('first-step-input').value,
    dueDate: el('due-date-input').value,
  });

  if (!task) {
    showStatus('Try a task you could begin in five minutes.');
    titleInput.focus();
    return;
  }

  tasks.push(task);
  saveTasks();
  titleInput.value = '';
  clearContextFields();
  showStatus('Added. Your next action is ready.');
  render();
  titleInput.focus();
}

function completeNextTask() {
  const nextTask = getNextTask();

  if (!nextTask) {
    return;
  }

  nextTask.done = true;
  nextTask.completedAt = Date.now();
  saveTasks();
  render();
}

function clearCompletedTasks() {
  tasks = tasks.filter((task) => !task.done);
  saveTasks();
  render();
}

function setFilter(button) {
  filter = button.dataset.filter;

  document.querySelectorAll('.filter').forEach((filterButton) => {
    const isActive = filterButton === button;
    filterButton.classList.toggle('is-active', isActive);
    filterButton.setAttribute('aria-pressed', String(isActive));
  });

  render();
}

function startFocus() {
  let seconds = 600;
  clearInterval(focusTimer);
  el('start-focus').textContent = 'Focus running';
  el('start-focus').disabled = true;

  function tick() {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = String(seconds % 60).padStart(2, '0');
    el('focus-status').textContent = `Focus session: ${minutes}:${remainingSeconds} remaining.`;

    if (seconds-- <= 0) {
      clearInterval(focusTimer);
      el('focus-status').textContent = 'Nice work. Take a short break.';
      el('start-focus').textContent = 'Start another 10 minutes';
      el('start-focus').disabled = false;
    }
  }

  tick();
  focusTimer = setInterval(tick, 1000);
}

function applyTheme() {
  const isCalm = localStorage.getItem(themeKey) === 'calm';
  document.body.classList.toggle('calm', isCalm);
  el('theme-toggle').setAttribute('aria-pressed', String(isCalm));
  el('theme-toggle').textContent = isCalm ? 'Use paper theme' : 'Use calm theme';
}

function toggleTheme() {
  const nextTheme = document.body.classList.contains('calm') ? 'paper' : 'calm';
  localStorage.setItem(themeKey, nextTheme);
  applyTheme();
}

el('task-form').addEventListener('submit', handleTaskSubmit);
el('complete-next').addEventListener('click', completeNextTask);
el('clear-done').addEventListener('click', clearCompletedTasks);
el('start-focus').addEventListener('click', startFocus);
el('theme-toggle').addEventListener('click', toggleTheme);

document.querySelectorAll('.filter').forEach((button) => {
  button.addEventListener('click', () => setFilter(button));
});

applyTheme();
render();
