const storageKey = 'queueclear.tasks.v2';
const legacyStorageKey = 'queueclear.tasks.v1';
const themeKey = 'queueclear.theme.v1';
const currentEnergyKey = 'queueclear.current-energy.v1';
const timeAvailableKey = 'queueclear.time-available.v1';
const settingsKey = 'queueclear.settings.v1';
const energyLevels = ['low', 'medium', 'high'];
const estimateOptions = [5, 10, 15, 25, 45, 60];
const timeAvailableOptions = [5, 15, 25, 45];
const focusDurationOptions = [5, 10, 15, 25];
const maxTitleLength = 110;
const maxFirstStepLength = 180;
const maxWaitingOnLength = 160;
const maxHandoffLength = 180;
const maxWorkspaceNameLength = 40;
const maxPersonalNoteLength = 140;
const defaultDocumentTitle = 'QueueClear — one task to start';
const queueFilterOptions = [
  'all',
  'ready',
  'waiting',
  'snoozed',
  'completed',
  'due-today',
  'low',
  'medium',
  'high',
];
const queueSortOptions = ['suggested', 'newest', 'oldest', 'shortest'];

let tasks = readTasks();
let currentEnergy = readCurrentEnergy();
let timeAvailable = readTimeAvailable();
let personalSettings = readPersonalSettings();
let focusTimer = null;
let focusSeconds = getDefaultFocusSeconds();
let focusTaskId = null;
let pendingRestore = null;
let lastUndo = null;
let sessionReviewTaskId = null;
let editingTaskId = null;
let suggestionOffset = 0;
let queueFilter = 'all';
let queueSort = 'suggested';
let queueSearch = '';
const statusTimers = {};

const el = (id) => document.getElementById(id);

function normalizeWhitespace(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function normalizeTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeDueDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  const isValid =
    parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
  return isValid ? value : null;
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
    waitingOn: normalizeWhitespace(candidate.waitingOn).slice(0, maxWaitingOnLength) || null,
    handoff: normalizeWhitespace(candidate.handoff).slice(0, maxHandoffLength) || null,
    handoffAt: normalizeTimestamp(candidate.handoffAt),
    snoozedUntil: normalizeTimestamp(candidate.snoozedUntil),
    completedAt: normalizeTimestamp(candidate.completedAt),
    dueDate: normalizeDueDate(candidate.dueDate),
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

function normalizePersonalSettings(candidate) {
  return {
    workspaceName:
      normalizeWhitespace(candidate?.workspaceName).slice(0, maxWorkspaceNameLength) || '',
    personalNote:
      normalizeWhitespace(candidate?.personalNote).slice(0, maxPersonalNoteLength) || '',
    focusMinutes: focusDurationOptions.includes(Number(candidate?.focusMinutes))
      ? Number(candidate.focusMinutes)
      : 10,
  };
}

function readPersonalSettings() {
  try {
    return normalizePersonalSettings(JSON.parse(localStorage.getItem(settingsKey) || '{}'));
  } catch {
    return normalizePersonalSettings({});
  }
}

function savePersonalSettings() {
  localStorage.setItem(settingsKey, JSON.stringify(personalSettings));
}

function getDefaultFocusSeconds() {
  return personalSettings.focusMinutes * 60;
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
    waitingOn: null,
    handoff: null,
    handoffAt: null,
    snoozedUntil: null,
    completedAt: null,
    dueDate,
  });
}

function getActiveTasks() {
  return tasks.filter((task) => !task.done);
}

function isSnoozed(task, now = Date.now()) {
  return task.snoozedUntil !== null && task.snoozedUntil > now;
}

function getAvailableTasks() {
  return getActiveTasks().filter((task) => !isSnoozed(task) && !isWaiting(task));
}

function isWaiting(task) {
  return Boolean(task.waitingOn);
}

