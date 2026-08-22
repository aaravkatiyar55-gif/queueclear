import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeDueDate,
  normalizePersonalSettings,
  normalizeTask,
  normalizeWhitespace,
} from '../queueclear-model.mjs';

test('normalizes repeated task whitespace without losing meaningful text', () => {
  assert.equal(normalizeWhitespace('  Read   chapter\n  two  '), 'Read chapter two');
});

test('rejects impossible and malformed due dates', () => {
  assert.equal(normalizeDueDate('2026-02-29'), null);
  assert.equal(normalizeDueDate('2028-02-29'), '2028-02-29');
  assert.equal(normalizeDueDate('20-08-2026'), null);
});

test('normalizes legacy tasks without optional fields', () => {
  const task = normalizeTask(
    { text: '  Pack   bag ', energy: 'invalid', createdAt: 25 },
    { now: 50, createId: () => 'new-id' },
  );
  assert.deepEqual(task, {
    id: 'new-id',
    text: 'Pack bag',
    energy: 'medium',
    done: false,
    createdAt: 25,
    estimatedMinutes: null,
    firstStep: null,
    waitingOn: null,
    waitingUntil: null,
    handoff: null,
    handoffAt: null,
    snoozedUntil: null,
    completedAt: null,
    dueDate: null,
    subject: 'general',
    priority: 'normal',
    recurrence: 'none',
    checklist: [],
  });
});

test('keeps a valid waiting revisit date while rejecting malformed dates', () => {
  assert.equal(
    normalizeTask({ text: 'Ask teacher', waitingOn: 'Clarification', waitingUntil: '2026-08-23' }).waitingUntil,
    '2026-08-23',
  );
  assert.equal(
    normalizeTask({ text: 'Ask teacher', waitingOn: 'Clarification', waitingUntil: 'next Tuesday' }).waitingUntil,
    null,
  );
});

test('keeps valid checklist items and weekly recurrence while rejecting blank checklist text', () => {
  const task = normalizeTask({
    id: 'repeat-id',
    text: 'Weekly recap',
    recurrence: 'weekly',
    subject: 'maths',
    priority: 'important',
    checklist: [{ id: 'one', text: ' Review notes ' }, { id: 'two', text: '   ' }],
  });
  assert.equal(task.recurrence, 'weekly');
  assert.equal(task.subject, 'maths');
  assert.equal(task.priority, 'important');
  assert.deepEqual(task.checklist, [{ id: 'one', text: 'Review notes', done: false }]);
});

test('uses safe personal-setting defaults for invalid saved values', () => {
  assert.deepEqual(normalizePersonalSettings({ workspaceName: '  My space ', focusMinutes: 99 }), {
    workspaceName: 'My space',
    personalNote: '',
    focusMinutes: 10,
  });
});
