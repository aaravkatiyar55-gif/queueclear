# QueueClear

QueueClear is a small local-first task tool for students who get stuck choosing what to start.

## What problem it solves

Assignments, revision topics, chores, and ideas can pile up into one noisy list. The hard part is often choosing a realistic first task, not writing a bigger plan. QueueClear keeps the list safe while bringing one doable task forward.

## Features

- Quick task capture with a title and low, medium, or high energy level.
- Optional estimated time and first step, kept out of the way until needed.
- One explainable suggested task: matching energy first, then the shortest estimated task, then queue order.
- Snooze the current suggestion until tomorrow and wake it later from the queue.
- Mark tasks done or delete them.
- A small 10-minute focus timer with start, pause, resume, and reset controls.
- Paper and calm themes, visible keyboard focus, and a responsive layout.

## How it picks a task

QueueClear ignores completed and snoozed tasks. It first looks for a task matching the selected energy level. Within that group, a task with a shorter estimate comes first; when estimates are missing or tied, it keeps the original queue order. If no task matches the selected energy, it uses the same simple order across the remaining available tasks.

The “Why this task?” note shows the one reason that led to the suggestion. This is a visible rule, not AI or a prediction system.

## Privacy

Tasks, energy preference, and theme preference are saved only in this browser using localStorage. No account is required. Clearing browser storage can remove saved tasks, so do not use QueueClear for sensitive information.

## Run locally

Clone the repository and open `index.html` in a browser, or run any static server from the project folder. No dependencies need to be installed.

For example:

```bash
python -m http.server 4173
```

Then open `http://127.0.0.1:4173/`.

## Live demo

https://aaravkatiyar55-gif.github.io/queueclear/

## Testing

Manual checks performed during the latest simplification include:

- adding tasks, selecting energy, adding a first step, and refreshing to confirm task persistence;
- checking the suggested task after changing energy, then snoozing, waking, and marking it done;
- starting the 10-minute timer, pausing it, resuming it, resetting it, and confirming it resets after refresh;
- keyboard focus on the skip link and details disclosure;
- desktop layout checks and a fresh GitHub Pages page check with no browser console errors observed.

## Limitations

- Data stays in one browser; there is no account or device sync.
- The timer intentionally resets on refresh.
- There is no calendar connection or notification system.
- QueueClear is not a medical or clinical productivity tool.

## AI Usage

OpenAI Codex assisted with planning, implementation, debugging, and testing guidance. The app’s feature claims, tests, and project evidence are limited to what was actually verified.
