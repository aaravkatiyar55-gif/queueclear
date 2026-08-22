import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatDueDate,
  formatFocusTime,
  formatSnoozeTime,
  getSnoozeTime,
  getWaitingReviewDate,
  isDueToday,
} from '../queueclear-timer-history.mjs';

test('formatFocusTime formats mm:ss cleanly', () => {
  assert.equal(formatFocusTime(600), '10:00');
  assert.equal(formatFocusTime(65), '1:05');
  assert.equal(formatFocusTime(0), '0:00');
  assert.equal(formatFocusTime(-5), '0:00');
});

test('formatDueDate correctly identifies overdue, due today, and due tomorrow', () => {
  const baseDate = new Date('2026-08-22T10:00:00');
  assert.equal(formatDueDate('2026-08-20', baseDate), 'Overdue: 2026-08-20');
  assert.equal(formatDueDate('2026-08-22', baseDate), 'Due today');
  assert.equal(formatDueDate('2026-08-23', baseDate), 'Due tomorrow');
  assert.equal(formatDueDate('2026-08-28', baseDate), 'Due 2026-08-28');
  assert.equal(formatDueDate('', baseDate), '');
});

test('isDueToday checks exact local date match', () => {
  const baseDate = new Date('2026-08-22T10:00:00');
  assert.equal(isDueToday({ dueDate: '2026-08-22' }, baseDate), true);
  assert.equal(isDueToday({ dueDate: '2026-08-23' }, baseDate), false);
  assert.equal(isDueToday(null, baseDate), false);
});

test('getWaitingReviewDate calculates tomorrow and next week dates', () => {
  const baseDate = new Date('2026-08-22T10:00:00');
  assert.equal(getWaitingReviewDate('tomorrow', baseDate), '2026-08-23');
  assert.equal(getWaitingReviewDate('next-week', baseDate), '2026-08-29');
  assert.equal(getWaitingReviewDate('invalid', baseDate), null);
});
