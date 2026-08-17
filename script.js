const storageKey = 'queueclear.tasks.v2';
const legacyStorageKey = 'queueclear.tasks.v1';
const themeKey = 'queueclear.theme.v1';
const currentEnergyKey = 'queueclear.current-energy.v1';
const focusSessionKey = 'queueclear.focus-session.v1';
const energyLevels = ['low', 'medium', 'high'];
const estimateOptions = [5, 10, 15, 25, 45, 60];
const focusDurationOptions = [5, 10, 15, 25];
const maxTitleLength = 110;
const maxFirstStepLength = 180;

let tasks = readTasks();
let filter = 'all';
let sortOption = 'suggested';
let focusTimer = null;
let currentEnergy = readCurrentEnergy();
let selectedTaskId = null;
let focusSession = readFocusSession();
let focusFinishedTaskId = null;
let lastSuggestedFocusTaskId = null;
let editingTaskId = null;
let undoAction = null;
const defaultDocumentTitle = document.title;

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

function normalizeFocusSession(candidate) {
  const taskId = typeof candidate?.taskId === 'string' ? candidate.taskId : null;
  const durationMinutes = Number(candidate?.durationMinutes);
  const status = candidate?.status;

  if (!taskId || !focusDurationOptions.includes(durationMinutes)) {
    return null;
  }

  if (status === 'running' && normalizeTimestamp(candidate.endsAt) !== null) {
    return { taskId, durationMinutes, status, endsAt: candidate.endsAt };
  }

  if (status === 'paused' && Number.isInteger(candidate.remainingSeconds) && candidate.remainingSeconds > 0) {
    return { taskId, durationMinutes, status, remainingSeconds: candidate.remainingSeconds };
  }

  return null;
}

function readFocusSession() {
  try {
    return normalizeFocusSession(JSON.parse(localStorage.getItem(focusSessionKey) || 'null'));
  } catch {
    return null;
  }
}

function saveFocusSession() {
  if (focusSession) {
    localStorage.setItem(focusSessionKey, JSON.stringify(focusSession));
  } else {
    localStorage.removeItem(focusSessionKey);
  }
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

function formatFocusTime(totalSeconds) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = String(safeSeconds % 60).padStart(2, '0');
  return minutes + ':' + seconds;
}

function getFocusTask() {
  return focusSession ? tasks.find((task) => task.id === focusSession.taskId) || null : null;
}

function getFocusSecondsRemaining(now = Date.now()) {
  if (!focusSession) {
    return 0;
  }

  if (focusSession.status === 'paused') {
    return focusSession.remainingSeconds;
  }

  return Math.max(0, Math.ceil((focusSession.endsAt - now) / 1000));
}

function getDefaultFocusMinutes(task) {
  return task && focusDurationOptions.includes(task.estimatedMinutes) ? task.estimatedMinutes : 10;
}

function setFocusStatus(message) {
  el('focus-status').textContent = message;
}

function resetDocumentTitle() {
  document.title = defaultDocumentTitle;
}

function updateDocumentTitle(seconds) {
  document.title = formatFocusTime(seconds) + ' — QueueClear';
}

function stopFocusInterval() {
  if (focusTimer) {
    clearInterval(focusTimer);
    focusTimer = null;
  }
}

