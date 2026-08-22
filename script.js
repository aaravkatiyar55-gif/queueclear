import {
  energyLevels,
  estimateOptions,
  focusDurationOptions,
  maxChecklistItemLength,
  maxChecklistItems,
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
} from './queueclear-model.mjs';
import {
  appendHistory,
  getLocalDatePart,
  getThemePreference,
  legacyStorageKey,
  loadCurrentEnergy,
  loadHistory,
  loadPersonalSettings,
  loadRoutines,
  loadTasks,
  loadTimeAvailable,
  loadTodayPlan,
  maxHistoryItems,
  maxRoutineNameLength,
  maxRoutineStepLength,
  maxTodayTasks,
  normalizeHistoryItem,
  normalizeRoutine,
  normalizeTodayPlan,
  saveCurrentEnergy,
  saveHistory,
  savePersonalSettings,
  saveRoutines,
  saveTasks,
  saveThemePreference,
  saveTimeAvailable,
  saveTodayPlan,
  storageKey,
  themeKey,
  timeAvailableKey,
  timeAvailableOptions,
} from './queueclear-storage.mjs';
import { validateBackup } from './queueclear-recovery.mjs';
import { restoreTaskIdToTodayPlan } from './queueclear-today-plan.mjs';
import {
  buildDailyPlan,
  compareByEstimateThenQueueOrder,
  formatAvailableTime,
  formatEnergy,
  formatEstimate,
  formatPriority,
  formatSubject,
  getPlanRealityCheck,
  getResumableTasks,
  getSuggestion,
  getSuggestionReason,
  getWaitingFollowUps,
  isReadyTask,
} from './queueclear-major-workflows.mjs';
import {
  formatDueDate,
  formatFocusTime,
  formatSnoozeTime,
  getSnoozeTime,
  getWaitingReviewDate,
  isDueToday,
} from './queueclear-timer-history.mjs';

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

let tasks = loadTasks();
let currentEnergy = loadCurrentEnergy();
let timeAvailable = loadTimeAvailable();
let personalSettings = loadPersonalSettings();
let todayPlan = loadTodayPlan();
let routines = loadRoutines();
let historyItems = loadHistory();
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

function getDefaultFocusSeconds() {
  return personalSettings.focusMinutes * 60;
}

