export function isReadyTask(task, now = Date.now()) {
  return Boolean(
    task
      && !task.done
      && !task.waitingOn
      && !(typeof task.snoozedUntil === 'number' && task.snoozedUntil > now),
  );
}

export function comparePlanCandidates(first, second) {
  const firstEstimate = typeof first.estimatedMinutes === 'number' ? first.estimatedMinutes : Infinity;
  const secondEstimate = typeof second.estimatedMinutes === 'number' ? second.estimatedMinutes : Infinity;

  if (firstEstimate !== secondEstimate) {
    return firstEstimate - secondEstimate;
  }

  return first.createdAt - second.createdAt;
}

export function compareByEstimateThenQueueOrder(first, second) {
  const firstEstimate = first.estimatedMinutes;
  const secondEstimate = second.estimatedMinutes;

  if (firstEstimate !== null && secondEstimate !== null && firstEstimate !== secondEstimate) {
    return firstEstimate - secondEstimate;
  }

  if (firstEstimate !== null && secondEstimate === null) {
    return -1;
  }

  if (firstEstimate === null && secondEstimate !== null) {
    return 1;
  }

  return first.createdAt - second.createdAt;
}

export function formatEnergy(energy) {
  if (!energy) return '';
  return energy.charAt(0).toUpperCase() + energy.slice(1) + ' energy';
}

export function formatSubject(subject) {
  if (!subject) return 'General';
  return subject === 'social-science'
    ? 'Social science'
    : subject.charAt(0).toUpperCase() + subject.slice(1);
}

export function formatPriority(priority) {
  if (!priority) return 'Normal';
  return priority === 'soon' ? 'Needs attention soon' : priority.charAt(0).toUpperCase() + priority.slice(1);
}

export function formatEstimate(minutes, longForm = false) {
  if (!minutes) {
    return '';
  }
  return longForm ? 'About ' + minutes + ' minutes' : minutes + ' min';
}

export function formatAvailableTime(minutes) {
  return minutes + ' minutes';
}

export function getTieBreakReason(task, candidates) {
  if (candidates.length === 1) {
    return 'It is the only task ready right now.';
  }

  if (task.estimatedMinutes !== null) {
    const sameEstimate = candidates.filter(
      (candidate) => candidate.estimatedMinutes === task.estimatedMinutes,
    );
    const hasLongerEstimate = candidates.some(
      (candidate) =>
        candidate.estimatedMinutes === null || candidate.estimatedMinutes > task.estimatedMinutes,
    );

    if (hasLongerEstimate && sameEstimate.length === 1) {
      return 'It has the shortest available estimate.';
    }

    if (hasLongerEstimate) {
      return 'It is tied for the shortest estimate and was added first.';
    }
  }

  return 'The remaining choices are tied, so QueueClear kept the task added first.';
}

export function getSuggestionReason(
  suggestion,
  { currentEnergy = 'medium', timeAvailable = null, suggestionOffset = 0 } = {},
) {
  const {
    task,
    candidates,
    energyFilteredChoices,
    usedEnergyFallback,
    usedTimeFit,
    usedTimeFallback,
  } = suggestion;
  const reasons = [];

  if (energyFilteredChoices) {
    reasons.push('It matches your ' + currentEnergy + '-energy setting.');
  }

  if (usedEnergyFallback) {
    reasons.push('No task matches your ' + currentEnergy + '-energy setting.');
  }

  if (usedTimeFit) {
    reasons.push('It fits the ' + formatAvailableTime(timeAvailable) + ' you have.');
  }

  if (usedTimeFallback) {
    reasons.push(
      'No estimated task fits the ' + formatAvailableTime(timeAvailable) + ' you have, so this is the closest ready option.',
    );
  }

  if (suggestionOffset > 0 && candidates.length > 1) {
    reasons.push('You chose another task from the same ready choices.');
    return reasons.join(' ');
  }

  if (candidates.length > 1 || reasons.length === 0 || usedEnergyFallback || usedTimeFallback) {
    reasons.push(getTieBreakReason(task, candidates));
  }

  return reasons.join(' ');
}

export function getSuggestion(
  tasks,
  { currentEnergy = 'medium', timeAvailable = null, suggestionOffset = 0, now = Date.now() } = {},
) {
  const savedTasks = Array.isArray(tasks) ? tasks : [];
  const available = savedTasks.filter((task) => isReadyTask(task, now));
  const matchesEnergy = available.filter((task) => task.energy === currentEnergy);
  const energyCandidates = matchesEnergy.length > 0 ? matchesEnergy : available;
  const timeMatches = timeAvailable !== null
    ? energyCandidates.filter(
        (task) => task.estimatedMinutes !== null && task.estimatedMinutes <= timeAvailable,
      )
    : [];
  const candidates = timeMatches.length > 0 ? timeMatches : energyCandidates;

  const orderedCandidates = candidates.slice().sort(compareByEstimateThenQueueOrder);
  const selectedIndex = orderedCandidates.length === 0 ? 0 : suggestionOffset % orderedCandidates.length;

  return {
    task: orderedCandidates[selectedIndex] || null,
    available,
    candidates: orderedCandidates,
    energyFilteredChoices: matchesEnergy.length > 0 && matchesEnergy.length < available.length,
    usedEnergyFallback: matchesEnergy.length === 0 && available.length > 0,
    usedTimeFit: timeMatches.length > 0,
    usedTimeFallback: timeAvailable !== null && timeMatches.length === 0 && available.length > 0,
  };
}

