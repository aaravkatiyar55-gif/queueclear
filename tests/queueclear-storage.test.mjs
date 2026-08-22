import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendHistory,
  getLocalDatePart,
  loadCurrentEnergy,
  loadHistory,
  loadPersonalSettings,
  loadRoutines,
  loadTasks,
  loadTimeAvailable,
  loadTodayPlan,
  normalizeHistoryItem,
  normalizeRoutine,
  normalizeTodayPlan,
  saveCurrentEnergy,
  saveHistory,
  savePersonalSettings,
  saveRoutines,
  saveTasks,
  saveTimeAvailable,
  saveTodayPlan,
  storageKey,
  legacyStorageKey,
} from '../queueclear-storage.mjs';

function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

test('loadTasks falls back to legacy v1 storage if v2 is empty and migrates upon save', () => {
  const mockStorage = createMockStorage({
    [legacyStorageKey]: JSON.stringify([
      { id: 't1', text: 'Legacy task', energy: 'high', done: false },
    ]),
  });

  const tasks = loadTasks(mockStorage);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].text, 'Legacy task');
  assert.equal(tasks[0].energy, 'high');

  saveTasks(tasks, mockStorage);
  assert.equal(mockStorage.getItem(legacyStorageKey), null);
  assert.ok(mockStorage.getItem(storageKey).includes('Legacy task'));
});

test('normalizeTodayPlan clamps to 5 unique tasks and defaults date to today', () => {
  const plan = normalizeTodayPlan({
    date: '2026-08-22',
    taskIds: ['a', 'b', 'b', 'c', 'd', 'e', 'f', 'g'],
  });

  assert.equal(plan.date, '2026-08-22');
  assert.deepEqual(plan.taskIds, ['a', 'b', 'c', 'd', 'e']);
});

test('saveTodayPlan filters out completed and missing tasks', () => {
  const mockStorage = createMockStorage();
  const tasks = [
    { id: 't1', text: 'Task 1', done: false },
    { id: 't2', text: 'Task 2', done: true },
  ];
  const plan = { date: '2026-08-22', taskIds: ['t1', 't2', 't3'] };

  saveTodayPlan(plan, tasks, mockStorage);
  const loaded = loadTodayPlan(mockStorage, new Date('2026-08-22T12:00:00'));
  assert.deepEqual(loaded.taskIds, ['t1']);
});

test('normalizeRoutine trims steps and bounds max step count', () => {
  const routine = normalizeRoutine({
    name: '  Maths Warmup  ',
    steps: [' Step 1 ', '', 'Step 2'],
  });
  assert.equal(routine.name, 'Maths Warmup');
  assert.deepEqual(routine.steps, ['Step 1', 'Step 2']);
});

test('appendHistory caps items to max limit', () => {
  const mockStorage = createMockStorage();
  let history = [];
  for (let i = 0; i < 110; i++) {
    history = appendHistory(history, 'completed', `Completed item ${i}`, mockStorage);
  }
  assert.equal(history.length, 100);
  assert.equal(history[0].text, 'Completed item 109');
});
