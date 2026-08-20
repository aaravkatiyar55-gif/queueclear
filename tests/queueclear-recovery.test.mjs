import assert from 'node:assert/strict';
import test from 'node:test';
import { validateBackup } from '../queueclear-recovery.mjs';

const options = {
  timeAvailableOptions: [5, 15, 25, 45],
  fallbackTodayPlan: { date: '2026-08-20', taskIds: [] },
  normalizeTodayPlan: (value) => value,
  normalizeRoutine: (value) => value?.name && Array.isArray(value.steps) && value.steps.length ? value : null,
  normalizeHistoryItem: (value) => value?.type && value?.text && value?.createdAt ? value : null,
};

function validBackup(overrides = {}) {
  return {
    schemaVersion: 2,
    tasks: [{ id: 'one', text: 'Read notes', energy: 'low', done: false, createdAt: 1 }],
    theme: 'paper',
    currentEnergy: 'low',
    timeAvailable: 15,
    personalSettings: { workspaceName: '', personalNote: '', focusMinutes: 10 },
    todayPlan: { date: '2026-08-20', taskIds: ['one'] },
    routines: [],
    historyItems: [],
    ...overrides,
  };
}

test('accepts a valid version 2 backup and reports included preferences', () => {
  const recovered = validateBackup(validBackup(), options);
  assert.equal(recovered.tasks[0].text, 'Read notes');
  assert.equal(recovered.todayPlan.included, true);
  assert.equal(recovered.routines.included, true);
});

test('keeps older version 1 backups readable with missing newer sections', () => {
  const legacy = validBackup({ schemaVersion: 1 });
  delete legacy.todayPlan;
  delete legacy.routines;
  delete legacy.historyItems;
  const recovered = validateBackup(legacy, options);
  assert.equal(recovered.todayPlan.included, false);
  assert.deepEqual(recovered.routines.value, []);
});

test('rejects duplicate task IDs before anything can be written', () => {
  const backup = validBackup({
    tasks: [
      { id: 'same', text: 'Task one', energy: 'low', done: false, createdAt: 1 },
      { id: 'same', text: 'Task two', energy: 'low', done: false, createdAt: 2 },
    ],
  });
  assert.throws(() => validateBackup(backup, options), /duplicate task IDs/);
});

test('rejects unknown backup shapes', () => {
  assert.throws(() => validateBackup({ schemaVersion: 3, tasks: [] }, options), /unsupported QueueClear structure/);
});