export function buildDailyPlan(
  tasks,
  { selectedTaskIds = [], energy, timeAvailable, maxTasks = 5, now = Date.now() } = {},
) {
  const selected = Array.isArray(selectedTaskIds) ? [...new Set(selectedTaskIds)] : [];
  const savedTasks = Array.isArray(tasks) ? tasks : [];
  const selectedEstimatedMinutes = savedTasks
    .filter((task) => selected.includes(task.id) && typeof task.estimatedMinutes === 'number')
    .reduce((total, task) => total + task.estimatedMinutes, 0);
  const remainingSlots = Math.max(0, maxTasks - selected.length);
  const readyTasks = savedTasks
    .filter((task) => isReadyTask(task, now) && !selected.includes(task.id));
  const energyMatches = readyTasks.filter((task) => task.energy === energy);
  const candidates = (energyMatches.length > 0 ? energyMatches : readyTasks)
    .slice()
    .sort(comparePlanCandidates);
  const planned = [];
  let remainingMinutes = Number.isFinite(timeAvailable)
    ? Math.max(0, timeAvailable - selectedEstimatedMinutes)
    : null;

  candidates.forEach((task) => {
    if (planned.length >= remainingSlots) {
      return;
    }

    if (remainingMinutes === null) {
      planned.push(task);
      return;
    }

    if (typeof task.estimatedMinutes === 'number' && task.estimatedMinutes <= remainingMinutes) {
      planned.push(task);
      remainingMinutes -= task.estimatedMinutes;
    }
  });

  const usedTimeFallback = planned.length === 0
    && candidates.length > 0
    && remainingMinutes !== null
    && selected.length === 0;
  if (usedTimeFallback && remainingSlots > 0) {
    planned.push(candidates[0]);
  }

  return {
    taskIds: planned.map((task) => task.id),
    totalEstimatedMinutes: planned.reduce(
      (total, task) => total + (typeof task.estimatedMinutes === 'number' ? task.estimatedMinutes : 0),
      0,
    ),
    usedEnergyFallback: energyMatches.length === 0 && readyTasks.length > 0,
    usedTimeFallback,
    existingPlanUsesRemainingTime: planned.length === 0
      && candidates.length > 0
      && remainingMinutes !== null
      && selected.length > 0,
  };
}

export function getPlanRealityCheck(tasks, selectedTaskIds, timeAvailable) {
  const selected = Array.isArray(selectedTaskIds) ? [...new Set(selectedTaskIds)] : [];
  const selectedTasks = (Array.isArray(tasks) ? tasks : [])
    .filter((task) => selected.includes(task.id));
  const knownMinutes = selectedTasks.reduce(
    (total, task) => total + (typeof task.estimatedMinutes === 'number' ? task.estimatedMinutes : 0),
    0,
  );
  const unknownEstimateCount = selectedTasks.filter((task) => task.estimatedMinutes === null).length;
  const hasTimeBudget = Number.isFinite(timeAvailable);

  return {
    state: selected.length === 0
      ? 'empty'
      : !hasTimeBudget
        ? 'set-time'
        : unknownEstimateCount > 0
          ? 'unknown'
          : knownMinutes > timeAvailable
            ? 'over-budget'
            : 'fits',
    plannedCount: selectedTasks.length,
    knownMinutes,
    unknownEstimateCount,
    timeAvailable: hasTimeBudget ? timeAvailable : null,
  };
}

export function getWaitingFollowUps(tasks, { today } = {}) {
  if (typeof today !== 'string') {
    return [];
  }

  return (Array.isArray(tasks) ? tasks : [])
    .filter(
      (task) =>
        task
        && !task.done
        && Boolean(task.waitingOn)
        && typeof task.waitingUntil === 'string'
        && task.waitingUntil <= today,
    )
    .slice()
    .sort(
      (first, second) =>
        first.waitingUntil.localeCompare(second.waitingUntil) || first.createdAt - second.createdAt,
    );
}

export function getResumableTasks(tasks, { now = Date.now() } = {}) {
  return (Array.isArray(tasks) ? tasks : [])
    .filter((task) => isReadyTask(task, now) && typeof task.handoff === 'string' && task.handoff.length > 0)
    .slice()
    .sort((first, second) => (second.handoffAt || 0) - (first.handoffAt || 0));
}
