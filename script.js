import {
  energyLevels,
  estimateOptions,
  focusDurationOptions,
  maxFirstStepLength,
  maxHandoffLength,
  maxTitleLength,
  maxWaitingOnLength,
  normalizeDueDate,
  normalizePersonalSettings,
  normalizeTask,
  normalizeTimestamp,
  normalizeWhitespace,
  priorityOptions,
  recurrenceOptions,
  subjectOptions,
  maxChecklistItemLength,
  maxChecklistItems,
} from './queueclear-model.mjs';
import { validateBackup } from './queueclear-recovery.mjs';

const storageKey = 'queueclear.tasks.v2';
const legacyStorageKey = 'queueclear.tasks.v1';
const themeKey = 'queueclear.theme.v1';
const currentEnergyKey = 'queueclear.current-energy.v1';
const timeAvailableKey = 'queueclear.time-available.v1';
const settingsKey = 'queueclear.settings.v1';
const todayPlanKey = 'queueclear.today-plan.v1';
const routinesKey = 'queueclear.routines.v1';
const historyKey = 'queueclear.history.v1';
const timeAvailableOptions = [5, 15, 25, 45];
const maxRoutineNameLength = 60;
const maxRoutineStepLength = 140;
const maxTodayTasks = 5;
const maxHistoryItems = 100;
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
  'important',
];
const queueSortOptions = ['suggested', 'newest', 'oldest', 'shortest', 'due-soon'];

let tasks = readTasks();
let currentEnergy = readCurrentEnergy();
let timeAvailable = readTimeAvailable();
let personalSettings = readPersonalSettings();
let todayPlan = readTodayPlan();
let routines = readRoutines();
let historyItems = readHistory();
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

function normalizeTodayPlan(candidate) {
  const taskIds = Array.isArray(candidate?.taskIds)
    ? candidate.taskIds.filter((taskId) => typeof taskId === 'string')
    : [];
  return {
    date: normalizeDueDate(candidate?.date) || getLocalDatePart(),
    taskIds: [...new Set(taskIds)].slice(0, maxTodayTasks),
  };
}

function readTodayPlan() {
  try {
    const plan = normalizeTodayPlan(JSON.parse(localStorage.getItem(todayPlanKey) || '{}'));
    return plan.date === getLocalDatePart() ? plan : { date: getLocalDatePart(), taskIds: [] };
  } catch {
    return { date: getLocalDatePart(), taskIds: [] };
  }
}

function saveTodayPlan() {
  todayPlan.date = getLocalDatePart();
  todayPlan.taskIds = todayPlan.taskIds.filter((taskId) => tasks.some((task) => task.id === taskId && !task.done));
  localStorage.setItem(todayPlanKey, JSON.stringify(todayPlan));
}

function normalizeRoutine(candidate) {
  const name = normalizeWhitespace(candidate?.name).slice(0, maxRoutineNameLength);
  const steps = Array.isArray(candidate?.steps)
    ? candidate.steps
        .map((step) => normalizeWhitespace(step).slice(0, maxRoutineStepLength))
        .filter(Boolean)
        .slice(0, 12)
    : [];
  if (!name || steps.length === 0) {
    return null;
  }
  return {
    id: typeof candidate?.id === 'string' ? candidate.id : crypto.randomUUID(),
    name,
    steps,
    createdAt: normalizeTimestamp(candidate?.createdAt) ?? Date.now(),
  };
}

function readRoutines() {
  try {
    const saved = JSON.parse(localStorage.getItem(routinesKey) || '[]');
    return Array.isArray(saved) ? saved.map(normalizeRoutine).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function saveRoutines() {
  localStorage.setItem(routinesKey, JSON.stringify(routines));
}

function normalizeHistoryItem(candidate) {
  const type = ['completed', 'focus-started', 'focus-finished', 'handoff'].includes(candidate?.type)
    ? candidate.type
    : null;
  const text = normalizeWhitespace(candidate?.text).slice(0, maxFirstStepLength);
  const createdAt = normalizeTimestamp(candidate?.createdAt);
  return type && text && createdAt ? { type, text, createdAt } : null;
}

function readHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(historyKey) || '[]');
    return Array.isArray(saved) ? saved.map(normalizeHistoryItem).filter(Boolean).slice(0, maxHistoryItems) : [];
  } catch {
    return [];
  }
}

