# QueueClear

QueueClear is a local-first task tool that helps students turn a messy list into one clear next action.

## The problem

Assignments, revision topics, chores, and ideas can pile up into one noisy list. Often the difficult part is not doing a task; it is deciding which realistic task to begin. That task-start friction can make a short list feel heavier than it needs to.

## How QueueClear helps

- Capture a task quickly with the energy it needs.
- Add an estimate or a small first step only when it helps.
- Choose the time available before deciding what fits right now.
- Keep the useful context visible when choosing what to start.
- Show one suggested task with a plain-language explanation of the rule used.
- Snooze a task until tomorrow without losing it, then wake it early if plans change.
- Start a small focus session connected to the selected task.
- Download a local JSON backup when a browser-only copy is not enough.
- Keep the rest of the queue available without turning it into a dashboard.

## How the suggested task works

QueueClear follows a small visible rule:

1. Completed and currently snoozed tasks are left out.
2. Tasks matching the selected energy come first.
3. When a time limit is selected, an estimated task that fits that time is preferred.
4. A shorter estimate comes first when the choices are otherwise similar.
5. If details still tie, the task added first stays first.

Tasks without estimates remain available. If nothing fits the selected time, QueueClear says that it used a fallback instead of pretending the task fits.

The “Why this task?” note names the part of that rule that decided the current suggestion. This is a visible local rule, not AI or a prediction system.

## Features

- Quick task capture with low, medium, or high energy.
- Optional estimated time and first step, saved with each task.
- Compact task context in the queue and clearer context in Start here.
- Explainable next-task selection with saved energy and time-available preferences.
- Snooze until tomorrow and Wake now controls.
- Mark done and delete actions.
- A 10-minute focus timer with Start, Pause, Resume, and Reset controls.
- The focus timer names the task it is currently for.
- A local JSON backup download containing QueueClear tasks and preferences only.
- Paper and calm themes, visible keyboard focus, reduced-motion support, and responsive layouts.

## Privacy

QueueClear saves tasks, energy and time preferences, and the theme preference in this browser through localStorage. No account is required and no data is synced between devices. Clearing browser storage can remove saved tasks. A downloaded backup is optional and stays a normal local file; it is not cloud sync. Do not use QueueClear for sensitive information.

## Run locally

Clone the repository and open `index.html` in a browser, or run a static server from the project folder. No dependencies need to be installed.

```bash
python -m http.server 4173
```

Then open `http://127.0.0.1:4173/`.

## Live demo

https://aaravkatiyar55-gif.github.io/queueclear/

## Technology

Plain HTML, CSS, and JavaScript. There are no packages, accounts, databases, or backend services.

## Testing

Manual checks completed for the current app include:

- blank-title and duplicate-active-task validation;
- creating tasks with and without an estimate or first step;
- task, context, energy, and theme persistence after refresh;
- time-available persistence and explanations for matching energy, fitting estimates, sensible time fallbacks, and queue ties;
- empty-queue and all-snoozed states;
- snooze, wake, mark-done, completed-title reuse, and delete behavior;
- timer start, pause, resume, reset, and refresh reset behavior;
- backup-download status after the local JSON action;
- keyboard focus on the skip link and keyboard use of the context disclosure;
- 320px, 360px, 768px, and 1280px checks with no horizontal page overflow.

## Limitations

- Data stays in one browser; there is no account or device sync.
- This version can export a backup but cannot import one.
- The timer intentionally resets after a browser refresh.
- There are no notifications, calendar connections, or cloud backups.
- QueueClear is not a medical or clinical productivity tool.

## AI usage

OpenAI Codex assisted with implementation and testing guidance. The project’s feature claims, commits, deployment checks, tracker time, and Stardance evidence must remain truthful.