function renderFocusControls() {
  const recommendation = getCurrentRecommendation();
  const sessionTask = getFocusTask();
  const suggestedTask = sessionTask || recommendation?.task || null;
  const focusPanel = el('focus-session');
  const durationInput = el('focus-duration');
  const startButton = el('start-focus');
  const pauseButton = el('pause-focus');
  const restartButton = el('restart-focus');
  const endButton = el('end-focus');
  const finishedPanel = el('session-finished');

  focusPanel.hidden = !suggestedTask;

  if (!suggestedTask) {
    return;
  }

  if (!focusSession && suggestedTask.id !== lastSuggestedFocusTaskId) {
    durationInput.value = String(getDefaultFocusMinutes(suggestedTask));
    lastSuggestedFocusTaskId = suggestedTask.id;
  }

  if (!focusSession) {
    const selectedMinutes = Number(durationInput.value);
    el('focus-countdown').textContent = formatFocusTime(selectedMinutes * 60);
    startButton.hidden = false;
    startButton.textContent = 'Start focus';
    startButton.disabled = false;
    pauseButton.hidden = true;
    restartButton.disabled = true;
    endButton.disabled = true;
    durationInput.disabled = false;
    finishedPanel.hidden = focusFinishedTaskId !== suggestedTask.id;
    if (focusFinishedTaskId !== suggestedTask.id) {
      setFocusStatus('Choose a length when you are ready.');
    }
    return;
  }

  const remainingSeconds = getFocusSecondsRemaining();
  el('focus-countdown').textContent = formatFocusTime(remainingSeconds);
  durationInput.value = String(focusSession.durationMinutes);
  durationInput.disabled = true;
  restartButton.disabled = false;
  endButton.disabled = false;
  finishedPanel.hidden = true;

  if (focusSession.status === 'running') {
    startButton.hidden = true;
    pauseButton.hidden = false;
    pauseButton.textContent = 'Pause';
    setFocusStatus('Focus session running.');
  } else {
    startButton.hidden = false;
    startButton.textContent = 'Resume';
    startButton.disabled = false;
    pauseButton.hidden = true;
    setFocusStatus('Focus paused. Your time is saved here.');
  }
}

function finishFocusSession() {
  const finishedTaskId = focusSession?.taskId || null;
  stopFocusInterval();
  focusSession = null;
  saveFocusSession();
  resetDocumentTitle();
  focusFinishedTaskId = finishedTaskId;
  render();
  setFocusStatus('Focus session finished.');
}

function updateRunningFocus() {
  if (!focusSession || focusSession.status !== 'running') {
    stopFocusInterval();
    resetDocumentTitle();
    return;
  }

  const remainingSeconds = getFocusSecondsRemaining();
  if (remainingSeconds <= 0) {
    finishFocusSession();
    return;
  }

  el('focus-countdown').textContent = formatFocusTime(remainingSeconds);
  updateDocumentTitle(remainingSeconds);
}

function beginFocusInterval() {
  stopFocusInterval();
  updateRunningFocus();

  if (focusSession?.status === 'running') {
    focusTimer = setInterval(updateRunningFocus, 1000);
  }
}

function createActionButton(label, className, ariaLabel) {
  const button = document.createElement('button');
  button.className = 'text-button ' + className;
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-label', ariaLabel);
  return button;
}

function isTaskVisible(task) {
  if (filter === 'all') {
    return true;
  }

  if (filter === 'active') {
    return !task.done;
  }

  if (filter === 'completed') {
    return task.done;
  }

  if (filter === 'due-today') {
    return !task.done && getDueStatus(task) === 'today';
  }

  if (filter === 'snoozed') {
    return !task.done && isSnoozed(task);
  }

  return task.energy === filter;
}

function compareSuggestedTasks(first, second) {
  const firstGroup = first.done ? 2 : isSnoozed(first) ? 1 : 0;
  const secondGroup = second.done ? 2 : isSnoozed(second) ? 1 : 0;

  if (firstGroup !== secondGroup) {
    return firstGroup - secondGroup;
  }

  const firstSelection = getTaskSelection(first);
  const secondSelection = getTaskSelection(second);

  if (firstSelection.score !== secondSelection.score) {
    return secondSelection.score - firstSelection.score;
  }

  return first.createdAt - second.createdAt || first.id.localeCompare(second.id);
}

function getDueSortValue(task) {
  return task.dueDate ? new Date(task.dueDate + 'T12:00:00').getTime() : Number.POSITIVE_INFINITY;
}