function createTask({
  text,
  energy,
  estimatedMinutes,
  firstStep,
  dueDate,
  subject = 'general',
  priority = 'normal',
  recurrence = 'none',
  checklist = [],
}) {
  return normalizeTask({
    id: crypto.randomUUID(),
    text,
    energy,
    done: false,
    createdAt: Date.now(),
    estimatedMinutes,
    firstStep,
    waitingOn: null,
    waitingUntil: null,
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

function isWaiting(task) {
  return Boolean(task.waitingOn);
}

function getAvailableTasks() {
  return getActiveTasks().filter((task) => !isSnoozed(task) && !isWaiting(task));
}

function getWaitingTasks() {
  return getActiveTasks().filter(isWaiting);
}

function getRecommendation() {
  return getSuggestion(tasks, {
    currentEnergy,
    timeAvailable,
    suggestionOffset,
  });
}

function getSuggestedTask() {
  return getRecommendation().task;
}

function resetSuggestionChoice() {
  suggestionOffset = 0;
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

  saveTasks(tasks);
  saveThemePreference(pendingRestore.theme.value);
  saveCurrentEnergy(currentEnergy);
  saveTimeAvailable(timeAvailable);
  savePersonalSettings(personalSettings);
  saveTodayPlan(todayPlan, tasks);
  saveRoutines(routines);
  saveHistory(historyItems);

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
  if (selectedPreferences.has('theme')) saveThemePreference(pendingRestore.theme.value);
  if (selectedPreferences.has('currentEnergy')) currentEnergy = pendingRestore.currentEnergy.value;
  if (selectedPreferences.has('timeAvailable')) timeAvailable = pendingRestore.timeAvailable.value;
  if (selectedPreferences.has('personalSettings')) personalSettings = pendingRestore.personalSettings.value;
  if (selectedPreferences.has('todayPlan')) todayPlan = pendingRestore.todayPlan.value;
  if (selectedPreferences.has('routines')) routines = pendingRestore.routines.value;
  if (selectedPreferences.has('historyItems')) historyItems = pendingRestore.historyItems.value;

  if (focusTimer === null && focusSeconds === previousDefaultFocusSeconds) {
    focusSeconds = getDefaultFocusSeconds();
  }

  saveTasks(tasks);
  saveCurrentEnergy(currentEnergy);
  saveTimeAvailable(timeAvailable);
  savePersonalSettings(personalSettings);
  saveTodayPlan(todayPlan, tasks);
  saveRoutines(routines);
  saveHistory(historyItems);
  clearRestorePreview();
  applyTheme();
  resetSuggestionChoice();
  render();
  const recoveredLabel = recoveredTasks.length + ' task' + (recoveredTasks.length === 1 ? '' : 's');
  const skippedLabel = skipped
    ? ' ' + skipped + ' active duplicate' + (skipped === 1 ? ' was' : 's were') + ' skipped.'
    : '';
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
  const recommendation = getRecommendation();
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
  el('why-task').textContent = getSuggestionReason(recommendation, {
    currentEnergy,
    timeAvailable,
    suggestionOffset,
  });
  el('next-details').hidden = false;
  el('pick-another').disabled = recommendation.candidates.length < 2;
  el('snooze-options').hidden = false;
  el('complete-next').disabled = false;
  el('add-suggested-to-today').disabled =
    todayPlan.taskIds.includes(suggestion.id) || todayPlan.taskIds.length >= maxTodayTasks;
}

function createTaskButton(label, className, ariaLabel) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'text-button ' + className;
  button.textContent = label;
  button.setAttribute('aria-label', ariaLabel);
  return button;
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
  const suggested = getRecommendation().candidates;
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
  saveTasks(tasks);
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
  saveTasks(tasks);
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
    (value) => (value === 'weekly' ? 'Repeat weekly after completion' : 'Does not repeat'),
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
  cancelButton.addEventListener('click', () => cancelTaskEdit(task.id));

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

function cancelTaskEdit(taskId) {
  editingTaskId = null;
  renderTaskList();
  showStatus('queue-message', 'Edit cancelled. The task was not changed.');
  focusTaskCheckboxOrQueue(taskId);
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
  if (
    getActiveTasks().some(
      (candidate) =>
        candidate.id !== taskId &&
        candidate.text.toLocaleLowerCase() === text.toLocaleLowerCase(),
    )
  ) {
    showStatus('queue-message', 'That task is already in your active queue.');
    titleInput.focus();
    return;
  }

  task.text = text;
  task.energy = el('edit-energy-' + taskId).value;
  task.estimatedMinutes = estimateOptions.includes(Number(el('edit-estimate-' + taskId).value))
    ? Number(el('edit-estimate-' + taskId).value)
    : null;
  task.firstStep =
    normalizeWhitespace(el('edit-first-step-' + taskId).value).slice(0, maxFirstStepLength) ||
    null;
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
  saveTasks(tasks);
  render();
  showStatus('queue-message', 'Task updated.');
  focusTaskCheckboxOrQueue(task.id);
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
    checkbox.id = 'task-complete-' + task.id;
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
      if (task.waitingUntil) {
        const revisitLabel = document.createElement('span');
        revisitLabel.className = 'waiting-label';
        revisitLabel.textContent = 'Revisit: ' + formatDueDate(task.waitingUntil).replace(/^Due /, '');
        content.append(revisitLabel);
      }
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
  el('empty-state').textContent =
    tasks.length === 0
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
  saveTodayPlan(todayPlan, tasks);
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
  saveTodayPlan(todayPlan, tasks);
  render();
  showStatus('queue-message', 'Today’s plan reordered.');
}

function removeTodayTask(taskId) {
  todayPlan.taskIds = todayPlan.taskIds.filter((candidateId) => candidateId !== taskId);
  saveTodayPlan(todayPlan, tasks);
  render();
  showStatus('queue-message', 'Removed from today’s plan. The task is still safe in your queue.');
}

function renderTodayPlan() {
  saveTodayPlan(todayPlan, tasks);
  const plan = getTodayTasks();
  const container = el('today-plan');
  container.replaceChildren();
  const estimatedMinutes = plan.reduce((total, task) => total + (task.estimatedMinutes || 0), 0);
  const unestimated = plan.filter((task) => task.estimatedMinutes === null).length;
  el('today-count').textContent =
    plan.length +
    ' of ' +
    maxTodayTasks +
    ' chosen · ' +
    estimatedMinutes +
    ' min' +
    (unestimated ? ' + ' + unestimated + ' unestimated' : '');
  el('today-empty').hidden = plan.length > 0;
  renderPlanRealityCheck();

  plan.forEach((task, index) => {
    const item = document.createElement('div');
    const content = document.createElement('div');
    const title = document.createElement('span');
    const meta = document.createElement('span');
    const actions = document.createElement('div');
    item.className = 'today-item';
    title.className = 'today-task-title';
    title.textContent = index + 1 + '. ' + task.text;
    meta.className = 'today-task-meta';
    meta.textContent = [
      formatSubject(task.subject),
      formatPriority(task.priority),
      formatEnergy(task.energy),
      formatEstimate(task.estimatedMinutes),
    ]
      .filter(Boolean)
      .join(' · ');
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

  const readyCount = getAvailableTasks().filter((task) => !todayPlan.taskIds.includes(task.id)).length;
  const planButton = el('build-today-plan');
  planButton.disabled = readyCount === 0 || todayPlan.taskIds.length >= maxTodayTasks;
  planButton.textContent =
    todayPlan.taskIds.length >= maxTodayTasks
      ? 'Today’s plan is full'
      : 'Build a plan from my ready tasks';
  el('plan-builder-help').textContent =
    timeAvailable === null
      ? 'Choose a time above first. QueueClear will only add ready tasks and will not replace your existing choices.'
      : 'Using your ' +
        currentEnergy +
        '-energy setting and ' +
        formatAvailableTime(timeAvailable) +
        '. Existing plan items stay exactly where they are.';
}

function renderPlanRealityCheck() {
  const reality = getPlanRealityCheck(tasks, todayPlan.taskIds, timeAvailable);
  const panel = el('plan-reality');
  const message = el('plan-reality-message');

  panel.hidden = reality.state === 'empty';
  panel.dataset.state = reality.state;

  if (reality.state === 'set-time') {
    message.textContent = 'Pick how much time you have above to check whether this plan is realistic.';
    return;
  }

  if (reality.state === 'unknown') {
    message.textContent = reality.knownMinutes + ' estimated minutes so far, but ' + reality.unknownEstimateCount + ' task' + (reality.unknownEstimateCount === 1 ? ' has' : 's have') + ' no estimate. The total is still uncertain.';
    return;
  }

  if (reality.state === 'over-budget') {
    message.textContent = 'This plan has ' + reality.knownMinutes + ' estimated minutes, which is ' + (reality.knownMinutes - reality.timeAvailable) + ' minutes more than the time you chose. Remove or move something when you are ready.';
    return;
  }

  message.textContent = 'This plan has ' + reality.knownMinutes + ' estimated minutes and fits within your ' + reality.timeAvailable + '-minute time choice.';
}

function buildTodayPlanFromReadyTasks() {
  if (timeAvailable === null) {
    showStatus('plan-builder-message', 'Choose how much time you have above before building a realistic plan.');
    el('time-available-input').focus();
    return;
  }

  const result = buildDailyPlan(tasks, {
    selectedTaskIds: todayPlan.taskIds,
    energy: currentEnergy,
    timeAvailable,
    maxTasks: maxTodayTasks,
  });

  if (result.taskIds.length === 0) {
    showStatus(
      'plan-builder-message',
      result.existingPlanUsesRemainingTime
        ? 'The tasks already planned use the available time, or the remaining ready tasks do not fit. Your current plan was left unchanged.'
        : 'No ready tasks are left to add. Wake or make a task ready when your plans change.',
    );
    return;
  }

  todayPlan.taskIds.push(...result.taskIds);
  saveTodayPlan(todayPlan, tasks);
  render();

  const fallback = result.usedTimeFallback
    ? ' No estimate fit that time, so it added one shortest ready option instead.'
    : '';
  const energyFallback = result.usedEnergyFallback
    ? ' No task matched your energy, so it used ready tasks from the rest of the queue.'
    : '';
  showStatus(
    'plan-builder-message',
    result.taskIds.length +
      ' task' +
      (result.taskIds.length === 1 ? '' : 's') +
      ' added to today’s plan (' +
      result.totalEstimatedMinutes +
      ' estimated minutes).' +
      fallback +
      energyFallback,
  );
}

function resumeSavedHandoff(taskId) {
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task || !getResumableTasks(tasks).some((candidate) => candidate.id === taskId)) {
    return;
  }

  if (focusTimer !== null) {
    showNextStatus('Pause or end the current focus session before switching tasks.');
    return;
  }

  focusTaskId = task.id;
  focusSeconds = getDefaultFocusSeconds();
  renderTimer();
  setFocusStatus('Focus is ready for ' + task.text + '. Your saved next step is still visible below.');
  el('start-focus').focus();
}

function renderResumePanel() {
  const resumeTasks = getResumableTasks(tasks);
  const container = el('resume-list');
  container.replaceChildren();
  el('resume-count').textContent = resumeTasks.length
    ? resumeTasks.length + ' saved handoff' + (resumeTasks.length === 1 ? '' : 's')
    : '';
  el('resume-empty').hidden = resumeTasks.length > 0;

  resumeTasks.forEach((task) => {
    const item = document.createElement('article');
    const title = document.createElement('h3');
    const handoff = document.createElement('p');
    const action = createTaskButton('Set up focus', 'resume-task', 'Set up a focus session for ' + task.text);

    item.className = 'resume-item';
    title.textContent = task.text;
    handoff.textContent = 'Next tiny step: ' + task.handoff;
    action.addEventListener('click', () => resumeSavedHandoff(task.id));
    item.append(title, handoff, action);
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
    const prefix =
      entry.type === 'completed'
        ? 'Completed: '
        : entry.type === 'focus-started'
          ? 'Focus started: '
          : entry.type === 'focus-finished'
            ? 'Focus finished: '
            : 'Handoff saved: ';
    label.textContent = prefix + entry.text;
    meta.className = 'history-meta';
    meta.textContent = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(entry.createdAt));
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
  saveRoutines(routines);
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
  saveRoutines(routines);
  renderRoutines();
  showStatus('routine-message', 'Step added to ' + routine.name + '.');
}

function startRoutine(routineId) {
  const routine = routines.find((candidate) => candidate.id === routineId);
  if (!routine) {
    return;
  }
  const created = routine.steps
    .map((step) =>
      createTask({
        text: routine.name + ' — ' + step,
        energy: 'medium',
        estimatedMinutes: null,
        firstStep: step,
        dueDate: null,
      }),
    )
    .filter((task) => !hasDuplicateActiveTitle(task.text));
  if (created.length === 0) {
    showStatus('routine-message', 'Those routine steps are already active in your queue.');
    return;
  }
  tasks.push(...created);
  saveTasks(tasks);
  resetSuggestionChoice();
  render();
  showStatus(
    'routine-message',
    created.length + ' routine step' + (created.length === 1 ? '' : 's') + ' added to your queue.',
  );
}

function deleteRoutine(routineId) {
  const routine = routines.find((candidate) => candidate.id === routineId);
  routines = routines.filter((candidate) => candidate.id !== routineId);
  saveRoutines(routines);
  renderRoutines();
  showStatus(
    'routine-message',
    routine ? 'Deleted ' + routine.name + '. It did not change your tasks.' : 'Routine deleted.',
  );
}

function render() {
  renderPersonalSettings();
  renderSuggestion();
  renderTodayPlan();
  renderResumePanel();
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
  savePersonalSettings(personalSettings);

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
  el('waiting-review-input').disabled = !suggestion;

  if (!suggestion) {
    el('waiting-on-input').value = '';
    el('waiting-review-input').value = '';
    el('waiting-on-input').placeholder = 'Choose a ready task before moving one to waiting';
  } else {
    el('waiting-on-input').placeholder = "e.g. Teacher's notes before I can revise";
  }

  const followUps = getWaitingFollowUps(tasks, { today: getLocalDatePart() });
  const followUpPanel = el('waiting-follow-ups');
  const followUpActions = el('waiting-follow-up-actions');
  followUpActions.replaceChildren();
  followUpPanel.hidden = followUps.length === 0;

  if (followUps.length > 0) {
    el('waiting-follow-up-label').textContent =
      followUps.length === 1
        ? 'One blocked task is ready to revisit. It stays Waiting until you choose Make ready.'
        : followUps.length +
          ' blocked tasks are ready to revisit. They stay Waiting until you choose Make ready.';
    followUps.forEach((task) => {
      const button = createTaskButton(
        'Make “' + task.text + '” ready',
        'waiting-follow-up-button',
        'Make ' + task.text + ' ready',
      );
      button.addEventListener('click', () => makeTaskReady(task.id));
      followUpActions.append(button);
    });
  }
}

function parkSuggestedTask() {
  const task = getSuggestedTask();
  const waitingOn = normalizeWhitespace(el('waiting-on-input').value).slice(0, maxWaitingOnLength);
  const waitingUntil = getWaitingReviewDate(el('waiting-review-input').value);

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
  task.waitingUntil = waitingUntil;
  resetSuggestionChoice();
  if (task.id === sessionReviewTaskId) {
    sessionReviewTaskId = null;
  }
  saveTasks(tasks);
  el('waiting-on-input').value = '';
  el('waiting-review-input').value = '';
  render();
  showNextStatus(
    waitingUntil
      ? 'Moved to waiting. It will stay out of your decision queue and show a local follow-up when its revisit date arrives.'
      : 'Moved to waiting so it will not compete for your attention right now.',
  );
}

function makeTaskReady(taskId) {
  const task = tasks.find((savedTask) => savedTask.id === taskId);
  if (!task) {
    return;
  }

  task.waitingOn = null;
  task.waitingUntil = null;
  saveTasks(tasks);
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
  historyItems = appendHistory(historyItems, 'handoff', task.text + ' — ' + handoff);
  sessionReviewTaskId = null;
  saveTasks(tasks);
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
  saveTasks(tasks);
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

  saveTasks(tasks);
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
    historyItems = appendHistory(historyItems, 'completed', task.text);
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

  saveTasks(tasks);
  resetSuggestionChoice();
  render();
  showNextStatus('Marked done. It moved out of your active queue.');
}

function pickAnotherTask() {
  const suggestion = getRecommendation();
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
  saveTasks(tasks);
  saveTodayPlan(todayPlan, tasks);
  resetSuggestionChoice();
  render();
  showNextStatus('Task deleted. Undo stays available until you refresh or delete another task.');
  el('undo-delete-task').focus();
}

function restoreTaskToTodayPlan(taskId, todayPlanIndex) {
  const result = restoreTaskIdToTodayPlan(
    todayPlan.taskIds,
    taskId,
    todayPlanIndex,
    maxTodayTasks,
  );
  todayPlan.taskIds = result.taskIds;
  return result.restored;
}

function focusTaskCheckboxOrQueue(taskId) {
  const taskCheckbox = el('task-complete-' + taskId);
  if (taskCheckbox) {
    taskCheckbox.focus();
    return;
  }

  el('queue-search').focus();
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
    saveTasks(tasks);
    render();
    focusTaskCheckboxOrQueue(restoredTask.id);
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
    saveTasks(tasks);
    resetSuggestionChoice();
    render();
    if (task) {
      focusTaskCheckboxOrQueue(task.id);
    }
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
  saveTasks(tasks);
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
  saveTasks(tasks);
  saveTodayPlan(todayPlan, tasks);
  resetSuggestionChoice();
  render();
  showStatus('queue-message', 'Completed tasks cleared. Undo is available until another change or refresh.');
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

  saveTasks(tasks);
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
  saveTasks(tasks);
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
  document.title =
    focusTimer === null
      ? defaultDocumentTitle
      : formatFocusTime(focusSeconds) + ' — QueueClear';
}

function tickFocus() {
  focusSeconds -= 1;

  if (focusSeconds <= 0) {
    const completedTask = getFocusTask();
    if (completedTask) {
      historyItems = appendHistory(historyItems, 'focus-finished', completedTask.text);
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
  historyItems = appendHistory(historyItems, 'focus-started', task.text);
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
  saveCurrentEnergy(currentEnergy);
  resetSuggestionChoice();
  render();
  showNextStatus('Start here now matches your ' + currentEnergy + '-energy setting.');
}

function setTimeAvailable() {
  const selectedMinutes = Number(el('time-available-input').value);
  timeAvailable = timeAvailableOptions.includes(selectedMinutes) ? selectedMinutes : null;
  saveTimeAvailable(timeAvailable);
  resetSuggestionChoice();
  render();
  showNextStatus(
    timeAvailable === null
      ? 'Start here can use tasks of any estimate.'
      : 'Start here will first look for tasks that fit ' + formatAvailableTime(timeAvailable) + '.',
  );
}

function updateQueueControls() {
  const activeControl = document.activeElement;
  const focusedControlId = ['queue-search', 'queue-filter', 'queue-sort'].includes(activeControl?.id)
    ? activeControl.id
    : null;
  const selectionStart = focusedControlId === 'queue-search' ? activeControl.selectionStart : null;
  const selectionEnd = focusedControlId === 'queue-search' ? activeControl.selectionEnd : null;
  const selectedFilter = el('queue-filter').value;
  const selectedSort = el('queue-sort').value;
  queueFilter = queueFilterOptions.includes(selectedFilter) ? selectedFilter : 'all';
  queueSort = queueSortOptions.includes(selectedSort) ? selectedSort : 'suggested';
  queueSearch = el('queue-search').value;
  editingTaskId = null;
  renderTaskList();
  if (focusedControlId) {
    const restoredControl = el(focusedControlId);
    restoredControl.focus();
    if (focusedControlId === 'queue-search' && selectionStart !== null && selectionEnd !== null) {
      restoredControl.setSelectionRange(selectionStart, selectionEnd);
    }
  }
}

function applyTheme() {
  const isCalm = getThemePreference() === 'calm';
  document.body.classList.toggle('calm', isCalm);
  el('theme-toggle').setAttribute('aria-pressed', String(isCalm));
  el('theme-toggle').textContent = isCalm ? 'Use paper theme' : 'Use calm theme';
}

function toggleTheme() {
  const nextTheme = document.body.classList.contains('calm') ? 'paper' : 'calm';
  saveThemePreference(nextTheme);
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
el('build-today-plan').addEventListener('click', buildTodayPlanFromReadyTasks);
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
