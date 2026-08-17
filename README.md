# QueueClear

QueueClear is a local-first task tool that helps students turn a messy list into one clear next action.

## Live Demo

https://aaravkatiyar55-gif.github.io/queueclear/

## The Problem

When assignments, revision topics, chores, and ideas are all mixed together, choosing where to start can become its own obstacle. QueueClear keeps the full list, then makes one next step easier to see without turning the list into a noisy dashboard.

## How QueueClear Helps

- Capture a task quickly, then add energy, time, a first step, or a due date only when useful.
- Match a suggested task to the energy you have right now.
- See why a task was suggested instead of receiving a mystery recommendation.
- Snooze a task safely and wake it when it is relevant again.
- Start a short focus session for the suggested task.
- Filter, sort, edit, complete, delete, and undo recent queue changes.
- Keep data in the current browser instead of requiring an account.

## Features

- Fast task capture with duplicate and blank-title validation.
- Optional estimated time, first step, and due date.
- Energy-aware, explainable next-action selection.
- Predictable “Pick another” cycling and local snooze/wake controls.
- Focus sessions with 5, 10, 15, and 25 minute choices; pause, resume, restart, end, and refresh recovery.
- Queue sorting, state/energy filters, compact inline editing, and one recent undo action for complete, delete, or clear completed.
- Paper and calm themes, responsive layout, keyboard focus styles, and reduced-motion support.

## How the Suggested Next Action Works

QueueClear only compares unfinished tasks that are not currently snoozed. It gives priority to tasks due today or overdue, tasks matching the current energy setting, short tasks, tasks with a first step, and tasks that have been waiting longer. Ties use a stable created-time order. “Pick another” moves through that same order.

This is a small, visible rule set—not AI or a prediction system.

## Privacy

- Tasks, theme preference, current energy, and any running focus-session state are saved through this browser’s localStorage.
- No account is required.
- Clearing browser storage can remove saved tasks.
- Do not use QueueClear for sensitive information.

## Run Locally

1. Clone this repository.
2. Open `index.html` directly in a browser, or run any static server from the project folder.
3. No dependency install is needed.

For example, with Python available:

```bash
python -m http.server 4173
```

Then visit `http://127.0.0.1:4173/`.

## Testing

Manual checks cover:

- task capture, blank and duplicate validation, and browser refresh persistence;
- current-energy changes, suggestion explanations, pick-another, snooze, and wake-now;
- focus start, pause, resume, restart, end, document-title updates, and refresh recovery;
- sorting, all filter states, edit/save/cancel, complete/delete/clear completed, and undo;
- keyboard focus, disclosure controls, theme persistence, and 320px through desktop layouts;
- fresh GitHub Pages runtime checks with no browser console errors observed during verification.

## Deployment

The `main` branch is deployed with GitHub Pages at the live demo URL above.

## Screenshot

Screenshot will be added after final public runtime verification.

## AI Usage

OpenAI Codex assisted with implementation and testing guidance. The project’s feature claims, deployment checks, commits, and Stardance evidence must remain truthful.

## Limitations

- Data is browser-local only, with no sync between devices.
- Notifications are not implemented.
- QueueClear is not a medical or clinical productivity tool.
