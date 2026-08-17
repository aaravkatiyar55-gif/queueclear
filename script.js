const storageKey = 'queueclear.tasks.v2';
const legacyStorageKey = 'queueclear.tasks.v1';
const themeKey = 'queueclear.theme.v1';
const currentEnergyKey = 'queueclear.current-energy.v1';
const energyLevels = ['low', 'medium', 'high'];
const estimateOptions = [5, 10, 15, 25, 45, 60];
const maxTitleLength = 110;
const maxFirstStepLength = 180;

let tasks = readTasks();
let currentEnergy = readCurrentEnergy();
let focusTimer = null;
let focusSeconds = 600;
let focusTaskId = null;

const el = (id) => document.getElementById(id);

function normalizeWhitespace(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeTask(candidate) {
  const text = normalizeWhitespace(candidate?.text);
  const estimatedMinutes = Number(candidate?.estimatedMinutes);

  if (!text) {
    return null;
  }

  return {
    id: typeof candidate.id === 'string' ? candidate.id : crypto.randomUUID(),
    text,
    energy: energyLevels.includes(candidate.energy) ? candidate.energy : 'medium',
    done: Boolean(candidate.done),
    createdAt: normalizeTimestamp(candidate.createdAt) ?? Date.now(),
    estimatedMinutes: estimateOptions.includes(estimatedMinutes) ? estimatedMinutes : null,
    firstStep: normalizeWhitespace(candidate.firstStep).slice(0, maxFirstStepLength) || null,
    snoozedUntil: normalizeTimestamp(candidate.snoozedUntil),
    completedAt: normalizeTimestamp(candidate.completedAt),
    // Older tasks may include a date. QueueClear no longer uses it to rank tasks.
    dueDate: typeof candidate.dueDate === 'string' ? candidate.dueDate : null,
  };
}

function readTasks() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(storageKey) || localStorage.getItem(legacyStorageKey) || '[]',
    );
    return Array.isArray(saved) ? saved.map(normalizeTask).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveTasks() {
  localStorage.setItem(storageKey, JSON.stringify(tasks));
  localStorage.removeItem(legacyStorageKey);
}

function readCurrentEnergy() {
  const saved = localStorage.getItem(currentEnergyKey);
  return energyLevels.includes(saved) ? saved : 'medium';
}

function saveCurrentEnergy() {
  localStorage.setItem(currentEnergyKey, currentEnergy);
}