function getWaitingTasks() {
  return getActiveTasks().filter(isWaiting);
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

  const orderedCandidates = candidates.slice().sort(compareByEstimateThenQueueOrder);
  const selectedIndex = orderedCandidates.length === 0 ? 0 : suggestionOffset % orderedCandidates.length;

  return {
    task: orderedCandidates[selectedIndex] || null,
    available,
    candidates: orderedCandidates,
    energyFilteredChoices: matchesEnergy.length > 0 && matchesEnergy.length < available.length,
    usedEnergyFallback: matchesEnergy.length === 0 && available.length > 0,
    usedTimeFit: timeMatches.length > 0,
    usedTimeFallback: timeAvailable !== null && timeMatches.length === 0 && available.length > 0,
  };
}

function resetSuggestionChoice() {
  suggestionOffset = 0;
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

  if (suggestionOffset > 0 && candidates.length > 1) {
    reasons.push('You chose another task from the same ready choices.');
    return reasons.join(' ');
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
    personalSettings,
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
  const settings = getRestoredPreference(
    candidate,
    'personalSettings',
    (value) =>
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof value.workspaceName === 'string' &&
      typeof value.personalNote === 'string' &&
      focusDurationOptions.includes(Number(value.focusMinutes)),
    normalizePersonalSettings({}),
  );

  return {
    tasks: restoredTasks,
    theme,
    currentEnergy: energy,
    timeAvailable: availableTime,
    personalSettings: settings,
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
    formatRestorePreference('Personal settings', backup.personalSettings, 'QueueClear defaults'),
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
  personalSettings = pendingRestore.personalSettings.value;
  localStorage.setItem(storageKey, JSON.stringify(tasks));
  localStorage.removeItem(legacyStorageKey);
  localStorage.setItem(themeKey, pendingRestore.theme.value);
  localStorage.setItem(currentEnergyKey, currentEnergy);
  localStorage.setItem(
    timeAvailableKey,
    timeAvailable === null ? '' : String(timeAvailable),
  );
  savePersonalSettings();

  clearInterval(focusTimer);
  focusTimer = null;
  focusSeconds = getDefaultFocusSeconds();
  focusTaskId = null;
  lastUndo = null;
  sessionReviewTaskId = null;
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
  el('due-date-input').value = '';
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
    const waitingCount = getWaitingTasks().length;
    el('next-task').textContent = hasActiveTasks
      ? waitingCount > 0
        ? 'Nothing is ready to start. Make a waiting task ready below when the blocker is gone.'
        : 'Everything active is snoozed. Wake a task below if your plans changed; otherwise it returns tomorrow.'
      : 'Your queue is clear. Add one small task above.';
    el('next-details').hidden = true;
    el('pick-another').disabled = true;
    el('snooze-options').hidden = true;
    el('complete-next').disabled = true;
    return;
  }

  const details = [
    formatEnergy(suggestion.energy),
    ...getTaskContext(suggestion, { longEstimate: true, includeFirstStep: false }),
  ];
  const dueDate = formatDueDate(suggestion.dueDate);
  if (dueDate) {
    details.push(dueDate);
  }

  el('next-task').textContent = suggestion.text;
  el('next-meta').textContent = details.join(' · ');
  el('next-first-step').hidden = false;
  el('next-first-step').textContent = suggestion.firstStep
    ? 'First step: ' + suggestion.firstStep
    : 'No first step saved. Begin with the smallest visible part.';
  el('next-handoff').hidden = !suggestion.handoff;
  el('next-handoff').textContent = suggestion.handoff
    ? 'Last handoff: ' + suggestion.handoff
    : '';
  el('why-task').textContent = getSuggestionReason(recommendation);
  el('next-details').hidden = false;
  el('pick-another').disabled = recommendation.candidates.length < 2;
  el('snooze-options').hidden = false;
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

function getLocalDatePart(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function isDueToday(task) {
  return task.dueDate === getLocalDatePart();
}

function formatDueDate(dueDate) {
  if (!dueDate) {
    return '';
  }

  const today = getLocalDatePart();
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = getLocalDatePart(tomorrowDate);
  if (dueDate < today) {
    return 'Overdue: ' + dueDate;
  }
  if (dueDate === today) {
    return 'Due today';
  }
  if (dueDate === tomorrow) {
    return 'Due tomorrow';
  }
  return 'Due ' + dueDate;
}

function matchesQueueFilter(task) {
  if (queueFilter === 'all') {
    return true;
  }
  if (queueFilter === 'ready') {
    return !task.done && !isSnoozed(task) && !isWaiting(task);
  }
  if (queueFilter === 'waiting') {
    return !task.done && isWaiting(task);
  }
  if (queueFilter === 'snoozed') {
    return !task.done && isSnoozed(task);
  }
  if (queueFilter === 'completed') {
    return task.done;
  }
  if (queueFilter === 'due-today') {
    return !task.done && isDueToday(task);
  }
  return task.energy === queueFilter;
}

function getSuggestedQueueOrder() {
  const suggested = getSuggestion().candidates;
  const suggestedIds = new Set(suggested.map((task) => task.id));
  return suggested.concat(tasks.filter((task) => !suggestedIds.has(task.id)));
}

function getVisibleQueueTasks() {
  const searchable = normalizeWhitespace(queueSearch).toLocaleLowerCase();
  let queueTasks = tasks.filter(
    (task) => !searchable || task.text.toLocaleLowerCase().includes(searchable),
  );
  queueTasks = queueTasks.filter(matchesQueueFilter);

  if (queueSort === 'newest') {
    return queueTasks.slice().sort((first, second) => second.createdAt - first.createdAt);
  }
  if (queueSort === 'oldest') {
    return queueTasks.slice().sort((first, second) => first.createdAt - second.createdAt);
  }
  if (queueSort === 'shortest') {
    return queueTasks.slice().sort(compareByEstimateThenQueueOrder);
  }

  const visibleIds = new Set(queueTasks.map((task) => task.id));
  return getSuggestedQueueOrder().filter((task) => visibleIds.has(task.id));
}

function createEditField(labelText, input) {
  const field = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = labelText;
  label.htmlFor = input.id;
  field.className = 'field';
  field.append(label, input);
  return field;
}

function createTaskEditForm(task) {
  const form = document.createElement('form');
  const titleInput = document.createElement('input');
  const energyInput = document.createElement('select');
  const estimateInput = document.createElement('select');
  const firstStepInput = document.createElement('input');
  const dueDateInput = document.createElement('input');
  const saveButton = document.createElement('button');
  const cancelButton = document.createElement('button');
  const suffix = task.id;

  form.className = 'task-edit-form';
  titleInput.id = 'edit-title-' + suffix;
  titleInput.maxLength = maxTitleLength;
  titleInput.value = task.text;
  energyInput.id = 'edit-energy-' + suffix;
  energyLevels.forEach((energy) => {
    const option = document.createElement('option');
    option.value = energy;
    option.textContent = formatEnergy(energy);
    option.selected = task.energy === energy;
    energyInput.append(option);
  });
  estimateInput.id = 'edit-estimate-' + suffix;
  const noEstimate = document.createElement('option');
  noEstimate.value = '';
  noEstimate.textContent = 'No estimate yet';
  estimateInput.append(noEstimate);
  estimateOptions.forEach((minutes) => {
    const option = document.createElement('option');
    option.value = String(minutes);
    option.textContent = minutes + ' minutes';
    option.selected = task.estimatedMinutes === minutes;
    estimateInput.append(option);
  });
  firstStepInput.id = 'edit-first-step-' + suffix;
  firstStepInput.maxLength = maxFirstStepLength;
  firstStepInput.value = task.firstStep || '';
  dueDateInput.id = 'edit-due-date-' + suffix;
  dueDateInput.type = 'date';
  dueDateInput.value = task.dueDate || '';
  saveButton.type = 'submit';
  saveButton.className = 'primary-button';
  saveButton.textContent = 'Save';
  cancelButton.type = 'button';
  cancelButton.className = 'text-button';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', cancelTaskEdit);

  form.append(
    createEditField('Task title', titleInput),
    createEditField('Energy needed', energyInput),
    createEditField('Estimated time', estimateInput),
    createEditField('First step', firstStepInput),
    createEditField('Due date', dueDateInput),
    saveButton,
    cancelButton,
  );
  form.addEventListener('submit', (event) => saveTaskEdit(event, task.id));
  return form;
}

function beginTaskEdit(taskId) {
  editingTaskId = taskId;
  renderTaskList();
  const titleInput = el('edit-title-' + taskId);
  if (titleInput) {
    titleInput.focus();
  }
}

function cancelTaskEdit() {
  editingTaskId = null;
  renderTaskList();
  showStatus('queue-message', 'Edit cancelled. The task was not changed.');
}

function saveTaskEdit(event, taskId) {
  event.preventDefault();
  const task = tasks.find((savedTask) => savedTask.id === taskId);
  const titleInput = el('edit-title-' + taskId);
  if (!task || !titleInput) {
    return;
  }

  const text = normalizeWhitespace(titleInput.value);
  if (!text) {
    showStatus('queue-message', 'Add a short task title before saving.');
    titleInput.focus();
    return;
  }
  if (text.length > maxTitleLength) {
    showStatus('queue-message', 'Keep task titles under ' + maxTitleLength + ' characters.');
    titleInput.focus();
    return;
  }
  if (getActiveTasks().some((candidate) => candidate.id !== taskId && candidate.text.toLocaleLowerCase() === text.toLocaleLowerCase())) {
    showStatus('queue-message', 'That task is already in your active queue.');
    titleInput.focus();
    return;
  }

  task.text = text;
  task.energy = el('edit-energy-' + taskId).value;
  task.estimatedMinutes = estimateOptions.includes(Number(el('edit-estimate-' + taskId).value))
    ? Number(el('edit-estimate-' + taskId).value)
    : null;
  task.firstStep = normalizeWhitespace(el('edit-first-step-' + taskId).value).slice(0, maxFirstStepLength) || null;
  task.dueDate = normalizeDueDate(el('edit-due-date-' + taskId).value);
  editingTaskId = null;
  resetSuggestionChoice();
  saveTasks();
  render();
  showStatus('queue-message', 'Task updated.');
}

function renderTaskList() {
  const taskList = el('task-list');
  taskList.innerHTML = '';
  el('queue-filter').value = queueFilter;
  el('queue-sort').value = queueSort;
  el('queue-search').value = queueSearch;
  const visibleTasks = getVisibleQueueTasks();

  visibleTasks.forEach((task) => {
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
    const dueDate = formatDueDate(task.dueDate);
    if (dueDate) {
      details.push(dueDate);
    }
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

    if (isWaiting(task)) {
      const waitingLabel = document.createElement('span');
      waitingLabel.className = 'waiting-label';
      waitingLabel.textContent = 'Waiting on: ' + task.waitingOn;
      content.append(waitingLabel);
    }

    if (editingTaskId === task.id) {
      content.replaceChildren(createTaskEditForm(task));
    }

    energy.className = 'energy-tag';
    energy.textContent = formatEnergy(task.energy);
    actions.className = 'task-actions';

    if (isSnoozed(task)) {
      const wakeButton = createTaskButton('Wake now', 'wake-task', 'Wake ' + task.text + ' now');
      wakeButton.addEventListener('click', () => wakeTask(task.id));
      actions.append(wakeButton);
    }

    if (isWaiting(task)) {
      const readyButton = createTaskButton(
        'Make ready',
        'make-ready-task',
        'Make ' + task.text + ' ready to choose',
      );
      readyButton.addEventListener('click', () => makeTaskReady(task.id));
      actions.append(readyButton);
    }

    if (editingTaskId !== task.id) {
      const editButton = createTaskButton('Edit', 'edit-task', 'Edit ' + task.text);
      editButton.addEventListener('click', () => beginTaskEdit(task.id));
      actions.append(editButton);
    }

    const deleteButton = createTaskButton('Delete', 'delete-task', 'Delete ' + task.text);
    deleteButton.addEventListener('click', () => deleteTask(task.id));
    actions.append(deleteButton);

    item.append(checkbox, content, energy, actions);
    taskList.append(item);
  });

  el('empty-state').hidden = visibleTasks.length > 0;
  el('empty-state').textContent = tasks.length === 0
    ? 'Your queue is clear. Add one small task above.'
    : 'No tasks match these queue controls.';
  el('clear-completed').disabled = !tasks.some((task) => task.done);
}

function renderUndoDelete() {
  const undoPanel = el('undo-delete');

  if (!lastUndo) {
    undoPanel.hidden = true;
    return;
  }

  if (lastUndo.type === 'delete') {
    el('undo-message').textContent = 'Deleted “' + lastUndo.task.text + '”.';
  } else if (lastUndo.type === 'complete') {
    el('undo-message').textContent = 'Marked “' + lastUndo.text + '” done.';
  } else {
    const label = lastUndo.items.length === 1 ? 'task' : 'tasks';
    el('undo-message').textContent = 'Cleared ' + lastUndo.items.length + ' completed ' + label + '.';
  }
  undoPanel.hidden = false;
}

function render() {
  renderPersonalSettings();
  renderSuggestion();
  renderWaitingRoom();
  renderTaskList();
  renderTimer();
  renderUndoDelete();
  renderSessionHandoff();
}

function renderPersonalSettings() {
  const hasWorkspaceName = Boolean(personalSettings.workspaceName);
  el('workspace-label').textContent = hasWorkspaceName
    ? personalSettings.workspaceName
    : 'QueueClear';
  el('workspace-name-input').value = personalSettings.workspaceName;
  el('personal-note-input').value = personalSettings.personalNote;
  el('focus-duration-input').value = String(personalSettings.focusMinutes);
  el('personal-note').textContent = personalSettings.personalNote;
  el('personal-note').hidden = !personalSettings.personalNote;
}

function saveSettingsFromForm() {
  const previousDefaultFocusSeconds = getDefaultFocusSeconds();
  personalSettings = normalizePersonalSettings({
    workspaceName: el('workspace-name-input').value,
    personalNote: el('personal-note-input').value,
    focusMinutes: el('focus-duration-input').value,
  });
  savePersonalSettings();

  if (focusTimer === null && focusSeconds === previousDefaultFocusSeconds) {
    focusSeconds = getDefaultFocusSeconds();
  }

  render();
  showStatus('data-message', 'Personal settings saved in this browser.');
}

function renderWaitingRoom() {
  const suggestion = getSuggestedTask();
  el('park-waiting').disabled = !suggestion;
  el('waiting-on-input').disabled = !suggestion;

  if (!suggestion) {
    el('waiting-on-input').value = '';
    el('waiting-on-input').placeholder = 'Choose a ready task before moving one to waiting';
    return;
  }

  el('waiting-on-input').placeholder = "e.g. Teacher's notes before I can revise";
}

function parkSuggestedTask() {
  const task = getSuggestedTask();
  const waitingOn = normalizeWhitespace(el('waiting-on-input').value).slice(0, maxWaitingOnLength);

  if (!task) {
    showStatus('waiting-message', 'Choose a ready task first.');
    return;
  }

  if (!waitingOn) {
    showStatus('waiting-message', 'Say what needs to happen before this task can be started.');
    el('waiting-on-input').focus();
    return;
  }

  task.waitingOn = waitingOn;
  resetSuggestionChoice();
  if (task.id === sessionReviewTaskId) {
    sessionReviewTaskId = null;
  }
  saveTasks();
  el('waiting-on-input').value = '';
  render();
  showNextStatus('Moved to waiting so it will not compete for your attention right now.');
}

function makeTaskReady(taskId) {
  const task = tasks.find((savedTask) => savedTask.id === taskId);
  if (!task) {
    return;
  }

  task.waitingOn = null;
  saveTasks();
  resetSuggestionChoice();
  render();
  showNextStatus('Back in your ready queue.');
}

function getSessionReviewTask() {
  return sessionReviewTaskId
    ? tasks.find((task) => task.id === sessionReviewTaskId && !task.done) || null
    : null;
}

function renderSessionHandoff() {
  const task = getSessionReviewTask();
  const handoffPanel = el('session-handoff');

  if (!task) {
    handoffPanel.hidden = true;
    return;
  }

  el('handoff-task').textContent = 'You just focused on: ' + task.text;
  el('handoff-input').value = task.handoff || '';
  handoffPanel.hidden = false;
}

function saveSessionHandoff() {
  const task = getSessionReviewTask();
  const handoff = normalizeWhitespace(el('handoff-input').value).slice(0, maxHandoffLength);

  if (!task) {
    return;
  }

  if (!handoff) {
    showStatus('handoff-message', 'Save one small next step or choose Not now.');
    el('handoff-input').focus();
    return;
  }

  task.handoff = handoff;
  task.handoffAt = Date.now();
  sessionReviewTaskId = null;
  saveTasks();
  render();
  showNextStatus('Handoff saved. Your next tiny step will be here when you return.');
}

function dismissSessionHandoff() {
  if (!getSessionReviewTask()) {
    return;
  }

  sessionReviewTaskId = null;
  render();
  showNextStatus('No handoff saved. The task stays in your ready queue.');
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
    dueDate: el('due-date-input').value,
  });

  tasks.push(task);
  resetSuggestionChoice();
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

  setTaskDone(task, !task.done);

  if (task.id === focusTaskId && task.done) {
    stopFocus('Timer reset because the task was marked done.');
  }

  if (task.id === sessionReviewTaskId && task.done) {
    sessionReviewTaskId = null;
  }

  saveTasks();
  resetSuggestionChoice();
  render();
  showNextStatus(
    task.done ? 'Marked done. It moved out of your active queue.' : 'Back in your active queue.',
  );
}

function setTaskDone(task, done) {
  const previousDone = task.done;
  const previousCompletedAt = task.completedAt;
  task.done = done;
  task.completedAt = done ? Date.now() : null;

  if (done && !previousDone) {
    lastUndo = {
      type: 'complete',
      taskId: task.id,
      text: task.text,
      previousDone,
      previousCompletedAt,
    };
  } else {
    lastUndo = null;
  }
}

function markSuggestedTaskDone() {
  const task = getSuggestedTask();
  if (!task) {
    return;
  }

  setTaskDone(task, true);

  if (task.id === focusTaskId) {
    stopFocus('Timer reset because the task was marked done.');
  }

  if (task.id === sessionReviewTaskId) {
    sessionReviewTaskId = null;
  }

  saveTasks();
  resetSuggestionChoice();
  render();
  showNextStatus('Marked done. It moved out of your active queue.');
}

function pickAnotherTask() {
  const suggestion = getSuggestion();
  if (suggestion.candidates.length < 2) {
    showNextStatus('This is the only active task that matches right now.');
    return;
  }

  suggestionOffset = (suggestionOffset + 1) % suggestion.candidates.length;
  render();
  showNextStatus('Here is another task that matches your current settings.');
}

function deleteTask(taskId) {
  const deletedIndex = tasks.findIndex((task) => task.id === taskId);
  if (deletedIndex === -1) {
    return;
  }

  const deletedTask = tasks[deletedIndex];

  if (taskId === focusTaskId) {
    stopFocus('Timer reset because its task was deleted.');
  }

  if (taskId === sessionReviewTaskId) {
    sessionReviewTaskId = null;
  }

  if (taskId === editingTaskId) {
    editingTaskId = null;
  }

  tasks = tasks.filter((task) => task.id !== taskId);
  lastUndo = {
    type: 'delete',
    index: deletedIndex,
    task: deletedTask,
  };
  saveTasks();
  resetSuggestionChoice();
  render();
  showNextStatus('Task deleted. Undo stays available until you refresh or delete another task.');
  el('undo-delete-task').focus();
}

function undoLastAction() {
  if (!lastUndo) {
    return;
  }

  if (lastUndo.type === 'delete') {
    if (tasks.some((task) => task.id === lastUndo.task.id)) {
      lastUndo = null;
      renderUndoDelete();
      showNextStatus('That task is already back in your list.');
      return;
    }

    const restoreIndex = Math.min(Math.max(lastUndo.index, 0), tasks.length);
    const restoredTask = lastUndo.task;
    tasks.splice(restoreIndex, 0, restoredTask);
    lastUndo = null;
    saveTasks();
    render();
    showNextStatus('Restored “' + restoredTask.text + '”.');
    return;
  }

  if (lastUndo.type === 'complete') {
    const task = tasks.find((candidate) => candidate.id === lastUndo.taskId);
    if (task) {
      task.done = lastUndo.previousDone;
      task.completedAt = lastUndo.previousCompletedAt;
    }
    lastUndo = null;
    saveTasks();
    resetSuggestionChoice();
    render();
    showNextStatus('Task returned to your active queue.');
    return;
  }

  lastUndo.items.forEach(({ index, task }) => {
    tasks.splice(Math.min(index, tasks.length), 0, task);
  });
  lastUndo = null;
  saveTasks();
  render();
  showNextStatus('Completed tasks restored.');
}

function clearCompletedTasks() {
  const items = tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => task.done);
  if (items.length === 0) {
    showStatus('queue-message', 'There are no completed tasks to clear.');
    return;
  }

  tasks = tasks.filter((task) => !task.done);
  lastUndo = { type: 'clear-completed', items };
  editingTaskId = null;
  saveTasks();
  resetSuggestionChoice();
  render();
  showStatus('queue-message', 'Completed tasks cleared. Undo is available until another change or refresh.');
}