function recordHistory(type, text) {
  const item = normalizeHistoryItem({ type, text, createdAt: Date.now() });
  if (!item) {
    return;
  }
  historyItems.unshift(item);
  historyItems = historyItems.slice(0, maxHistoryItems);
  localStorage.setItem(historyKey, JSON.stringify(historyItems));
}

function getDefaultFocusSeconds() {
  return personalSettings.focusMinutes * 60;
}

function createTask({ text, energy, estimatedMinutes, firstStep, dueDate, subject = 'general', priority = 'normal', recurrence = 'none', checklist = [] }) {
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
    subject,
    priority,
    recurrence,
    checklist,
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

function formatSubject(subject) {
  return subject === 'social-science'
    ? 'Social science'
    : subject.charAt(0).toUpperCase() + subject.slice(1);
}

function formatPriority(priority) {
  return priority === 'soon' ? 'Needs attention soon' : priority.charAt(0).toUpperCase() + priority.slice(1);
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
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    tasks,
    theme: getThemePreference(),
    currentEnergy,
    timeAvailable,
    personalSettings,
    todayPlan,
    routines,
    historyItems,
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
    formatRestorePreference('Today plan', backup.todayPlan, 'empty plan'),
    formatRestorePreference('Routines', backup.routines, 'none'),
    formatRestorePreference('History', backup.historyItems, 'none'),
  ].join(' ');
  renderRestoreTaskOptions(backup);
  renderRestorePreferenceOptions(backup);
  el('restore-warning').textContent =
    'Replacing current data removes your current QueueClear tasks and saved settings in this browser. Adding selected items keeps current data and skips active title duplicates.';
  el('restore-preview').hidden = false;
  el('confirm-restore').focus();
}

function getRestoreTaskCheckboxes() {
  return Array.from(document.querySelectorAll('input[name="restore-task"]'));
}

function renderRestoreTaskOptions(backup) {
  const options = el('restore-task-options');
  options.replaceChildren();
  backup.tasks.forEach((task) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    const text = document.createElement('span');
    label.className = 'restore-check';
    input.type = 'checkbox';
    input.name = 'restore-task';
    input.value = task.id;
    input.checked = true;
    text.textContent = task.text;
    label.append(input, text);
    options.append(label);
  });
  el('restore-select-all').checked = backup.tasks.length > 0;
}

function renderRestorePreferenceOptions(backup) {
  const options = el('restore-preference-options');
  options.replaceChildren();
  const preferences = [
    ['theme', 'Theme', backup.theme.included],
    ['currentEnergy', 'Current energy', backup.currentEnergy.included],
    ['timeAvailable', 'Available time', backup.timeAvailable.included],
    ['personalSettings', 'Personal settings', backup.personalSettings.included],
    ['todayPlan', 'Today’s plan', backup.todayPlan.included],
    ['routines', 'Study routines', backup.routines.included],
    ['historyItems', 'Private history', backup.historyItems.included],
  ];
  preferences.forEach(([key, labelText, included]) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    label.className = 'restore-check';
    input.type = 'checkbox';
    input.name = 'restore-preference';
    input.value = key;
    input.checked = included;
    input.disabled = !included;
    label.append(input, document.createTextNode(labelText + (included ? '' : ' (not in this backup)')));
    options.append(label);
  });
}

function getSelectedRestoreTasks() {
  const selectedIds = new Set(
    getRestoreTaskCheckboxes().filter((input) => input.checked).map((input) => input.value),
  );
  return pendingRestore ? pendingRestore.tasks.filter((task) => selectedIds.has(task.id)) : [];
}

function getSelectedRestorePreferences() {
  return new Set(
    Array.from(document.querySelectorAll('input[name="restore-preference"]'))
      .filter((input) => input.checked && !input.disabled)
      .map((input) => input.value),
  );
}