function createTask({ text, energy, estimatedMinutes, firstStep }) {
  return normalizeTask({
    id: crypto.randomUUID(),
    text,
    energy,
    done: false,
    createdAt: Date.now(),
    estimatedMinutes,
    firstStep,
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

function getAvailableTasks() {
  return getActiveTasks().filter((task) => !isSnoozed(task));
}

function compareByEstimateThenQueueOrder(first, second) {
  const firstEstimate = first.estimatedMinutes;
  const secondEstimate = second.estimatedMinutes;

  if (firstEstimate !== null && secondEstimate !== null && firstEstimate !== secondEstimate) {
    return firstEstimate - secondEstimate;
  }

  if (firstEstimate !== null && secondEstimate === null) {
    return -1;
  }

  if (firstEstimate === null && secondEstimate !== null) {
    return 1;
  }

  return first.createdAt - second.createdAt;
}

function getSuggestedTask() {
  const available = getAvailableTasks();
  const matchesEnergy = available.filter((task) => task.energy === currentEnergy);
  const candidates = matchesEnergy.length > 0 ? matchesEnergy : available;

  if (candidates.length === 0) {
    return null;
  }

  return candidates.slice().sort(compareByEstimateThenQueueOrder)[0];
}

function getSuggestionReason(task) {
  const matchesEnergy = task.energy === currentEnergy;

  if (matchesEnergy && task.estimatedMinutes) {
    return (
      'Picked because it matches your ' +
      currentEnergy +
      '-energy setting and should take about ' +
      task.estimatedMinutes +
      ' minutes.'
    );
  }

  if (matchesEnergy) {
    return 'Picked because it matches your ' + currentEnergy + '-energy setting.';
  }

  if (task.estimatedMinutes) {
    return 'Picked because it is one of the shortest tasks available right now.';
  }

  return 'Picked because it is the first available task in your queue.';
}

function formatEnergy(energy) {
  return energy.charAt(0).toUpperCase() + energy.slice(1) + ' energy';
}

function formatEstimate(minutes, longForm = false) {
  if (!minutes) {
    return '';
  }

  return longForm ? 'About ' + minutes + ' minutes' : minutes + ' min';
}

function getTaskContext(task, { longEstimate = false, includeFirstStep = true } = {}) {
  const details = [];

  if (task.estimatedMinutes) {
    details.push(formatEstimate(task.estimatedMinutes, longEstimate));
  }

  if (includeFirstStep && task.firstStep) {
    details.push('First step: ' + task.firstStep);
  }

  return details;
}

function formatFocusTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  return minutes + ':' + String(seconds % 60).padStart(2, '0');
}

function formatSnoozeTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function showFormStatus(message) {
  el('form-message').textContent = message;
}

function showNextStatus(message) {
  el('next-message').textContent = message;
}

function clearCaptureContext() {
  el('estimated-minutes').value = '';
  el('first-step-input').value = '';
}

function renderSuggestion() {
  const suggestion = getSuggestedTask();
  const hasActiveTasks = getActiveTasks().length > 0;

  el('current-energy-input').value = currentEnergy;

  if (!suggestion) {
    el('next-task').textContent = hasActiveTasks
      ? 'Nothing is ready right now. Wake a snoozed task when you are ready.'
      : 'Add a task when something comes up.';
    el('next-details').hidden = true;
    el('snooze-task').disabled = true;
    el('complete-next').disabled = true;
    return;
  }

  const details = [
    formatEnergy(suggestion.energy),
    ...getTaskContext(suggestion, { longEstimate: true, includeFirstStep: false }),
  ];

  el('next-task').textContent = suggestion.text;
  el('next-meta').textContent = details.join(' · ');
  el('next-first-step').hidden = !suggestion.firstStep;
  el('next-first-step').textContent = suggestion.firstStep
    ? 'First step: ' + suggestion.firstStep
    : '';
  el('why-task').textContent = getSuggestionReason(suggestion);
  el('next-details').hidden = false;
  el('snooze-task').disabled = false;
  el('complete-next').disabled = false;
}

function createTaskButton(label, className, ariaLabel) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'text-button ' + className;
  button.textContent = label;
  button.setAttribute('aria-label', ariaLabel);
  return button;
}

function renderTaskList() {
  const taskList = el('task-list');
  taskList.innerHTML = '';

  tasks.forEach((task) => {
    const item = document.createElement('li');
    const checkbox = document.createElement('input');
    const content = document.createElement('div');
    const title = document.createElement('span');
    const meta = document.createElement('span');
    const energy = document.createElement('span');
    const actions = document.createElement('div');

    item.className = 'task-row' + (task.done ? ' is-done' : '');
    checkbox.type = 'checkbox';
    checkbox.checked = task.done;
    checkbox.setAttribute('aria-label', 'Mark ' + task.text + ' complete');
    checkbox.addEventListener('change', () => toggleTaskDone(task.id));

    content.className = 'task-content';
    title.className = 'task-text';
    title.textContent = task.text;
    content.append(title);

    const details = getTaskContext(task);
    if (details.length > 0) {
      meta.className = 'task-meta';
      meta.textContent = details.join(' · ');
      content.append(meta);
    }

    if (isSnoozed(task)) {
      const snoozeLabel = document.createElement('span');
      snoozeLabel.className = 'snooze-label';
      snoozeLabel.textContent = 'Snoozed until ' + formatSnoozeTime(task.snoozedUntil);
      content.append(snoozeLabel);
    }

    energy.className = 'energy-tag';
    energy.textContent = formatEnergy(task.energy);
    actions.className = 'task-actions';

    if (isSnoozed(task)) {
      const wakeButton = createTaskButton('Wake now', 'wake-task', 'Wake ' + task.text + ' now');
      wakeButton.addEventListener('click', () => wakeTask(task.id));
      actions.append(wakeButton);
    }

    const deleteButton = createTaskButton('Delete', 'delete-task', 'Delete ' + task.text);
    deleteButton.addEventListener('click', () => deleteTask(task.id));
    actions.append(deleteButton);

    item.append(checkbox, content, energy, actions);
    taskList.append(item);
  });

  el('empty-state').hidden = tasks.length > 0;
}

function render() {
  renderSuggestion();
  renderTaskList();
  renderTimer();
}

function hasDuplicateActiveTitle(text) {
  const comparableTitle = text.toLocaleLowerCase();
  return getActiveTasks().some((task) => task.text.toLocaleLowerCase() === comparableTitle);
}

function handleTaskSubmit(event) {
  event.preventDefault();

  const titleInput = el('task-input');
  const text = normalizeWhitespace(titleInput.value);

  if (!text) {
    showFormStatus('Add a short task title first.');
    titleInput.focus();
    return;
  }

  if (text.length > maxTitleLength) {
    showFormStatus('Keep task titles under ' + maxTitleLength + ' characters.');
    titleInput.focus();
    return;
  }

  if (hasDuplicateActiveTitle(text)) {
    showFormStatus('That task is already in your active queue.');
    titleInput.focus();
    return;
  }

  const task = createTask({
    text,
    energy: el('energy-input').value,
    estimatedMinutes: el('estimated-minutes').value,
    firstStep: el('first-step-input').value,
  });

  tasks.push(task);
  saveTasks();
  titleInput.value = '';
  clearCaptureContext();
  showFormStatus('Added. Start here is ready.');
  render();
  titleInput.focus();
}

function toggleTaskDone(taskId) {
  const task = tasks.find((savedTask) => savedTask.id === taskId);
  if (!task) {
    return;
  }

  task.done = !task.done;
  task.completedAt = task.done ? Date.now() : null;

  if (task.id === focusTaskId && task.done) {
    stopFocus('Timer reset because the task was marked done.');
  }

  saveTasks();
  render();
}

function markSuggestedTaskDone() {
  const task = getSuggestedTask();
  if (!task) {
    return;
  }

  task.done = true;
  task.completedAt = Date.now();

  if (task.id === focusTaskId) {
    stopFocus('Timer reset because the task was marked done.');
  }

  saveTasks();
  render();
  showNextStatus('Marked done. See what feels realistic next.');
}

function deleteTask(taskId) {
  if (taskId === focusTaskId) {
    stopFocus('Timer reset because its task was deleted.');
  }

  tasks = tasks.filter((task) => task.id !== taskId);
  saveTasks();
  render();
  showNextStatus('Task deleted.');
}

function getTomorrowMorning() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  return tomorrow.getTime();
}

