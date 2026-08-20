import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreTaskIdToTodayPlan } from '../queueclear-today-plan.mjs';

test('restores an undone task to its earlier Today plan position', () => {
  const result = restoreTaskIdToTodayPlan(['task-a', 'task-c'], 'task-b', 1, 5);

  assert.deepEqual(result, {
    taskIds: ['task-a', 'task-b', 'task-c'],
    restored: true,
  });
});

test('does not overfill Today plan or duplicate a task while undoing', () => {
  assert.deepEqual(
    restoreTaskIdToTodayPlan(['a', 'b', 'c', 'd', 'e'], 'restored', 1, 5),
    { taskIds: ['a', 'b', 'c', 'd', 'e'], restored: false },
  );
  assert.deepEqual(
    restoreTaskIdToTodayPlan(['a', 'b'], 'b', 1, 5),
    { taskIds: ['a', 'b'], restored: false },
  );
});
