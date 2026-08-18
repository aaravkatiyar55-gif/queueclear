# QueueClear

QueueClear is a local-first task-start tool for students. It helps decide what is realistic now,
parks work that cannot be started yet, and leaves a useful note for coming back after a study break.

## The problem

Assignments, revision topics, chores, and ideas can pile up into one noisy list. Often the difficult
part is not doing a task; it is deciding which realistic task to begin. A task might also be blocked
by missing notes or another person, or become hard to resume after an interruption. QueueClear is
designed around those three moments rather than around maintaining a long task list.

## How QueueClear helps

### 1. Choose one realistic start

Capture a task with the energy it needs, an optional estimate, and an optional first step. QueueClear
uses the energy and time available right now to offer one explainable starting point rather than a
ranked productivity dashboard.

### 2. Move blocked work out of the decision queue

When a task cannot be started because something is missing, write what it is waiting on and move it to
the Waiting state. It remains visible, but it no longer competes with tasks that are ready. A **Make
ready** button returns it when the blocker is gone.

### 3. Leave a handoff after a focus break

The small focus timer stays connected to the selected task. When a session is paused or finished,
QueueClear asks for the next tiny step. That handoff is saved with the task and shown the next time it
is suggested, so a break does not mean deciding from scratch again.

Supporting controls include snoozing until tomorrow, marking tasks done, a one-step delete undo, and
local JSON backup/restore.

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
- A Waiting state for tasks blocked by a missing person, material, or decision, with a Make ready path.
- Snooze until tomorrow and Wake now controls.
- Mark done and delete actions, with an Undo path for the most recent deletion until refresh.
- A 10-minute focus timer with Start, Pause, Resume, and Reset controls.
- The focus timer names the task it is currently for.
- A saved session handoff that records the next tiny step after a pause or completed focus session.
- Local JSON backup download and restore for QueueClear tasks and supported preferences.
- Paper and calm themes, visible keyboard focus, reduced-motion support, and responsive layouts.

## Back up and restore

QueueClear data stays in the current browser. To keep a copy, choose **Download backup** in the Your data section and save the JSON file somewhere you can find later.

To restore it, choose **Restore backup**, select that JSON file, and check the preview. QueueClear shows the recoverable task count and whether the saved theme, energy, and available-time preferences are included. Choose **Replace current data** only if you want to continue.

Restore replaces current QueueClear data in that browser. It does not upload the file or sync data to another device. Malformed JSON files and backups with an unsupported QueueClear structure are rejected before any current data changes.

## Privacy

QueueClear saves tasks, energy and time preferences, and the theme preference in this browser through localStorage. No account is required and no data is synced between devices. Clearing browser storage can remove saved tasks. A downloaded backup is optional and stays a normal local file; restore reads that file only in this browser. Do not use QueueClear for sensitive information.

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

Checks completed for the current app include:

- blank-title and duplicate-active-task validation;
- creating tasks with and without an estimate or first step;
- task, context, energy, and theme persistence after refresh;
- time-available persistence and explanations for matching energy, fitting estimates, sensible time fallbacks, and queue ties;
- empty-queue and all-snoozed states;
- snooze, wake, mark-done, completed-title reuse, and delete behavior;
- moving a blocked task to Waiting and making it ready again;
- timer start, pause, resume, reset, and refresh reset behavior;
- saving a focus-session handoff and showing it again after a refresh;
- backup-download status after the local JSON action;
- backup preview, invalid-backup rejection, cancellation, and confirmed local restore;
- delete and undo-delete behavior, including restoring the task to its earlier list position;
- keyboard focus on the skip link and keyboard use of the context disclosure;
- 320px, 360px, 768px, and 1280px checks with no horizontal page overflow.

## Limitations

- Data stays in one browser; there is no account or device sync.
- Restore replaces current QueueClear data in one browser; it is not cloud or device sync.
- Undo only remembers the most recently deleted task and resets after a browser refresh.
- The timer intentionally resets after a browser refresh.
- There are no notifications, calendar connections, or cloud backups.
- QueueClear is not a medical or clinical productivity tool.

## AI usage

OpenAI Codex assisted with implementation and testing guidance. The project’s feature claims, commits, deployment checks, tracker time, and Stardance evidence must remain truthful.
