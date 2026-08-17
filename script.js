const storageKey = 'queueclear.tasks.v2';
const legacyStorageKey = 'queueclear.tasks.v1';
const themeKey = 'queueclear.theme.v1';
const currentEnergyKey = 'queueclear.current-energy.v1';
const energyLevels = ['low', 'medium', 'high'];
const estimateOptions = [5, 10, 15, 25, 45, 60];
const maxTitleLength = 110;
const maxFirstStepLength = 180;

let tasks = readTasks();
let filter = 'all';
let focusTimer;
let currentEnergy = readCurrentEnergy();
let selectedTaskId = null;

const el = (id) => document.getElementById(id);

function normalizeWhitespace(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const parsed = new Date(value + 'T00:00:00Z');
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
  const createdAt = normalizeTimestamp(candidate.createdAt);

  return {
    id: typeof candidate.id === 'string' ? candidate.id : crypto.randomUUID(),
    text,
    energy: energyLevels.includes(candidate.energy) ? candidate.energy : 'medium',
    done: Boolean(candidate.done),
    createdAt: createdAt ?? Date.now(),
    estimatedMinutes: estimateOptions.includes(estimatedMinutes) ? estimatedMinutes : null,
    firstStep: normalizeWhitespace(candidate.firstStep).slice(0, maxFirstStepLength) || null,
    dueDate: normalizeDate(candidate.dueDate),
    snoozedUntil: normalizeTimestamp(candidate.snoozedUntil),
    completedAt: normalizeTimestamp(candidate.completedAt),
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

function readCurrentEnergy() {
  const savedEnergy = localStorage.getItem(currentEnergyKey);
  return energyLevels.includes(savedEnergy) ? savedEnergy : 'medium';
}

function saveCurrentEnergy() {
  localStorage.setItem(currentEnergyKey, currentEnergy);
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

function isSnoozed(task, now = Date.now()) {
  return task.snoozedUntil !== null && task.snoozedUntil > now;
}

function getEligibleTasks(now = Date.now()) {
  return getActiveTasks().filter((task) => !isSnoozed(task, now));
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function getDueStatus(task, today = getLocalDateKey()) {
  if (!task.dueDate) {
    return null;
  }

  if (task.dueDate < today) {
    return 'overdue';
  }

  return task.dueDate === today ? 'today' : null;
}

function getWaitingHours(task, now = Date.now()) {
  return Math.max(0, Math.floor((now - task.createdAt) / (60 * 60 * 1000)));
}

function getTaskSelection(task, now = Date.now()) {
  const reasons = [];
  let score = 0;
  const dueStatus = getDueStatus(task);

  if (dueStatus === 'overdue') {
    score += 60;
    reasons.push('Picked because it is overdue.');
  } else if (dueStatus === 'today') {
    score += 60;
    reasons.push('Picked because it is due today.');
  }

  if (task.energy === currentEnergy) {
    score += 30;
    reasons.push('Picked because it matches your ' + currentEnergy + '-energy setting.');
  }

  if (task.estimatedMinutes !== null && task.estimatedMinutes <= 15) {
    score += 20;
    reasons.push('Picked because it is a short task.');
  }

  if (task.firstStep) {
    score += 10;
    reasons.push('Picked because it already has a clear first step.');
  }

  const waitingScore = Math.min(15, getWaitingHours(task, now));
  if (waitingScore > 0) {
    score += waitingScore;
    reasons.push('Picked because it has been waiting in your queue.');
  }

  if (reasons.length === 0) {
    reasons.push('Picked because it is the earliest active task in your queue.');
  }

  return { task, score, reasons };
}

function getRankedTasks(now = Date.now()) {
  return getEligibleTasks(now)
    .map((task) => getTaskSelection(task, now))
    .sort((first, second) => {
      if (first.score !== second.score) {
        return second.score - first.score;
      }

      if (first.task.createdAt !== second.task.createdAt) {
        return first.task.createdAt - second.task.createdAt;
      }

      return first.task.id.localeCompare(second.task.id);
    });
}

function getCurrentRecommendation() {
  const rankedTasks = getRankedTasks();

  if (rankedTasks.length === 0) {
    return null;
  }

  return rankedTasks.find((selection) => selection.task.id === selectedTaskId) || rankedTasks[0];
}

function showStatus(message) {
  el('form-message').textContent = message;
}

function showNextStatus(message) {
  el('next-message').textContent = message;
}

function formatEnergy(energy) {
  return energy.charAt(0).toUpperCase() + energy.slice(1) + ' energy';
}

function formatDueDate(dueDate) {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(dueDate + 'T12:00:00'));
}

function formatSnoozeTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function createActionButton(label, className, ariaLabel) {
  const button = document.createElement('button');
  button.className = 'text-button ' + className;
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-label', ariaLabel);
  return button;
}

function renderTaskList() {
  const visibleTasks = tasks.filter((task) => filter === 'all' || task.energy === filter);
  const taskList = el('task-list');

  taskList.innerHTML = '';

  visibleTasks.forEach((task) => {
    const item = document.createElement('li');
    const checkbox = document.createElement('input');
    const content = document.createElement('div');
    const title = document.createElement('span');
    const energy = document.createElement('span');
    const actions = document.createElement('div');
    const taskIsSnoozed = isSnoozed(task);

    item.className = 'task-row' + (task.done ? ' is-done' : '');
    checkbox.type = 'checkbox';
    checkbox.checked = task.done;
    checkbox.setAttribute('aria-label', 'Mark ' + task.text + ' complete');

    content.className = 'task-content';
    title.className = 'task-text';
    title.textContent = task.text;
    content.append(title);

    if (taskIsSnoozed) {
      const snoozeLabel = document.createElement('span');
      snoozeLabel.className = 'snooze-label';
      snoozeLabel.textContent = 'Snoozed until ' + formatSnoozeTime(task.snoozedUntil);
      content.append(snoozeLabel);
    }

    energy.className = 'energy-tag';
    energy.textContent = task.energy + ' energy';
    actions.className = 'task-actions';

    if (taskIsSnoozed) {
      const wakeButton = createActionButton('Wake now', 'wake-task', 'Wake ' + task.text + ' now');
      wakeButton.addEventListener('click', () => {
        task.snoozedUntil = null;
        selectedTaskId = null;
        saveTasks();
        render();
        showNextStatus('Back in your active queue.');
      });
      actions.append(wakeButton);
    }

    const deleteButton = createActionButton('Delete', 'delete-task', 'Delete ' + task.text);
    deleteButton.addEventListener('click', () => {
      tasks = tasks.filter((savedTask) => savedTask.id !== task.id);
      selectedTaskId = null;
      saveTasks();
      render();
    });
    actions.append(deleteButton);

    checkbox.addEventListener('change', () => {
      task.done = !task.done;
      task.completedAt = task.done ? Date.now() : null;
      selectedTaskId = null;
      saveTasks();
      render();
    });

    item.append(checkbox, content, energy, actions);
    taskList.append(item);
  });

  renderEmptyState(visibleTasks);
}

function renderWhyTask(reasons) {
  const whyList = el('why-list');
  whyList.innerHTML = '';

  reasons.forEach((reason) => {
    const item = document.createElement('li');
    item.textContent = reason;
    whyList.append(item);
  });
}

function renderNextAction() {
  const recommendation = getCurrentRecommendation();
  const hasActiveTasks = getActiveTasks().length > 0;

  el('current-energy-input').value = currentEnergy;

  if (!recommendation) {
    el('next-task').textContent = hasActiveTasks
      ? 'No task is ready right now. Wake a snoozed task when you are ready.'
      : 'Your queue is clear. Take a breath.';
    el('next-details').hidden = true;
    el('start-focus').disabled = true;
    el('pick-another').disabled = true;
    el('complete-next').disabled = true;
    el('snooze-control').hidden = true;
    return;
  }

  const task = recommendation.task;
  const dueStatus = getDueStatus(task);

  el('next-task').textContent = task.text;
  el('next-details').hidden = false;
  el('next-energy').textContent = 'Energy: ' + formatEnergy(task.energy);
  el('next-time').textContent = task.estimatedMinutes
    ? 'Estimated time: ' + task.estimatedMinutes + ' minutes'
    : 'No time estimate yet.';
  el('next-first-step').hidden = !task.firstStep;
  el('next-first-step').textContent = task.firstStep ? 'Start with: ' + task.firstStep : '';
  el('next-due-date').hidden = !task.dueDate;
  el('next-due-date').textContent = task.dueDate
    ? 'Due: ' +
      formatDueDate(task.dueDate) +
      (dueStatus === 'today' ? ' (today)' : dueStatus === 'overdue' ? ' (overdue)' : '')
    : '';
  renderWhyTask(recommendation.reasons);

  el('start-focus').disabled = false;
  el('pick-another').disabled = false;
  el('complete-next').disabled = false;
  el('snooze-control').hidden = false;
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
    showStatus('Keep task titles under ' + maxTitleLength + ' characters.');
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
  selectedTaskId = null;
  saveTasks();
  titleInput.value = '';
  clearContextFields();
  showStatus('Added. Your next action is ready.');
  render();
  titleInput.focus();
}

function completeNextTask() {
  const recommendation = getCurrentRecommendation();

  if (!recommendation) {
    return;
  }

  recommendation.task.done = true;
  recommendation.task.completedAt = Date.now();
  selectedTaskId = null;
  saveTasks();
  render();
}

function clearCompletedTasks() {
  tasks = tasks.filter((task) => !task.done);
  selectedTaskId = null;
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

function setCurrentEnergy() {
  currentEnergy = el('current-energy-input').value;
  selectedTaskId = null;
  saveCurrentEnergy();
  render();
  showNextStatus('Suggestions now prefer ' + currentEnergy + '-energy tasks.');
}

function pickAnotherTask() {
  const rankedTasks = getRankedTasks();
  const currentRecommendation = getCurrentRecommendation();
  const currentIndex = rankedTasks.findIndex(
    (selection) => selection.task.id === currentRecommendation?.task.id,
  );

  if (rankedTasks.length === 0) {
    return;
  }

  if (rankedTasks.length === 1) {
    showNextStatus('This is the only active task that matches right now.');
    return;
  }

  selectedTaskId = rankedTasks[(currentIndex + 1) % rankedTasks.length].task.id;
  render();
  showNextStatus('Here is another active task in the same suggested order.');
}

function getSnoozeTime(choice, now = new Date()) {
  const snoozeTime = new Date(now);

  if (choice === 'later-today') {
    snoozeTime.setHours(18, 0, 0, 0);
    if (snoozeTime <= now) {
      snoozeTime.setTime(now.getTime() + 60 * 60 * 1000);
    }
  } else if (choice === 'tomorrow') {
    snoozeTime.setDate(snoozeTime.getDate() + 1);
    snoozeTime.setHours(8, 0, 0, 0);
  } else if (choice === 'next-week') {
    snoozeTime.setDate(snoozeTime.getDate() + 7);
    snoozeTime.setHours(8, 0, 0, 0);
  }

  return snoozeTime.getTime();
}

function snoozeCurrentTask(choice) {
  const recommendation = getCurrentRecommendation();

  if (!recommendation) {
    return;
  }

  recommendation.task.snoozedUntil = getSnoozeTime(choice);
  selectedTaskId = null;
  el('snooze-control').open = false;
  saveTasks();
  render();
  showNextStatus(
    'Snoozed until ' +
      formatSnoozeTime(recommendation.task.snoozedUntil) +
      '. It is still in your queue.',
  );
}

function startFocus() {
  let seconds = 600;
  clearInterval(focusTimer);
  el('start-focus').textContent = 'Focus running';
  el('start-focus').disabled = true;

  function tick() {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = String(seconds % 60).padStart(2, '0');
    el('focus-status').textContent =
      'Focus session: ' + minutes + ':' + remainingSeconds + ' remaining.';

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
el('current-energy-input').addEventListener('change', setCurrentEnergy);
el('pick-another').addEventListener('click', pickAnotherTask);

document.querySelectorAll('[data-snooze]').forEach((button) => {
  button.addEventListener('click', () => snoozeCurrentTask(button.dataset.snooze));
});

document.querySelectorAll('.filter').forEach((button) => {
  button.addEventListener('click', () => setFilter(button));
});

applyTheme();
render();