function getSnoozeTime(option) {
  const date = new Date();
  if (option === 'later') {
    const laterToday = new Date(date);
    laterToday.setHours(Math.min(date.getHours() + 3, 20), 0, 0, 0);
    if (laterToday > date) {
      return laterToday.getTime();
    }
    date.setDate(date.getDate() + 1);
  } else if (option === 'next-week') {
    date.setDate(date.getDate() + 7);
  } else {
    date.setDate(date.getDate() + 1);
  }
  date.setHours(8, 0, 0, 0);
  return date.getTime();
}

function snoozeSuggestedTask(option) {
  const task = getSuggestedTask();
  if (!task) {
    return;
  }

  task.snoozedUntil = getSnoozeTime(option);

  if (task.id === focusTaskId) {
    stopFocus('Timer reset because this task was snoozed.');
  }

  if (task.id === sessionReviewTaskId) {
    sessionReviewTaskId = null;
  }

  saveTasks();
  resetSuggestionChoice();
  render();
  showNextStatus('Snoozed until ' + formatSnoozeTime(task.snoozedUntil) + '. It stays in your list.');
}

function wakeTask(taskId) {
  const task = tasks.find((savedTask) => savedTask.id === taskId);
  if (!task) {
    return;
  }

  task.snoozedUntil = null;
  saveTasks();
  resetSuggestionChoice();
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

  const defaultFocusSeconds = getDefaultFocusSeconds();
  el('timer-title').textContent = 'Focus for ' + personalSettings.focusMinutes + ' minutes';
  el('timer-display').textContent = formatFocusTime(focusSeconds);
  el('timer-task').textContent = timerTask
    ? 'For: ' + timerTask.text
    : 'Choose a task first.';
  el('start-focus').disabled = focusTimer !== null || (!suggestedTask && !focusTask);
  el('start-focus').textContent = canResume
    ? 'Resume focus'
    : 'Start ' + personalSettings.focusMinutes + '-minute focus';
  el('start-focus').setAttribute(
    'aria-label',
    timerTask
      ? (canResume ? 'Resume focus for ' : 'Start ' + personalSettings.focusMinutes + '-minute focus for ') + timerTask.text
      : 'Start ' + personalSettings.focusMinutes + '-minute focus',
  );
  el('pause-focus').disabled = focusTimer === null;
  el('pause-focus').setAttribute(
    'aria-label',
    focusTask ? 'Pause focus for ' + focusTask.text : 'Pause focus',
  );
  el('reset-focus').disabled = focusTimer === null && focusSeconds === defaultFocusSeconds;
  el('end-focus').disabled = !focusTask && focusTimer === null;
  document.title = focusTimer === null
    ? defaultDocumentTitle
    : formatFocusTime(focusSeconds) + ' — QueueClear';
}