function syncRestoreSelectAll() {
  const checkboxes = getRestoreTaskCheckboxes();
  el('restore-select-all').checked = checkboxes.length > 0 && checkboxes.every((input) => input.checked);
}

function setAllRestoreTasksSelected() {
  getRestoreTaskCheckboxes().forEach((input) => {
    input.checked = el('restore-select-all').checked;
  });
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

    pendingRestore = validateBackup(parsedBackup, {
      timeAvailableOptions,
      fallbackTodayPlan: { date: getLocalDatePart(), taskIds: [] },
      normalizeTodayPlan,
      normalizeRoutine,
      normalizeHistoryItem,
    });
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
  todayPlan = pendingRestore.todayPlan.value;
  routines = pendingRestore.routines.value;
  historyItems = pendingRestore.historyItems.value;
  localStorage.setItem(storageKey, JSON.stringify(tasks));
  localStorage.removeItem(legacyStorageKey);
  localStorage.setItem(themeKey, pendingRestore.theme.value);
  localStorage.setItem(currentEnergyKey, currentEnergy);
  localStorage.setItem(
    timeAvailableKey,
    timeAvailable === null ? '' : String(timeAvailable),
  );
  savePersonalSettings();
  saveTodayPlan();
  saveRoutines();
  localStorage.setItem(historyKey, JSON.stringify(historyItems));

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

function recoverSelectedBackupItems() {
  if (!pendingRestore) {
    showStatus('data-message', 'Choose a valid backup before recovering items.');
    return;
  }

  const selectedTasks = getSelectedRestoreTasks();
  const selectedPreferences = getSelectedRestorePreferences();
  const previousDefaultFocusSeconds = getDefaultFocusSeconds();
  const activeTitles = new Set(getActiveTasks().map((task) => task.text.toLocaleLowerCase()));
  const existingIds = new Set(tasks.map((task) => task.id));
  const recoveredTasks = [];
  let skipped = 0;

  selectedTasks.forEach((task) => {
    if (!task.done && activeTitles.has(task.text.toLocaleLowerCase())) {
      skipped += 1;
      return;
    }
    const recovered = { ...task, id: existingIds.has(task.id) ? crypto.randomUUID() : task.id };
    existingIds.add(recovered.id);
    if (!recovered.done) {
      activeTitles.add(recovered.text.toLocaleLowerCase());
    }
    recoveredTasks.push(recovered);
  });

  tasks.push(...recoveredTasks);
  if (selectedPreferences.has('theme')) localStorage.setItem(themeKey, pendingRestore.theme.value);
  if (selectedPreferences.has('currentEnergy')) currentEnergy = pendingRestore.currentEnergy.value;
  if (selectedPreferences.has('timeAvailable')) timeAvailable = pendingRestore.timeAvailable.value;
  if (selectedPreferences.has('personalSettings')) personalSettings = pendingRestore.personalSettings.value;
  if (selectedPreferences.has('todayPlan')) todayPlan = pendingRestore.todayPlan.value;
  if (selectedPreferences.has('routines')) routines = pendingRestore.routines.value;
  if (selectedPreferences.has('historyItems')) historyItems = pendingRestore.historyItems.value;

  if (focusTimer === null && focusSeconds === previousDefaultFocusSeconds) {
    focusSeconds = getDefaultFocusSeconds();
  }

  saveTasks();
  saveCurrentEnergy();
  saveTimeAvailable();
  savePersonalSettings();
  saveTodayPlan();
  saveRoutines();
  localStorage.setItem(historyKey, JSON.stringify(historyItems));
  clearRestorePreview();
  applyTheme();
  resetSuggestionChoice();
  render();
  const recoveredLabel = recoveredTasks.length + ' task' + (recoveredTasks.length === 1 ? '' : 's');
  const skippedLabel = skipped ? ' ' + skipped + ' active duplicate' + (skipped === 1 ? ' was' : 's were') + ' skipped.' : '';
  showStatus('data-message', 'Recovered ' + recoveredLabel + ' without replacing your current queue.' + skippedLabel);
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
  el('subject-input').value = 'general';
  el('priority-input').value = 'normal';
  el('recurrence-input').value = 'none';
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
    el('add-suggested-to-today').disabled = true;
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
  el('add-suggested-to-today').disabled = todayPlan.taskIds.includes(suggestion.id) || todayPlan.taskIds.length >= maxTodayTasks;
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
  if (queueFilter === 'important') {
    return !task.done && (task.priority === 'important' || task.priority === 'soon');
  }
  return task.energy === queueFilter;
}

function compareByDueDate(first, second) {
  const firstDue = first.dueDate || '9999-12-31';
  const secondDue = second.dueDate || '9999-12-31';
  return firstDue.localeCompare(secondDue) || first.createdAt - second.createdAt;
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
  if (queueSort === 'due-soon') {
    return queueTasks.slice().sort(compareByDueDate);
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

function createSelectInput(id, options, selected, labelForOption) {
  const select = document.createElement('select');
  select.id = id;
  options.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = labelForOption(value);
    option.selected = value === selected;
    select.append(option);
  });
  return select;
}

function toggleChecklistItem(taskId, itemId) {
  const task = tasks.find((candidate) => candidate.id === taskId);
  const item = task?.checklist.find((candidate) => candidate.id === itemId);
  if (!item) return;
  item.done = !item.done;
  saveTasks();
  renderTaskList();
}

function addChecklistItem(event, taskId) {
  event.preventDefault();
  const task = tasks.find((candidate) => candidate.id === taskId);
  const input = el('checklist-input-' + taskId);
  const text = normalizeWhitespace(input?.value).slice(0, maxChecklistItemLength);
  if (!task || !text) {
    showStatus('queue-message', 'Add a short checklist item first.');
    return;
  }
  if (task.checklist.length >= maxChecklistItems) {
    showStatus('queue-message', 'Keep a checklist to ' + maxChecklistItems + ' items so it stays usable.');
    return;
  }
  task.checklist.push({ id: crypto.randomUUID(), text, done: false });
  saveTasks();
  renderTaskList();
}

function createChecklist(task) {
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  const list = document.createElement('ul');
  const form = document.createElement('form');
  const field = document.createElement('div');
  const label = document.createElement('label');
  const input = document.createElement('input');
  const button = document.createElement('button');
  const completeCount = task.checklist.filter((item) => item.done).length;
  details.className = 'task-checklist';
  summary.textContent = task.checklist.length
    ? 'Checklist: ' + completeCount + ' of ' + task.checklist.length
    : 'Add a checklist';
  list.className = 'checklist-items';
  task.checklist.forEach((item) => {
    const listItem = document.createElement('li');
    const check = document.createElement('input');
    const itemLabel = document.createElement('label');
    check.type = 'checkbox';
    check.checked = item.done;
    check.id = 'checklist-' + task.id + '-' + item.id;
    itemLabel.htmlFor = check.id;
    itemLabel.textContent = item.text;
    check.addEventListener('change', () => toggleChecklistItem(task.id, item.id));
    listItem.append(check, itemLabel);
    list.append(listItem);
  });
  form.className = 'checklist-form';
  label.htmlFor = 'checklist-input-' + task.id;
  label.textContent = 'New checklist item';
  input.id = 'checklist-input-' + task.id;
  input.maxLength = maxChecklistItemLength;
  input.placeholder = 'e.g. Find question 1';
  field.className = 'field';
  field.append(label, input);
  button.type = 'submit';
  button.className = 'text-button';
  button.textContent = 'Add item';
  form.append(field, button);
  form.addEventListener('submit', (event) => addChecklistItem(event, task.id));
  details.append(summary, list, form);
  return details;
}

function createTaskEditForm(task) {
  const form = document.createElement('form');
  const titleInput = document.createElement('input');
  const energyInput = document.createElement('select');
  const estimateInput = document.createElement('select');
  const firstStepInput = document.createElement('input');
  const dueDateInput = document.createElement('input');
  const subjectInput = createSelectInput('edit-subject-' + task.id, subjectOptions, task.subject, formatSubject);
  const priorityInput = createSelectInput('edit-priority-' + task.id, priorityOptions, task.priority, formatPriority);
  const recurrenceInput = createSelectInput(
    'edit-recurrence-' + task.id,
    recurrenceOptions,
    task.recurrence,
    (value) => value === 'weekly' ? 'Repeat weekly after completion' : 'Does not repeat',
  );
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
    createEditField('Subject or area', subjectInput),
    createEditField('How soon does it matter?', priorityInput),
    createEditField('Repeat', recurrenceInput),
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
  task.subject = subjectOptions.includes(el('edit-subject-' + taskId).value)
    ? el('edit-subject-' + taskId).value
    : 'general';
  task.priority = priorityOptions.includes(el('edit-priority-' + taskId).value)
    ? el('edit-priority-' + taskId).value
    : 'normal';
  task.recurrence = recurrenceOptions.includes(el('edit-recurrence-' + taskId).value)
    ? el('edit-recurrence-' + taskId).value
    : 'none';
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
    details.unshift(formatSubject(task.subject), formatPriority(task.priority));
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

    if (!task.done) {
      content.append(createChecklist(task));
    }

    if (task.recurrence === 'weekly') {
      const repeatLabel = document.createElement('span');
      repeatLabel.className = 'task-meta';
      repeatLabel.textContent = 'Repeats weekly after completion';
      content.append(repeatLabel);
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
      if (!task.done && !todayPlan.taskIds.includes(task.id)) {
        const todayButton = createTaskButton('Add to today', 'add-to-today', 'Add ' + task.text + ' to today’s plan');
        todayButton.disabled = todayPlan.taskIds.length >= maxTodayTasks;
        todayButton.addEventListener('click', () => addTaskToToday(task.id));
        actions.append(todayButton);
      }
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

function getTodayTasks() {
  return todayPlan.taskIds
    .map((taskId) => tasks.find((task) => task.id === taskId && !task.done))
    .filter(Boolean);
}

function addTaskToToday(taskId) {
  const task = tasks.find((candidate) => candidate.id === taskId && !candidate.done);
  if (!task) {
    return;
  }
  if (todayPlan.taskIds.includes(taskId)) {
    showStatus('queue-message', 'That task is already in today’s plan.');
    return;
  }
  if (todayPlan.taskIds.length >= maxTodayTasks) {
    showStatus('queue-message', 'Keep today to ' + maxTodayTasks + ' tasks. Remove one before adding another.');
    return;
  }
  todayPlan.taskIds.push(taskId);
  saveTodayPlan();
  render();
  showNextStatus('Added to today’s plan. The rest of your queue stays in the background.');
}

function moveTodayTask(taskId, direction) {
  const index = todayPlan.taskIds.indexOf(taskId);
  const nextIndex = index + direction;
  if (index === -1 || nextIndex < 0 || nextIndex >= todayPlan.taskIds.length) {
    return;
  }
  [todayPlan.taskIds[index], todayPlan.taskIds[nextIndex]] = [
    todayPlan.taskIds[nextIndex],
    todayPlan.taskIds[index],
  ];
  saveTodayPlan();
  render();
  showStatus('queue-message', 'Today’s plan reordered.');
}

function removeTodayTask(taskId) {
  todayPlan.taskIds = todayPlan.taskIds.filter((candidateId) => candidateId !== taskId);
  saveTodayPlan();
  render();
  showStatus('queue-message', 'Removed from today’s plan. The task is still safe in your queue.');
}

function renderTodayPlan() {
  saveTodayPlan();
  const plan = getTodayTasks();
  const container = el('today-plan');
  container.replaceChildren();
  const estimatedMinutes = plan.reduce((total, task) => total + (task.estimatedMinutes || 0), 0);
  const unestimated = plan.filter((task) => task.estimatedMinutes === null).length;
  el('today-count').textContent = plan.length + ' of ' + maxTodayTasks + ' chosen · ' + estimatedMinutes + ' min' + (unestimated ? ' + ' + unestimated + ' unestimated' : '');
  el('today-empty').hidden = plan.length > 0;

  plan.forEach((task, index) => {
    const item = document.createElement('div');
    const content = document.createElement('div');
    const title = document.createElement('span');
    const meta = document.createElement('span');
    const actions = document.createElement('div');
    item.className = 'today-item';
    title.className = 'today-task-title';
    title.textContent = (index + 1) + '. ' + task.text;
    meta.className = 'today-task-meta';
    meta.textContent = [formatSubject(task.subject), formatPriority(task.priority), formatEnergy(task.energy), formatEstimate(task.estimatedMinutes)].filter(Boolean).join(' · ');
    content.append(title, meta);
    actions.className = 'today-actions';
    const up = createTaskButton('Move up', 'move-today-up', 'Move ' + task.text + ' earlier in today’s plan');
    up.disabled = index === 0;
    up.addEventListener('click', () => moveTodayTask(task.id, -1));
    const down = createTaskButton('Move down', 'move-today-down', 'Move ' + task.text + ' later in today’s plan');
    down.disabled = index === plan.length - 1;
    down.addEventListener('click', () => moveTodayTask(task.id, 1));
    const remove = createTaskButton('Remove', 'remove-today', 'Remove ' + task.text + ' from today’s plan');
    remove.addEventListener('click', () => removeTodayTask(task.id));
    actions.append(up, down, remove);
    item.append(content, actions);
    container.append(item);
  });
}

function renderRoutines() {
  const container = el('routine-list');
  container.replaceChildren();
  el('routine-empty').hidden = routines.length > 0;
  routines.forEach((routine) => {
    const item = document.createElement('article');
    const name = document.createElement('span');
    const steps = document.createElement('ol');
    const actions = document.createElement('div');
    const stepForm = document.createElement('form');
    const stepField = document.createElement('div');
    const stepLabel = document.createElement('label');
    const stepInput = document.createElement('input');
    const stepButton = document.createElement('button');
    item.className = 'routine-item';
    name.className = 'routine-name';
    name.textContent = routine.name;
    steps.className = 'routine-step-list';
    routine.steps.forEach((step) => {
      const stepItem = document.createElement('li');
      stepItem.textContent = step;
      steps.append(stepItem);
    });
    actions.className = 'routine-actions';
    const start = createTaskButton('Add steps to queue', 'start-routine', 'Add ' + routine.name + ' steps to the queue');
    start.addEventListener('click', () => startRoutine(routine.id));
    const remove = createTaskButton('Delete routine', 'delete-routine', 'Delete ' + routine.name + ' routine');
    remove.addEventListener('click', () => deleteRoutine(routine.id));
    actions.append(start, remove);
    stepForm.className = 'routine-step-form';
    stepLabel.htmlFor = 'routine-step-' + routine.id;
    stepLabel.textContent = 'Add another step';
    stepInput.id = 'routine-step-' + routine.id;
    stepInput.maxLength = maxRoutineStepLength;
    stepInput.placeholder = 'Keep the next step short';
    stepField.className = 'field';
    stepField.append(stepLabel, stepInput);
    stepButton.className = 'text-button';
    stepButton.type = 'submit';
    stepButton.textContent = 'Add step';
    stepForm.append(stepField, stepButton);
    stepForm.addEventListener('submit', (event) => addRoutineStep(event, routine.id));
    item.append(name, steps, actions, stepForm);
    container.append(item);
  });
}

function renderHistory() {
  const list = el('history-list');
  list.replaceChildren();
  el('history-empty').hidden = historyItems.length > 0;
  historyItems.forEach((entry) => {
    const item = document.createElement('li');
    const label = document.createElement('span');
    const meta = document.createElement('span');
    item.className = 'history-item';
    const prefix = entry.type === 'completed'
      ? 'Completed: '
      : entry.type === 'focus-started'
        ? 'Focus started: '
        : entry.type === 'focus-finished'
          ? 'Focus finished: '
          : 'Handoff saved: ';
    label.textContent = prefix + entry.text;
    meta.className = 'history-meta';
    meta.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.createdAt));
    item.append(label, meta);
    list.append(item);
  });
}

function handleRoutineSubmit(event) {
  event.preventDefault();
  const name = normalizeWhitespace(el('routine-name-input').value).slice(0, maxRoutineNameLength);
  const firstStep = normalizeWhitespace(el('routine-step-input').value).slice(0, maxRoutineStepLength);
  if (!name || !firstStep) {
    showStatus('routine-message', 'Give the routine a name and one small first step.');
    return;
  }
  routines.push({ id: crypto.randomUUID(), name, steps: [firstStep], createdAt: Date.now() });
  saveRoutines();
  el('routine-name-input').value = '';
  el('routine-step-input').value = '';
  renderRoutines();
  showStatus('routine-message', 'Routine saved in this browser. Add steps whenever you need to.');
}

function addRoutineStep(event, routineId) {
  event.preventDefault();
  const routine = routines.find((candidate) => candidate.id === routineId);
  const input = el('routine-step-' + routineId);
  const step = normalizeWhitespace(input?.value).slice(0, maxRoutineStepLength);
  if (!routine || !step) {
    showStatus('routine-message', 'Add a short step first.');
    return;
  }
  if (routine.steps.length >= 12) {
    showStatus('routine-message', 'Keep a routine to 12 steps so it stays usable.');
    return;
  }
  routine.steps.push(step);
  saveRoutines();
  renderRoutines();
  showStatus('routine-message', 'Step added to ' + routine.name + '.');
}

function startRoutine(routineId) {
  const routine = routines.find((candidate) => candidate.id === routineId);
  if (!routine) {
    return;
  }
  const created = routine.steps
    .map((step) => createTask({ text: routine.name + ' — ' + step, energy: 'medium', estimatedMinutes: null, firstStep: step, dueDate: null }))
    .filter((task) => !hasDuplicateActiveTitle(task.text));
  if (created.length === 0) {
    showStatus('routine-message', 'Those routine steps are already active in your queue.');
    return;
  }
  tasks.push(...created);
  saveTasks();
  resetSuggestionChoice();
  render();
  showStatus('routine-message', created.length + ' routine step' + (created.length === 1 ? '' : 's') + ' added to your queue.');
}

function deleteRoutine(routineId) {
  const routine = routines.find((candidate) => candidate.id === routineId);
  routines = routines.filter((candidate) => candidate.id !== routineId);
  saveRoutines();
  renderRoutines();
  showStatus('routine-message', routine ? 'Deleted ' + routine.name + '. It did not change your tasks.' : 'Routine deleted.');
}

function render() {
  renderPersonalSettings();
  renderSuggestion();
  renderTodayPlan();
  renderWaitingRoom();
  renderTaskList();
  renderTimer();
  renderUndoDelete();
  renderSessionHandoff();
  renderRoutines();
  renderHistory();
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
  recordHistory('handoff', task.text + ' — ' + handoff);
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
    subject: el('subject-input').value,
    priority: el('priority-input').value,
    recurrence: el('recurrence-input').value,
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
    recordHistory('completed', task.text);
    let recurrenceTaskId = null;
    lastUndo = {
      type: 'complete',
      taskId: task.id,
      text: task.text,
      previousDone,
      previousCompletedAt,
      recurrenceTaskId,
      todayPlanIndex: todayPlan.taskIds.indexOf(task.id),
    };
    if (task.recurrence === 'weekly') {
      const nextDate = task.dueDate ? new Date(task.dueDate + 'T12:00:00') : new Date();
      nextDate.setDate(nextDate.getDate() + 7);
      const nextTask = createTask({
        text: task.text,
        energy: task.energy,
        estimatedMinutes: task.estimatedMinutes,
        firstStep: task.firstStep,
        dueDate: getLocalDatePart(nextDate),
        subject: task.subject,
        priority: task.priority,
        recurrence: task.recurrence,
        checklist: task.checklist.map((item) => ({ id: crypto.randomUUID(), text: item.text, done: false })),
      });
      if (!hasDuplicateActiveTitle(nextTask.text)) {
        tasks.push(nextTask);
        recurrenceTaskId = nextTask.id;
        lastUndo.recurrenceTaskId = recurrenceTaskId;
      }
    }
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
  const todayPlanIndex = todayPlan.taskIds.indexOf(taskId);

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
  todayPlan.taskIds = todayPlan.taskIds.filter((candidateId) => candidateId !== taskId);
  lastUndo = {
    type: 'delete',
    index: deletedIndex,
    task: deletedTask,
    todayPlanIndex,
  };
  saveTasks();
  saveTodayPlan();
  resetSuggestionChoice();
  render();
  showNextStatus('Task deleted. Undo stays available until you refresh or delete another task.');
  el('undo-delete-task').focus();
}

function restoreTaskToTodayPlan(taskId, todayPlanIndex) {
  if (todayPlanIndex < 0 || todayPlan.taskIds.includes(taskId) || todayPlan.taskIds.length >= maxTodayTasks) {
    return false;
  }

  todayPlan.taskIds.splice(Math.min(todayPlanIndex, todayPlan.taskIds.length), 0, taskId);
  return true;
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
    const restoredToToday = restoreTaskToTodayPlan(restoredTask.id, lastUndo.todayPlanIndex);
    lastUndo = null;
    saveTasks();
    render();
    showNextStatus(
      restoredToToday
        ? 'Restored “' + restoredTask.text + '” to your queue and today’s plan.'
        : 'Restored “' + restoredTask.text + '”.',
    );
    return;
  }

  if (lastUndo.type === 'complete') {
    const task = tasks.find((candidate) => candidate.id === lastUndo.taskId);
    if (task) {
      task.done = lastUndo.previousDone;
      task.completedAt = lastUndo.previousCompletedAt;
    }
    if (lastUndo.recurrenceTaskId) {
      tasks = tasks.filter((candidate) => candidate.id !== lastUndo.recurrenceTaskId);
    }
    const restoredToToday = task
      ? restoreTaskToTodayPlan(task.id, lastUndo.todayPlanIndex)
      : false;
    lastUndo = null;
    saveTasks();
    resetSuggestionChoice();
    render();
    showNextStatus(
      restoredToToday
        ? 'Task returned to your active queue and today’s plan.'
        : 'Task returned to your active queue.',
    );
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
  todayPlan.taskIds = todayPlan.taskIds.filter((taskId) => tasks.some((task) => task.id === taskId));
  lastUndo = { type: 'clear-completed', items };
  editingTaskId = null;
  saveTasks();
  saveTodayPlan();
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
    if (completedTask) {
      recordHistory('focus-finished', completedTask.text);
    }
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
  recordHistory('focus-started', task.text);
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
el('routine-form').addEventListener('submit', handleRoutineSubmit);
el('current-energy-input').addEventListener('change', setCurrentEnergy);
el('time-available-input').addEventListener('change', setTimeAvailable);
el('save-personal-settings').addEventListener('click', saveSettingsFromForm);
el('park-waiting').addEventListener('click', parkSuggestedTask);
el('download-backup').addEventListener('click', downloadBackup);
el('restore-backup').addEventListener('click', openRestorePicker);
el('restore-backup-input').addEventListener('change', previewRestoreBackup);
el('confirm-restore').addEventListener('click', restoreBackup);
el('recover-selected').addEventListener('click', recoverSelectedBackupItems);
el('cancel-restore').addEventListener('click', () => clearRestorePreview({ returnFocus: true }));
el('restore-select-all').addEventListener('change', setAllRestoreTasksSelected);
el('restore-task-options').addEventListener('change', syncRestoreSelectAll);
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
el('add-suggested-to-today').addEventListener('click', () => {
  const task = getSuggestedTask();
  if (task) {
    addTaskToToday(task.id);
  }
});
el('undo-delete-task').addEventListener('click', undoLastAction);
el('clear-completed').addEventListener('click', clearCompletedTasks);
el('queue-search').addEventListener('input', updateQueueControls);
el('queue-filter').addEventListener('change', updateQueueControls);
el('queue-sort').addEventListener('change', updateQueueControls);
el('end-focus').addEventListener('click', () => stopFocus('Focus session ended.'));
el('theme-toggle').addEventListener('click', toggleTheme);

applyTheme();
render();