function sortTasks(taskList) {
  return taskList.slice().sort((first, second) => {
    if (sortOption === 'newest') {
      return second.createdAt - first.createdAt || second.id.localeCompare(first.id);
    }

    if (sortOption === 'oldest') {
      return first.createdAt - second.createdAt || first.id.localeCompare(second.id);
    }

    if (sortOption === 'shortest') {
      const firstEstimate = first.estimatedMinutes ?? Number.POSITIVE_INFINITY;
      const secondEstimate = second.estimatedMinutes ?? Number.POSITIVE_INFINITY;
      return firstEstimate - secondEstimate || first.createdAt - second.createdAt;
    }

    if (sortOption === 'due-soon') {
      return getDueSortValue(first) - getDueSortValue(second) || first.createdAt - second.createdAt;
    }

    return compareSuggestedTasks(first, second);
  });
}

function getVisibleTasks() {
  return sortTasks(tasks.filter(isTaskVisible));
}

function cloneTask(task) {
  return { ...task };
}

function showQueueStatus(message) {
  el('queue-message').textContent = message;
}

function renderUndo() {
  const undoBar = el('undo-bar');
  undoBar.hidden = !undoAction;

  if (undoAction) {
    el('undo-message').textContent = undoAction.message;
  }
}

function setUndo(action) {
  undoAction = action;
  renderUndo();
}

function clearUndo(message) {
  undoAction = null;
  renderUndo();

  if (message) {
    showQueueStatus(message);
  }
}

function focusTaskControl(taskId, control) {
  requestAnimationFrame(() => el(control + '-' + taskId)?.focus());
}

function createEditField(labelText, control) {
  const field = document.createElement('div');
  const label = document.createElement('label');
  label.htmlFor = control.id;
  label.textContent = labelText;
  field.className = 'field';
  field.append(label, control);
  return field;
}

function createEditSelect(id, options, selectedValue) {
  const select = document.createElement('select');
  select.id = id;

  options.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = String(value) === String(selectedValue);
    select.append(option);
  });

  return select;
}

function createTaskEditForm(task) {
  const form = document.createElement('form');
  const titleInput = document.createElement('input');
  const firstStepInput = document.createElement('input');
  const dueDateInput = document.createElement('input');
  const saveButton = document.createElement('button');
  const cancelButton = document.createElement('button');
  const energyInput = createEditSelect(
    'edit-energy-' + task.id,
    energyLevels.map((energy) => ({ value: energy, label: formatEnergy(energy) })),
    task.energy,
  );
  const estimatedMinutesInput = createEditSelect(
    'edit-estimated-minutes-' + task.id,
    [{ value: '', label: 'No estimate yet' }].concat(
      estimateOptions.map((minutes) => ({ value: minutes, label: minutes + ' minutes' })),
    ),
    task.estimatedMinutes ?? '',
  );

  form.className = 'task-edit-form';
  form.noValidate = true;

  titleInput.id = 'edit-title-' + task.id;
  titleInput.value = task.text;
  titleInput.maxLength = maxTitleLength;
  titleInput.required = true;

  firstStepInput.id = 'edit-first-step-' + task.id;
  firstStepInput.value = task.firstStep || '';
  firstStepInput.maxLength = maxFirstStepLength;

  dueDateInput.id = 'edit-due-date-' + task.id;
  dueDateInput.type = 'date';
  dueDateInput.value = task.dueDate || '';

  saveButton.type = 'submit';
  saveButton.className = 'primary-button';
  saveButton.textContent = 'Save';

  cancelButton.type = 'button';
  cancelButton.className = 'text-button';
  cancelButton.textContent = 'Cancel';

  const actions = document.createElement('div');
  actions.className = 'task-edit-actions';
  actions.append(saveButton, cancelButton);

  form.append(
    createEditField('Task title', titleInput),
    createEditField('Energy needed', energyInput),
    createEditField('Estimated time', estimatedMinutesInput),
    createEditField('First step', firstStepInput),
    createEditField('Due date', dueDateInput),
    actions,
  );

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = normalizeWhitespace(titleInput.value);

    if (!text) {
      showQueueStatus('Add a short task title first.');
      titleInput.focus();
      return;
    }

    if (text.length > maxTitleLength) {
      showQueueStatus('Keep task titles under ' + maxTitleLength + ' characters.');
      titleInput.focus();
      return;
    }

    if (hasDuplicateActiveTitle(text, task.id)) {
      showQueueStatus('That task is already in your active queue.');
      titleInput.focus();
      return;
    }

    const updatedTask = normalizeTask({
      ...task,
      text,
      energy: energyInput.value,
      estimatedMinutes: estimatedMinutesInput.value,
      firstStep: firstStepInput.value,
      dueDate: dueDateInput.value,
    });

    tasks = tasks.map((savedTask) => (savedTask.id === task.id ? updatedTask : savedTask));
    editingTaskId = null;
    selectedTaskId = null;
    saveTasks();
    clearUndo('Previous undo is no longer available after another action.');
    render();
    showQueueStatus('Task updated.');
    focusTaskControl(task.id, 'edit-task');
  });

  cancelButton.addEventListener('click', () => {
    editingTaskId = null;
    render();
    showQueueStatus('Edit cancelled. The task was not changed.');
    focusTaskControl(task.id, 'edit-task');
  });

  return form;
}