function snoozeSuggestedTask() {
  const task = getSuggestedTask();
  if (!task) {
    return;
  }

  task.snoozedUntil = getTomorrowMorning();

  if (task.id === focusTaskId) {
    stopFocus('Timer reset because this task was snoozed.');
  }

  saveTasks();
  render();
  showNextStatus('Snoozed until tomorrow. It is still in your list.');
}

function wakeTask(taskId) {
  const task = tasks.find((savedTask) => savedTask.id === taskId);
  if (!task) {
    return;
  }

  task.snoozedUntil = null;
  saveTasks();
  render();
  showNextStatus('Back in your list.');
}

function setFocusStatus(message) {
  el('focus-status').textContent = message;
}

function getFocusTask() {
  return focusTaskId
    ? tasks.find((task) => task.id === focusTaskId && !task.done) || null
    : null;
}

function renderTimer() {
  const suggestedTask = getSuggestedTask();
  const focusTask = getFocusTask();
  const canResume = Boolean(focusTask && focusSeconds > 0 && focusSeconds < 600);

  el('timer-display').textContent = formatFocusTime(focusSeconds);
  el('start-focus').disabled = focusTimer !== null || (!suggestedTask && !focusTask);
  el('start-focus').textContent = canResume ? 'Resume focus' : 'Start 10-minute focus';
  el('pause-focus').disabled = focusTimer === null;
  el('reset-focus').disabled = focusTimer === null && focusSeconds === 600;
}

function tickFocus() {
  focusSeconds -= 1;

  if (focusSeconds <= 0) {
    clearInterval(focusTimer);
    focusTimer = null;
    focusTaskId = null;
    focusSeconds = 0;
    renderTimer();
    setFocusStatus('Focus session finished. Decide what to do next.');
    showNextStatus('You can mark the task done or leave it in your list.');
    return;
  }

  renderTimer();
}

function startFocus() {
  if (focusTimer !== null) {
    return;
  }

  const task = getFocusTask() || getSuggestedTask();
  if (!task) {
    return;
  }

  if (focusSeconds <= 0) {
    focusSeconds = 600;
  }

  focusTaskId = task.id;
  focusTimer = setInterval(tickFocus, 1000);
  renderTimer();
  setFocusStatus('Focus started.');
  showNextStatus('Focus started.');
}

function pauseFocus() {
  if (focusTimer === null) {
    return;
  }

  clearInterval(focusTimer);
  focusTimer = null;
  renderTimer();
  setFocusStatus('Focus paused.');
}

function stopFocus(message) {
  clearInterval(focusTimer);
  focusTimer = null;
  focusSeconds = 600;
  focusTaskId = null;
  renderTimer();
  setFocusStatus(message || 'Timer reset.');
}

function setCurrentEnergy() {
  currentEnergy = el('current-energy-input').value;
  saveCurrentEnergy();
  render();
  showNextStatus('Start here now matches your ' + currentEnergy + '-energy setting.');
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
el('current-energy-input').addEventListener('change', setCurrentEnergy);
el('start-focus').addEventListener('click', startFocus);
el('pause-focus').addEventListener('click', pauseFocus);
el('reset-focus').addEventListener('click', () => stopFocus('Timer reset.'));
el('snooze-task').addEventListener('click', snoozeSuggestedTask);
el('complete-next').addEventListener('click', markSuggestedTaskDone);
el('theme-toggle').addEventListener('click', toggleTheme);

applyTheme();
render();