function tickFocus() {
  focusSeconds -= 1;

  if (focusSeconds <= 0) {
    const completedTask = getFocusTask();
    clearInterval(focusTimer);
    focusTimer = null;
    focusTaskId = null;
    focusSeconds = 0;
    sessionReviewTaskId = completedTask ? completedTask.id : null;
    renderTimer();
    renderSessionHandoff();
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
    focusSeconds = getDefaultFocusSeconds();
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
  sessionReviewTaskId = focusTask ? focusTask.id : null;
  renderSessionHandoff();
  setFocusStatus(focusTask ? 'Focus paused for ' + focusTask.text + '.' : 'Focus paused.');
}

function stopFocus(message) {
  clearInterval(focusTimer);
  focusTimer = null;
  focusSeconds = getDefaultFocusSeconds();
  focusTaskId = null;
  sessionReviewTaskId = null;
  renderTimer();
  renderSessionHandoff();
  setFocusStatus(message || 'Timer reset.');
}

function setCurrentEnergy() {
  currentEnergy = el('current-energy-input').value;
  saveCurrentEnergy();
  resetSuggestionChoice();
  render();
  showNextStatus('Start here now matches your ' + currentEnergy + '-energy setting.');
}

function setTimeAvailable() {
  const selectedMinutes = Number(el('time-available-input').value);
  timeAvailable = timeAvailableOptions.includes(selectedMinutes) ? selectedMinutes : null;
  saveTimeAvailable();
  resetSuggestionChoice();
  render();
  showNextStatus(
    timeAvailable === null
      ? 'Start here can use tasks of any estimate.'
      : 'Start here will first look for tasks that fit ' + formatAvailableTime(timeAvailable) + '.',
  );
}

function updateQueueControls() {
  const selectedFilter = el('queue-filter').value;
  const selectedSort = el('queue-sort').value;
  queueFilter = queueFilterOptions.includes(selectedFilter) ? selectedFilter : 'all';
  queueSort = queueSortOptions.includes(selectedSort) ? selectedSort : 'suggested';
  queueSearch = el('queue-search').value;
  editingTaskId = null;
  renderTaskList();
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
el('save-personal-settings').addEventListener('click', saveSettingsFromForm);
el('park-waiting').addEventListener('click', parkSuggestedTask);
el('download-backup').addEventListener('click', downloadBackup);
el('restore-backup').addEventListener('click', openRestorePicker);
el('restore-backup-input').addEventListener('change', previewRestoreBackup);
el('confirm-restore').addEventListener('click', restoreBackup);
el('cancel-restore').addEventListener('click', () => clearRestorePreview({ returnFocus: true }));
el('start-focus').addEventListener('click', startFocus);
el('pause-focus').addEventListener('click', pauseFocus);
el('reset-focus').addEventListener('click', () => stopFocus('Timer reset.'));
el('save-handoff').addEventListener('click', saveSessionHandoff);
el('dismiss-handoff').addEventListener('click', dismissSessionHandoff);
el('pick-another').addEventListener('click', pickAnotherTask);
el('snooze-later').addEventListener('click', () => snoozeSuggestedTask('later'));
el('snooze-tomorrow').addEventListener('click', () => snoozeSuggestedTask('tomorrow'));
el('snooze-next-week').addEventListener('click', () => snoozeSuggestedTask('next-week'));
el('complete-next').addEventListener('click', markSuggestedTaskDone);
el('undo-delete-task').addEventListener('click', undoLastAction);
el('clear-completed').addEventListener('click', clearCompletedTasks);
el('queue-search').addEventListener('input', updateQueueControls);
el('queue-filter').addEventListener('change', updateQueueControls);
el('queue-sort').addEventListener('change', updateQueueControls);
el('end-focus').addEventListener('click', () => stopFocus('Focus session ended.'));
el('theme-toggle').addEventListener('click', toggleTheme);

applyTheme();
render();