function renderTaskList() {
  const visibleTasks = getVisibleTasks();
  const taskList = el('task-list');

  taskList.innerHTML = '';

  visibleTasks.forEach((task) => {
    const item = document.createElement('li');

    item.className = 'task-row' + (task.done ? ' is-done' : '');

    if (editingTaskId === task.id) {
      item.classList.add('is-editing');
      item.append(createTaskEditForm(task));
      taskList.append(item);
      return;
    }

    const checkbox = document.createElement('input');
    const content = document.createElement('div');
    const title = document.createElement('span');
    const metadata = document.createElement('span');
    const energy = document.createElement('span');
    const actions = document.createElement('div');
    const taskIsSnoozed = isSnoozed(task);
    const metadataParts = [];

    checkbox.id = 'complete-' + task.id;
    checkbox.type = 'checkbox';
    checkbox.checked = task.done;
    checkbox.setAttribute('aria-label', 'Mark ' + task.text + ' complete');

    content.className = 'task-content';
    title.className = 'task-text';
    title.textContent = task.text;
    content.append(title);

    if (task.estimatedMinutes) {
      metadataParts.push(task.estimatedMinutes + ' min');
    }

    if (task.dueDate) {
      const dueStatus = getDueStatus(task);
      metadataParts.push(dueStatus === 'today' ? 'Due today' : 'Due ' + formatDueDate(task.dueDate));
    }

    if (metadataParts.length > 0) {
      metadata.className = 'task-meta';
      metadata.textContent = metadataParts.join(' · ');
      content.append(metadata);
    }

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
      wakeButton.id = 'wake-task-' + task.id;
      wakeButton.addEventListener('click', () => {
        task.snoozedUntil = null;
        selectedTaskId = null;
        saveTasks();
        clearUndo('Previous undo is no longer available after another action.');
        render();
        showNextStatus('Back in your active queue.');
        focusTaskControl(task.id, 'wake-task');
      });
      actions.append(wakeButton);
    }

    const editButton = createActionButton('Edit', 'edit-task', 'Edit ' + task.text);
    editButton.id = 'edit-task-' + task.id;
    editButton.addEventListener('click', () => {
      editingTaskId = task.id;
      render();
      requestAnimationFrame(() => el('edit-title-' + task.id)?.focus());
    });

    const deleteButton = createActionButton('Delete', 'delete-task', 'Delete ' + task.text);
    deleteButton.id = 'delete-task-' + task.id;
    deleteButton.addEventListener('click', () => deleteTask(task.id));
    actions.append(editButton, deleteButton);

    checkbox.addEventListener('change', () => setTaskCompletion(task.id, checkbox.checked));

    item.append(checkbox, content, energy, actions);
    taskList.append(item);
  });

  renderUndo();
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
    el('pick-another').disabled = true;
    el('complete-next').disabled = true;
    el('snooze-control').hidden = true;
    renderFocusControls();
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

  el('pick-another').disabled = false;
  el('complete-next').disabled = false;
  el('snooze-control').hidden = false;
  renderFocusControls();
}

