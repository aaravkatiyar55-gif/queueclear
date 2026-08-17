const storageKey = 'queueclear.tasks.v2';
const legacyStorageKey = 'queueclear.tasks.v1';
const themeKey = 'queueclear.theme.v1';
const currentEnergyKey = 'queueclear.current-energy.v1';
const timeAvailableKey = 'queueclear.time-available.v1';
const energyLevels = ['low', 'medium', 'high'];
const estimateOptions = [5, 10, 15, 25, 45, 60];
const timeAvailableOptions = [5, 15, 25, 45];
const maxTitleLength = 110;
const maxFirstStepLength = 180;

let tasks = readTasks();
let currentEnergy = readCurrentEnergy();
let timeAvailable = readTimeAvailable();
let focusTimer = null;
let focusSeconds = 600;
let focusTaskId = null;
let pendingRestore = null;
const statusTimers = {};

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

function readTimeAvailable() {
  const saved = Number(localStorage.getItem(timeAvailableKey));
  return timeAvailableOptions.includes(saved) ? saved : null;
}

function saveTimeAvailable() {
  localStorage.setItem(timeAvailableKey, timeAvailable === null ? '' : String(timeAvailable));
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

function getTasksThatFitTime(tasksToCheck) {
  if (timeAvailable === null) {
    return [];
  }

  return tasksToCheck.filter(
    (task) => task.estimatedMinutes !== null && task.estimatedMinutes <= timeAvailable,
  );
}

function getSuggestion() {
  const available = getAvailableTasks();
  const matchesEnergy = available.filter((task) => task.energy === currentEnergy);
  const energyCandidates = matchesEnergy.length > 0 ? matchesEnergy : available;
  const timeMatches = getTasksThatFitTime(energyCandidates);
  const candidates = timeMatches.length > 0 ? timeMatches : energyCandidates;

  return {
    task: candidates.slice().sort(compareByEstimateThenQueueOrder)[0] || null,
    available,
    candidates,
    energyFilteredChoices: matchesEnergy.length > 0 && matchesEnergy.length < available.length,
    usedEnergyFallback: matchesEnergy.length === 0 && available.length > 0,
    usedTimeFit: timeMatches.length > 0,
    usedTimeFallback: timeAvailable !== null && timeMatches.length === 0 && available.length > 0,
  };
}

function getSuggestedTask() {
  return getSuggestion().task;
}

function getTieBreakReason(task, candidates) {
  if (candidates.length === 1) {
    return 'It is the only task ready right now.';
  }

  if (task.estimatedMinutes !== null) {
    const sameEstimate = candidates.filter(
      (candidate) => candidate.estimatedMinutes === task.estimatedMinutes,
    );
    const hasLongerEstimate = candidates.some(
      (candidate) =>
        candidate.estimatedMinutes === null || candidate.estimatedMinutes > task.estimatedMinutes,
    );

    if (hasLongerEstimate && sameEstimate.length === 1) {
      return 'It has the shortest available estimate.';
    }

    if (hasLongerEstimate) {
      return 'It is tied for the shortest estimate and was added first.';
    }
  }

  return 'The remaining choices are tied, so QueueClear kept the task added first.';
}

function getSuggestionReason(suggestion) {
  const {
    task,
    candidates,
    energyFilteredChoices,
    usedEnergyFallback,
    usedTimeFit,
    usedTimeFallback,
  } = suggestion;
  const reasons = [];

  if (energyFilteredChoices) {
    reasons.push('It matches your ' + currentEnergy + '-energy setting.');
  }

  if (usedEnergyFallback) {
    reasons.push('No task matches your ' + currentEnergy + '-energy setting.');
  }

  if (usedTimeFit) {
    reasons.push('It fits the ' + formatAvailableTime(timeAvailable) + ' you have.');
  }

  if (usedTimeFallback) {
    reasons.push(
      'No estimated task fits the ' + formatAvailableTime(timeAvailable) + ' you have, so this is the closest ready option.',
    );
  }

  if (candidates.length > 1 || reasons.length === 0 || usedEnergyFallback || usedTimeFallback) {
    reasons.push(getTieBreakReason(task, candidates));
  }

  return reasons.join(' ');
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

function formatAvailableTime(minutes) {
  return minutes + ' minutes';
}

function getThemePreference() {
  return localStorage.getItem(themeKey) === 'calm' ? 'calm' : 'paper';
}

function getBackupFileName(date = new Date()) {
  const datePart = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');

  return 'queueclear-backup-' + datePart + '.json';
}

function buildBackup() {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    tasks,
    theme: getThemePreference(),
    currentEnergy,
    timeAvailable,
  };
}

function downloadBackup() {
  const backupFile = new Blob([JSON.stringify(buildBackup(), null, 2)], {
    type: 'application/json',
  });
  const downloadUrl = URL.createObjectURL(backupFile);
  const downloadLink = document.createElement('a');

  downloadLink.href = downloadUrl;
  downloadLink.download = getBackupFileName();
  document.body.append(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
  showStatus('data-message', 'Backup downloaded.');
}

function hasOwnProperty(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property);
}

function getRestoredPreference(backup, key, isValid, fallback) {
  if (!hasOwnProperty(backup, key)) {
    return { value: fallback, included: false };
  }

  if (!isValid(backup[key])) {
    throw new Error('This backup has an unsupported ' + key + ' preference.');
  }

  return { value: backup[key], included: true };
}

function validateBackup(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('This file is not a QueueClear backup.');
  }

  if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.tasks)) {
    throw new Error('This backup has an unsupported QueueClear structure.');
  }

  const restoredTasks = candidate.tasks.map(normalizeTask);
  if (restoredTasks.some((task) => task === null)) {
    throw new Error('This backup contains a task QueueClear cannot recover safely.');
  }

  const taskIds = new Set(restoredTasks.map((task) => task.id));
  if (taskIds.size !== restoredTasks.length) {
    throw new Error('This backup contains duplicate task IDs.');
  }

  const theme = getRestoredPreference(
    candidate,
    'theme',
    (value) => value === 'paper' || value === 'calm',
    'paper',
  );
  const energy = getRestoredPreference(
    candidate,
    'currentEnergy',
    (value) => energyLevels.includes(value),
    'medium',
  );
  const availableTime = getRestoredPreference(
    candidate,
    'timeAvailable',
    (value) => value === null || timeAvailableOptions.includes(value),
    null,
  );

  return {
    tasks: restoredTasks,
    theme,
    currentEnergy: energy,
    timeAvailable: availableTime,
  };
}

