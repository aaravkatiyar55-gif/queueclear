import {
  energyLevels,
  focusDurationOptions,
  normalizePersonalSettings,
  normalizeTask,
} from './queueclear-model.mjs';

function hasOwnProperty(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property);
}

function restoredPreference(backup, key, isValid, fallback) {
  if (!hasOwnProperty(backup, key)) {
    return { value: fallback, included: false };
  }
  if (!isValid(backup[key])) {
    throw new Error('This backup has an unsupported ' + key + ' preference.');
  }
  return { value: backup[key], included: true };
}

export function validateBackup(candidate, {
  timeAvailableOptions,
  fallbackTodayPlan,
  normalizeTodayPlan,
  normalizeRoutine,
  normalizeHistoryItem,
}) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('This file is not a QueueClear backup.');
  }
  if (![1, 2].includes(candidate.schemaVersion) || !Array.isArray(candidate.tasks)) {
    throw new Error('This backup has an unsupported QueueClear structure.');
  }

  const restoredTasks = candidate.tasks.map(normalizeTask);
  if (restoredTasks.some((task) => task === null)) {
    throw new Error('This backup contains a task QueueClear cannot recover safely.');
  }
  if (new Set(restoredTasks.map((task) => task.id)).size !== restoredTasks.length) {
    throw new Error('This backup contains duplicate task IDs.');
  }

  const theme = restoredPreference(candidate, 'theme', (value) => value === 'paper' || value === 'calm', 'paper');
  const currentEnergy = restoredPreference(candidate, 'currentEnergy', (value) => energyLevels.includes(value), 'medium');
  const timeAvailable = restoredPreference(candidate, 'timeAvailable', (value) => value === null || timeAvailableOptions.includes(value), null);
  const personalSettings = restoredPreference(
    candidate,
    'personalSettings',
    (value) => value && typeof value === 'object' && !Array.isArray(value) &&
      typeof value.workspaceName === 'string' && typeof value.personalNote === 'string' &&
      focusDurationOptions.includes(Number(value.focusMinutes)),
    normalizePersonalSettings({}),
  );
  const todayPlan = restoredPreference(candidate, 'todayPlan', (value) => value && typeof value === 'object' && !Array.isArray(value), fallbackTodayPlan);
  const routines = restoredPreference(candidate, 'routines', (value) => Array.isArray(value) && value.every((routine) => normalizeRoutine(routine) !== null), []);
  const historyItems = restoredPreference(candidate, 'historyItems', (value) => Array.isArray(value) && value.every((item) => normalizeHistoryItem(item) !== null), []);

  return {
    tasks: restoredTasks,
    theme,
    currentEnergy,
    timeAvailable,
    personalSettings,
    todayPlan: { value: normalizeTodayPlan(todayPlan.value), included: todayPlan.included },
    routines: { value: routines.value.map(normalizeRoutine).filter(Boolean), included: routines.included },
    historyItems: { value: historyItems.value.map(normalizeHistoryItem).filter(Boolean), included: historyItems.included },
  };
}