function renderEmptyState(visibleTasks) {
  el('empty-state').hidden = visibleTasks.length > 0;

  if (visibleTasks.length === 0) {
    el('empty-state').textContent =
      filter === 'all'
        ? 'Your queue is clear. Add a small task when something comes up.'
        : 'No tasks match this view yet.';
  }
}

function render() {
  renderNextAction();
  renderTaskList();
}

function hasDuplicateActiveTitle(text, excludedTaskId = null) {
  const comparableTitle = text.toLocaleLowerCase();
  return getActiveTasks().some(
    (task) => task.id !== excludedTaskId && task.text.toLocaleLowerCase() === comparableTitle,
  );
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
  clearUndo('Previous undo is no longer available after another action.');
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

  setTaskCompletion(recommendation.task.id, true);
  showNextStatus('Marked done. Another task is ready when you are.');
}

function clearCompletedTasks() {
  const completedTasks = tasks.filter((task) => task.done);

  if (completedTasks.length === 0) {
    showQueueStatus('There are no completed tasks to clear.');
    return;
  }

  const previousTasks = tasks.map(cloneTask);
  tasks = tasks.filter((task) => !task.done);
  selectedTaskId = null;
  saveTasks();
  setUndo({
    type: 'clear-completed',
    tasks: previousTasks,
    message:
      'Cleared ' +
      completedTasks.length +
      ' completed ' +
      (completedTasks.length === 1 ? 'task' : 'tasks') +
      '. Undo is available until another action or refresh.',
  });
  render();
  showQueueStatus('Completed tasks cleared.');
}

function setTaskCompletion(taskId, done) {
  const task = tasks.find((savedTask) => savedTask.id === taskId);

  if (!task || task.done === done) {
    return;
  }

  if (done) {
    const previousTask = cloneTask(task);
    task.done = true;
    task.completedAt = Date.now();
    setUndo({
      type: 'complete',
      task: previousTask,
      message: 'Marked “' + task.text + '” done. Undo is available until another action or refresh.',
    });
  } else {
    task.done = false;
    task.completedAt = null;
    clearUndo('Previous undo is no longer available after another action.');
  }

  selectedTaskId = null;
  saveTasks();
  render();
}

function deleteTask(taskId) {
  const taskIndex = tasks.findIndex((task) => task.id === taskId);

  if (taskIndex === -1) {
    return;
  }

  const deletedTask = cloneTask(tasks[taskIndex]);
  tasks = tasks.filter((task) => task.id !== taskId);
  selectedTaskId = null;
  editingTaskId = null;
  saveTasks();
  setUndo({
    type: 'delete',
    task: deletedTask,
    index: taskIndex,
    message: 'Deleted “' + deletedTask.text + '”. Undo is available until another action or refresh.',
  });
  render();
  showQueueStatus('Task deleted.');
}

