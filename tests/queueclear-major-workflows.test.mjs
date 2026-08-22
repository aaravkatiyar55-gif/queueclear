import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDailyPlan,
  getPlanRealityCheck,
  getResumableTasks,
  getSuggestion,
  getSuggestionReason,
  getWaitingFollowUps,
} from '../queueclear-major-workflows.mjs';

const now = new Date('2026-08-22T10:00:00').getTime();

function task(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    text: 'Read notes',
    energy: 'medium',
    estimatedMinutes: 15,
    createdAt: 1,
    done: false,
    waitingOn: null,
    waitingUntil: null,
    handoff: null,
    handoffAt: null,
    snoozedUntil: null,
    ...overrides,
  };
}

test('buildDailyPlan fills remaining plan slots with ready tasks that fit the chosen time', () => {
  const mediumShort = task({ id: 'medium-short', estimatedMinutes: 5, createdAt: 2 });
  const mediumFit = task({ id: 'medium-fit', estimatedMinutes: 15, createdAt: 3 });
  const mediumLong = task({ id: 'medium-long', estimatedMinutes: 25, createdAt: 1 });
  const lowFit = task({ id: 'low-fit', energy: 'low', estimatedMinutes: 5, createdAt: 4 });

  const result = buildDailyPlan(
    [mediumShort, mediumFit, mediumLong, lowFit],
    { selectedTaskIds: [], energy: 'medium', timeAvailable: 20, maxTasks: 5, now },
  );

  assert.deepEqual(result.taskIds, ['medium-short', 'medium-fit']);
  assert.equal(result.totalEstimatedMinutes, 20);
  assert.equal(result.usedEnergyFallback, false);
  assert.equal(result.usedTimeFallback, false);
});

test('buildDailyPlan has an honest time fallback when an empty plan has no fitting estimate', () => {
  const onlyLongTask = task({ id: 'only-long', estimatedMinutes: 25, createdAt: 2 });

  const result = buildDailyPlan(
    [onlyLongTask],
    { selectedTaskIds: [], energy: 'medium', timeAvailable: 5, maxTasks: 5, now },
  );

  assert.deepEqual(result.taskIds, ['only-long']);
  assert.equal(result.usedTimeFallback, true);
  assert.equal(result.totalEstimatedMinutes, 25);
});

test('buildDailyPlan counts existing plan estimates before adding more work', () => {
  const existing = task({ id: 'already-planned', estimatedMinutes: 15 });
  const fitsRemainingTime = task({ id: 'five-minute-task', estimatedMinutes: 5, createdAt: 2 });
  const wouldExceedBudget = task({ id: 'fifteen-minute-task', estimatedMinutes: 15, createdAt: 3 });

  const result = buildDailyPlan(
    [existing, fitsRemainingTime, wouldExceedBudget],
    { selectedTaskIds: ['already-planned'], energy: 'medium', timeAvailable: 25, maxTasks: 5, now },
  );

  assert.deepEqual(result.taskIds, ['five-minute-task']);
  assert.equal(result.totalEstimatedMinutes, 5);
  assert.equal(result.existingPlanUsesRemainingTime, false);
});

test('buildDailyPlan leaves an existing plan alone when no task fits the remaining time', () => {
  const existing = task({ id: 'already-planned', estimatedMinutes: 20 });
  const tooLong = task({ id: 'too-long', estimatedMinutes: 10, createdAt: 2 });

  const result = buildDailyPlan(
    [existing, tooLong],
    { selectedTaskIds: ['already-planned'], energy: 'medium', timeAvailable: 25, maxTasks: 5, now },
  );

  assert.deepEqual(result.taskIds, []);
  assert.equal(result.usedTimeFallback, false);
  assert.equal(result.existingPlanUsesRemainingTime, true);
});

test('getPlanRealityCheck reports a fit, an over-budget plan, and unknown estimates honestly', () => {
  const known = task({ id: 'known', estimatedMinutes: 15 });
  const anotherKnown = task({ id: 'another-known', estimatedMinutes: 20 });
  const unknown = task({ id: 'unknown', estimatedMinutes: null });

  assert.deepEqual(
    getPlanRealityCheck([known], ['known'], 25),
    { state: 'fits', plannedCount: 1, knownMinutes: 15, unknownEstimateCount: 0, timeAvailable: 25 },
  );
  assert.deepEqual(
    getPlanRealityCheck([known, anotherKnown], ['known', 'another-known'], 25),
    { state: 'over-budget', plannedCount: 2, knownMinutes: 35, unknownEstimateCount: 0, timeAvailable: 25 },
  );
  assert.deepEqual(
    getPlanRealityCheck([known, unknown], ['known', 'unknown'], 25),
    { state: 'unknown', plannedCount: 2, knownMinutes: 15, unknownEstimateCount: 1, timeAvailable: 25 },
  );
});

test('getWaitingFollowUps surfaces only active blocked tasks whose revisit date has arrived', () => {
  const due = task({ id: 'due', waitingOn: 'Teacher notes', waitingUntil: '2026-08-22' });
  const later = task({ id: 'later', waitingOn: 'Library book', waitingUntil: '2026-08-29' });
  const done = task({ id: 'done', done: true, waitingOn: 'Reply', waitingUntil: '2026-08-20' });

  assert.deepEqual(
    getWaitingFollowUps([later, done, due], { today: '2026-08-22' }).map((item) => item.id),
    ['due'],
  );
});

test('getResumableTasks puts ready handoffs first and leaves waiting or snoozed tasks alone', () => {
  const newest = task({ id: 'newest', handoff: 'Answer question 3', handoffAt: 30 });
  const older = task({ id: 'older', handoff: 'Open chapter 2', handoffAt: 20 });
  const waiting = task({ id: 'waiting', handoff: 'Ask for notes', handoffAt: 40, waitingOn: 'Friend' });
  const snoozed = task({ id: 'snoozed', handoff: 'Check examples', handoffAt: 50, snoozedUntil: now + 60_000 });

  assert.deepEqual(
    getResumableTasks([older, waiting, snoozed, newest], { now }).map((item) => item.id),
    ['newest', 'older'],
  );
});

test('getSuggestion prioritizes energy, estimate fit, and shorter estimate before fallback', () => {
  const lowQuick = task({ id: 'low-quick', energy: 'low', estimatedMinutes: 5, createdAt: 10 });
  const mediumLong = task({ id: 'med-long', energy: 'medium', estimatedMinutes: 25, createdAt: 5 });
  const mediumQuick = task({ id: 'med-quick', energy: 'medium', estimatedMinutes: 10, createdAt: 20 });

  const suggestion = getSuggestion([lowQuick, mediumLong, mediumQuick], {
    currentEnergy: 'medium',
    timeAvailable: 15,
    now,
  });

  assert.equal(suggestion.task.id, 'med-quick');
  assert.equal(suggestion.usedTimeFit, true);
  const reason = getSuggestionReason(suggestion, { currentEnergy: 'medium', timeAvailable: 15 });
  assert.ok(reason.includes('medium-energy'));
  assert.ok(reason.includes('15 minutes'));
});