function formatRestorePreference(label, preference, fallbackLabel) {
  return preference.included
    ? label + ': saved'
    : label + ': not included (' + fallbackLabel + ' will be used)';
}

function renderRestorePreview(backup) {
  const taskLabel = backup.tasks.length === 1 ? 'task' : 'tasks';
  el('restore-summary').textContent =
    'Valid backup: ' + backup.tasks.length + ' recoverable ' + taskLabel + '.';
  el('restore-preferences').textContent = [
    formatRestorePreference('Theme', backup.theme, 'paper'),
    formatRestorePreference('Energy', backup.currentEnergy, 'medium'),
    formatRestorePreference('Available time', backup.timeAvailable, 'no limit'),
  ].join(' ');
  el('restore-preview').hidden = false;
  el('confirm-restore').focus();
}

function clearRestorePreview({ returnFocus = false } = {}) {
  pendingRestore = null;
  el('restore-preview').hidden = true;
  el('restore-backup-input').value = '';

  if (returnFocus) {
    el('restore-backup').focus();
  }
}

async function previewRestoreBackup(event) {
  const backupFile = event.target.files?.[0];
  if (!backupFile) {
    return;
  }

  const isJsonFile =
    backupFile.name.toLowerCase().endsWith('.json') || backupFile.type === 'application/json';
  if (!isJsonFile) {
    clearRestorePreview();
    showStatus('data-message', 'Choose a QueueClear JSON backup file.');
    return;
  }

  try {
    let parsedBackup;
    try {
      parsedBackup = JSON.parse(await backupFile.text());
    } catch {
      throw new Error('That file is not valid JSON. Choose a QueueClear backup file.');
    }

    pendingRestore = validateBackup(parsedBackup);
    renderRestorePreview(pendingRestore);
  } catch (error) {
    clearRestorePreview();
    showStatus(
      'data-message',
      error instanceof Error ? error.message : 'QueueClear could not read that backup.',
    );
  }
}

function openRestorePicker() {
  clearRestorePreview();
  el('restore-backup-input').click();
}