function undoLastAction() {
  if (!undoAction) {
    return;
  }

  const action = undoAction;
  undoAction = null;

  if (action.type === 'complete') {
    tasks = tasks.map((task) => (task.id === action.task.id ? cloneTask(action.task) : task));
  } else if (action.type === 'delete') {
    tasks.splice(action.index, 0, cloneTask(action.task));
  } else if (action.type === 'clear-completed') {
    tasks = action.tasks.map(cloneTask);
  }

  selectedTaskId = null;
  editingTaskId = null;
  saveTasks();
  render();
  showQueueStatus('Restored the last change.');
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

function setSortOption() {
  sortOption = el('sort-input').value;
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
  clearUndo('Previous undo is no longer available after another action.');
  render();
  showNextStatus(
    'Snoozed until ' +
      formatSnoozeTime(recommendation.task.snoozedUntil) +
      '. It is still in your queue.',
  );
}

function startOrResumeFocus() {
  if (focusSession?.status === 'paused') {
    focusSession = {
      ...focusSession,
      status: 'running',
      endsAt: Date.now() + focusSession.remainingSeconds * 1000,
    };
    delete focusSession.remainingSeconds;
    saveFocusSession();
    render();
    beginFocusInterval();
    setFocusStatus('Focus resumed.');
    return;
  }

  const recommendation = getCurrentRecommendation();
  if (!recommendation) {
    return;
  }

  const durationMinutes = Number(el('focus-duration').value);
  focusSession = {
    taskId: recommendation.task.id,
    durationMinutes: focusDurationOptions.includes(durationMinutes) ? durationMinutes : 10,
    status: 'running',
    endsAt: Date.now() + durationMinutes * 60 * 1000,
  };
  focusFinishedTaskId = null;
  saveFocusSession();
  render();
  beginFocusInterval();
  setFocusStatus('Focus started.');
}

function pauseFocus() {
  if (!focusSession || focusSession.status !== 'running') {
    return;
  }

  focusSession = {
    taskId: focusSession.taskId,
    durationMinutes: focusSession.durationMinutes,
    status: 'paused',
    remainingSeconds: getFocusSecondsRemaining(),
  };
  stopFocusInterval();
  saveFocusSession();
  resetDocumentTitle();
  render();
  setFocusStatus('Focus paused.');
}

function restartFocus() {
  if (!focusSession) {
    return;
  }

  focusSession = {
    taskId: focusSession.taskId,
    durationMinutes: focusSession.durationMinutes,
    status: 'running',
    endsAt: Date.now() + focusSession.durationMinutes * 60 * 1000,
  };
  focusFinishedTaskId = null;
  saveFocusSession();
  render();
  beginFocusInterval();
  setFocusStatus('Focus restarted.');
}

function endFocus() {
  if (!focusSession) {
    return;
  }

  stopFocusInterval();
  focusSession = null;
  focusFinishedTaskId = null;
  saveFocusSession();
  resetDocumentTitle();
  render();
  setFocusStatus('Focus session ended. The task is still in your queue.');
}

function finishAndMarkDone() {
  focusFinishedTaskId = null;
  completeNextTask();
}

function startAnotherFocusSession() {
  focusFinishedTaskId = null;
  render();
  startOrResumeFocus();
}

function returnToQueue() {
  focusFinishedTaskId = null;
  render();
  showNextStatus('The task is still safe in your queue.');
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
el('undo-button').addEventListener('click', undoLastAction);
el('start-focus').addEventListener('click', startOrResumeFocus);
el('pause-focus').addEventListener('click', pauseFocus);
el('restart-focus').addEventListener('click', restartFocus);
el('end-focus').addEventListener('click', endFocus);
el('finish-mark-done').addEventListener('click', finishAndMarkDone);
el('focus-another').addEventListener('click', startAnotherFocusSession);
el('return-to-queue').addEventListener('click', returnToQueue);
el('theme-toggle').addEventListener('click', toggleTheme);
el('current-energy-input').addEventListener('change', setCurrentEnergy);
el('pick-another').addEventListener('click', pickAnotherTask);
el('sort-input').addEventListener('change', setSortOption);

document.querySelectorAll('[data-snooze]').forEach((button) => {
  button.addEventListener('click', () => snoozeCurrentTask(button.dataset.snooze));
});

document.querySelectorAll('.filter').forEach((button) => {
  button.addEventListener('click', () => setFilter(button));
});

applyTheme();
render();

if (focusSession?.status === 'running') {
  if (getFocusSecondsRemaining() <= 0) {
    finishFocusSession();
  } else {
    beginFocusInterval();
  }
}
