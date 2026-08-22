import {
  energyLevels,
  normalizeDueDate,
  normalizePersonalSettings,
  normalizeTask,
  normalizeTimestamp,
  normalizeWhitespace,
} from './queueclear-model.mjs';

export const storageKey = 'queueclear.tasks.v2';
export const legacyStorageKey = 'queueclear.tasks.v1';
export const themeKey = 'queueclear.theme.v1';
export const currentEnergyKey = 'queueclear.current-energy.v1';
export const timeAvailableKey = 'queueclear.time-available.v1';
export const settingsKey = 'queueclear.settings.v1';
export const todayPlanKey = 'queueclear.today-plan.v1';
export const routinesKey = 'queueclear.routines.v1';
export const historyKey = 'queueclear.history.v1';

export const timeAvailableOptions = [5, 15, 25, 45];
export const maxRoutineNameLength = 60;
export const maxRoutineStepLength = 140;
export const maxTodayTasks = 5;
export const maxHistoryItems = 100;

export function getLocalDatePart(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

export function normalizeTodayPlan(candidate) {
  const taskIds = Array.isArray(candidate?.taskIds)
    ? candidate.taskIds.filter((taskId) => typeof taskId === 'string')
    : [];
  return {
    date: normalizeDueDate(candidate?.date) || getLocalDatePart(),
    taskIds: [...new Set(taskIds)].slice(0, maxTodayTasks),
  };
}

export function normalizeRoutine(candidate) {
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

export function normalizeHistoryItem(candidate) {
  const type = ['completed', 'focus-started', 'focus-finished', 'handoff'].includes(candidate?.type)
    ? candidate.type
    : null;
  const text = normalizeWhitespace(candidate?.text).slice(0, 180);
  const createdAt = normalizeTimestamp(candidate?.createdAt);
  return type && text && createdAt ? { type, text, createdAt } : null;
}

export function loadTasks(storage = localStorage) {
  try {
    const saved = JSON.parse(
      storage.getItem(storageKey) || storage.getItem(legacyStorageKey) || '[]',
    );
    return Array.isArray(saved) ? saved.map(normalizeTask).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function saveTasks(tasks, storage = localStorage) {
  storage.setItem(storageKey, JSON.stringify(tasks));
  storage.removeItem(legacyStorageKey);
}

export function loadCurrentEnergy(storage = localStorage) {
  const saved = storage.getItem(currentEnergyKey);
  return energyLevels.includes(saved) ? saved : 'medium';
}

export function saveCurrentEnergy(energy, storage = localStorage) {
  storage.setItem(currentEnergyKey, energy);
}

export function loadTimeAvailable(storage = localStorage) {
  const saved = Number(storage.getItem(timeAvailableKey));
  return timeAvailableOptions.includes(saved) ? saved : null;
}

export function saveTimeAvailable(timeAvailable, storage = localStorage) {
  storage.setItem(timeAvailableKey, timeAvailable === null ? '' : String(timeAvailable));
}

export function loadPersonalSettings(storage = localStorage) {
  try {
    return normalizePersonalSettings(JSON.parse(storage.getItem(settingsKey) || '{}'));
  } catch {
    return normalizePersonalSettings({});
  }
}

export function savePersonalSettings(settings, storage = localStorage) {
  storage.setItem(settingsKey, JSON.stringify(settings));
}

export function loadTodayPlan(storage = localStorage, now = new Date()) {
  const today = getLocalDatePart(now);
  try {
    const plan = normalizeTodayPlan(JSON.parse(storage.getItem(todayPlanKey) || '{}'));
    return plan.date === today ? plan : { date: today, taskIds: [] };
  } catch {
    return { date: today, taskIds: [] };
  }
}

export function saveTodayPlan(todayPlan, tasks = [], storage = localStorage) {
  todayPlan.date = getLocalDatePart();
  todayPlan.taskIds = todayPlan.taskIds.filter((taskId) =>
    tasks.some((task) => task.id === taskId && !task.done),
  );
  storage.setItem(todayPlanKey, JSON.stringify(todayPlan));
}

export function loadRoutines(storage = localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(routinesKey) || '[]');
    return Array.isArray(saved) ? saved.map(normalizeRoutine).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function saveRoutines(routines, storage = localStorage) {
  storage.setItem(routinesKey, JSON.stringify(routines));
}

export function loadHistory(storage = localStorage) {
  try {
    const saved = JSON.parse(storage.getItem(historyKey) || '[]');
    return Array.isArray(saved)
      ? saved.map(normalizeHistoryItem).filter(Boolean).slice(0, maxHistoryItems)
      : [];
  } catch {
    return [];
  }
}

export function saveHistory(historyItems, storage = localStorage) {
  storage.setItem(historyKey, JSON.stringify(historyItems.slice(0, maxHistoryItems)));
}

export function appendHistory(historyItems, type, text, storage = localStorage) {
  const item = normalizeHistoryItem({ type, text, createdAt: Date.now() });
  if (!item) {
    return historyItems;
  }
  const updated = [item, ...historyItems].slice(0, maxHistoryItems);
  saveHistory(updated, storage);
  return updated;
}

export function getThemePreference(storage = localStorage) {
  return storage.getItem(themeKey) === 'calm' ? 'calm' : 'paper';
}

export function saveThemePreference(theme, storage = localStorage) {
  storage.setItem(themeKey, theme === 'calm' ? 'calm' : 'paper');
}