function restoreBackup() {
  if (!pendingRestore) {
    showStatus('data-message', 'Choose a valid backup before restoring.');
    return;
  }

  tasks = pendingRestore.tasks;
  currentEnergy = pendingRestore.currentEnergy.value;
  timeAvailable = pendingRestore.timeAvailable.value;
  localStorage.setItem(storageKey, JSON.stringify(tasks));
  localStorage.removeItem(legacyStorageKey);
  localStorage.setItem(themeKey, pendingRestore.theme.value);
  localStorage.setItem(currentEnergyKey, currentEnergy);
  localStorage.setItem(
    timeAvailableKey,
    timeAvailable === null ? '' : String(timeAvailable),
  );

  clearInterval(focusTimer);
  focusTimer = null;
  focusSeconds = 600;
  focusTaskId = null;
  clearRestorePreview();
  applyTheme();
  render();
  showStatus('data-message', 'Backup restored in this browser.');
  el('restore-backup').focus();
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

function showStatus(id, message) {
  el(id).textContent = message;
  clearTimeout(statusTimers[id]);
  statusTimers[id] = setTimeout(() => {
    el(id).textContent = '';
  }, 6000);
}

function showFormStatus(message) {
  showStatus('form-message', message);
}

function showNextStatus(message) {
  showStatus('next-message', message);
}

function clearCaptureContext() {
  el('estimated-minutes').value = '';
  el('first-step-input').value = '';
}

function renderSuggestion() {
  const recommendation = getSuggestion();
  const suggestion = recommendation.task;
  const hasActiveTasks = getActiveTasks().length > 0;

  el('current-energy-input').value = currentEnergy;
  el('current-energy-help').textContent =
    'QueueClear looks for ' + currentEnergy + '-energy tasks first.';
  el('time-available-input').value = timeAvailable === null ? '' : String(timeAvailable);

  if (!suggestion) {
    el('next-task').textContent = hasActiveTasks
      ? 'Everything active is snoozed. Wake a task below if your plans changed; otherwise it returns tomorrow.'
      : 'Your queue is clear. Add one small task above.';
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
  el('next-first-step').hidden = false;
  el('next-first-step').textContent = suggestion.firstStep
    ? 'First step: ' + suggestion.firstStep
    : 'No first step saved. Begin with the smallest visible part.';
  el('why-task').textContent = getSuggestionReason(recommendation);
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
  showNextStatus(
    task.done ? 'Marked done. It moved out of your active queue.' : 'Back in your active queue.',
  );
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
  showNextStatus('Marked done. It moved out of your active queue.');
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
  showNextStatus('Snoozed until tomorrow. It will return then and stays in your list.');
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
  const timerTask = focusTask || suggestedTask;
  const canResume = Boolean(focusTask && focusTimer === null && focusSeconds > 0);

  el('timer-display').textContent = formatFocusTime(focusSeconds);
  el('timer-task').textContent = timerTask
    ? 'For: ' + timerTask.text
    : 'Choose a task first.';
  el('start-focus').disabled = focusTimer !== null || (!suggestedTask && !focusTask);
  el('start-focus').textContent = canResume ? 'Resume focus' : 'Start 10-minute focus';
  el('start-focus').setAttribute(
    'aria-label',
    timerTask
      ? (canResume ? 'Resume focus for ' : 'Start 10-minute focus for ') + timerTask.text
      : 'Start 10-minute focus',
  );
  el('pause-focus').disabled = focusTimer === null;
  el('pause-focus').setAttribute(
    'aria-label',
    focusTask ? 'Pause focus for ' + focusTask.text : 'Pause focus',
  );
  el('reset-focus').disabled = focusTimer === null && focusSeconds === 600;
}

function tickFocus() {
  focusSeconds -= 1;

  if (focusSeconds <= 0) {
    const completedTask = getFocusTask();
    clearInterval(focusTimer);
    focusTimer = null;
    focusTaskId = null;
    focusSeconds = 0;
    renderTimer();
    setFocusStatus(
      completedTask
        ? 'Focus session finished for ' + completedTask.text + '. Decide whether it is done or needs another session.'
        : 'Focus session finished. Decide whether the task is done or needs another session.',
    );
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
  setFocusStatus('Focus started for ' + task.text + '.');
}

function pauseFocus() {
  if (focusTimer === null) {
    return;
  }

  clearInterval(focusTimer);
  focusTimer = null;
  renderTimer();
  const focusTask = getFocusTask();
  setFocusStatus(focusTask ? 'Focus paused for ' + focusTask.text + '.' : 'Focus paused.');
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

function setTimeAvailable() {
  const selectedMinutes = Number(el('time-available-input').value);
  timeAvailable = timeAvailableOptions.includes(selectedMinutes) ? selectedMinutes : null;
  saveTimeAvailable();
  render();
  showNextStatus(
    timeAvailable === null
      ? 'Start here can use tasks of any estimate.'
      : 'Start here will first look for tasks that fit ' + formatAvailableTime(timeAvailable) + '.',
  );
}

function applyTheme() {
  const isCalm = getThemePreference() === 'calm';
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
el('time-available-input').addEventListener('change', setTimeAvailable);
el('download-backup').addEventListener('click', downloadBackup);
el('restore-backup').addEventListener('click', openRestorePicker);
el('restore-backup-input').addEventListener('change', previewRestoreBackup);
el('confirm-restore').addEventListener('click', restoreBackup);
el('cancel-restore').addEventListener('click', () => clearRestorePreview({ returnFocus: true }));
el('start-focus').addEventListener('click', startFocus);
el('pause-focus').addEventListener('click', pauseFocus);
el('reset-focus').addEventListener('click', () => stopFocus('Timer reset.'));
el('snooze-task').addEventListener('click', snoozeSuggestedTask);
el('complete-next').addEventListener('click', markSuggestedTaskDone);
el('theme-toggle').addEventListener('click', toggleTheme);

applyTheme();
render();
