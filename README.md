# QueueClear

> A local-first study desk notebook that helps you pick one realistic task to start, park blocked work safely, and pick up right where you paused.

**Live Demo:** [https://aaravkatiyar55-gif.github.io/queueclear/](https://aaravkatiyar55-gif.github.io/queueclear/)

---

## Why I Built QueueClear

When schoolwork, revision sheets, project deadlines, and chores pile up, the hardest part is rarely doing the work itself—it is the decision paralysis of staring at a massive, overwhelming to-do list and not knowing where to begin.

Most task managers encourage collecting endless backlogs that create guilt rather than clarity. I built **QueueClear** as a focused, register-style study tool designed around three specific friction points where study sessions usually get stuck:

1. **Choosing what to start right now** based on how much energy and time you actually have, rather than sorting an endless priority list.
2. **Parking blocked homework** (like waiting for teacher notes or a classmate's reply) so it stops cluttering your focus until you can actually act on it.
3. **Resuming after an interruption** by saving a tiny 1-sentence handoff note when pausing a study timer, eliminating the friction of figuring out "where was I?" when returning to your desk.

---

## Actual Daily Study Workflow

Here is how QueueClear is used during an everyday study routine:

```
[ Quick Capture ] ──> [ Check Energy & Time ] ──> [ Start Here / Plan Today ]
                                                             │
                              ┌──────────────────────────────┴──────────────────────────────┐
                              ▼                                                             ▼
                    [ 10-Min Focus Timer ]                                       [ Waiting Room ]
                              │                                                             │
                              ▼                                                             ▼
                   (Pause / Save Handoff)                                        (Set Revisit Date)
                              │                                                             │
                              ▼                                                             ▼
                   [ Resume After Break ]                                        [ Follow-up When Ready ]
```

1. **Quick Capture**: Enter a task with its required energy (*Low, Medium, High*), an optional time estimate (*5 to 60 mins*), and a small first step (*e.g., "Open textbook to page 42"*).
2. **Select Current Energy & Free Time**: QueueClear looks at what is ready and suggests a matching task, explaining plainly *why* it picked it.
3. **Build Today’s Plan**: If you want a small structured session, click **Build a plan from my ready tasks**. It fills up to 5 slots that fit your time budget without overwriting your manual choices. The **Plan reality check** then says whether the edited plan still fits, is over budget, or cannot be estimated honestly yet.
4. **Start Focus**: Hit start on the focus timer (default 10 mins). If you need to step away or pause, click **Pause** and write a 1-sentence handoff note.
5. **Park Blockers**: If you get stuck waiting on someone, type what you're waiting for and set a revisit date (*Tomorrow* or *Next week*). The task leaves your ready queue and surfaces only when that date arrives.

---

## Working Features

* **Study Notebook Aesthetic**: A technical graph-notebook look with subtle quad-rule grid lines, slate-indigo margin rules, register index tabs, and tactile pencil strikethroughs—without heavy web fonts or distracting decorative widgets.
* **Start Here Recommendation**: Clear, explainable next-task selection matching your selected energy and time available.
* **Explainable Logic ("Why this task?")**: Transparent local rule (energy match → time fit → shortest estimate → queue order). No black-box AI predictions.
* **Today’s Plan Builder**: Fills remaining slots (up to 5 tasks) using available time budget, supports manual up/down reordering, and displays total estimated study time.
* **Plan Reality Check**: Makes an over-budget or partly unestimated Today plan visible before the study session starts; it never changes a task automatically.
* **Waiting Room with Revisit Dates**: Parks blocked tasks with reminder targets (*Tomorrow* or *Next week*) and displays local follow-up alerts when due.
* **Focus Timer with Handoff Notes**: Built-in 5, 10, 15, or 25-minute timer that stays tied to the selected task, with a dedicated **Resume after a break** panel.
* **Queue Organization & Search**: Search by text, filter by status (*Ready, Waiting, Snoozed, Completed, Due today, Energy, Important*), and sort by suggested, newest, oldest, shortest, or due-soon.
* **Inline Task Editing & Checklists**: Edit task metadata directly in the queue and break complex tasks into small checkbox steps.
* **Weekly Recurrence**: Weekly repeating tasks generate their next occurrence on completion.
* **One-Step Undo**: Undo accidental deletes, task completions, or clear-completed actions, restoring tasks back to their previous list and Today-plan positions.
* **Study Routines**: Save reusable step sequences (*e.g., "Maths Revision Routine"*) and push their steps into your queue with one click.
* **Personalized Settings**: Custom workspace label, personal reminder note, and preferred focus length saved locally.
* **Dual Themes**: Classic Warm Paper and Calm Slate themes with high-contrast 3px focus rings and `prefers-reduced-motion` support.

---

## Privacy & Local Storage

* **100% Browser-Local**: All tasks, settings, routines, and history are stored exclusively in your browser's `localStorage`.
* **Zero Telemetry or Accounts**: No tracking scripts, no external analytics, no user accounts, and no cookies.
* **Offline Ready**: Operates completely offline with zero network requests once loaded.

---

## Backup & Safe Restore

Because data is saved only in your current browser, clearing browser cache or changing computers will remove local tasks.

* **Download Backup**: Exports a clean, readable JSON backup file containing your tasks, preferences, routines, and history.
* **Restore Backup Preview**: Preview the contents before restoring. You can choose:
  * **Replace current data**: Cleanly replaces current browser state with the backup.
  * **Add selected items safely**: Selectively imports tasks while preserving your existing queue and skipping duplicate active titles.
* **Validation Safety**: Malformed or corrupt JSON files are safely rejected before any local data is altered.

---

## Local Setup

QueueClear is built with standard HTML5, CSS3, and ES Modules. There are no npm packages, compilation steps, or backend dependencies.

### Running with a static server:
```bash
# Navigate to the project directory
cd queueclear

# Start a local static server
python -m http.server 4173
```
Then open `http://127.0.0.1:4173/` in your browser.

---

## Test Suite & Verification

The project includes 29 repeatable Node.js unit tests (29/29 passing) covering all data models, storage operations, backup validation, plan reality checks, and decision workflows:

```bash
# Run the complete test suite
node --test tests/*.test.mjs

# Run syntax check across all JavaScript files
node --check script.js
node --check queueclear-model.mjs
node --check queueclear-storage.mjs
node --check queueclear-recovery.mjs
node --check queueclear-today-plan.mjs
node --check queueclear-major-workflows.mjs
node --check queueclear-timer-history.mjs
```

### Node test coverage:
- Energy filtering, time-budget calculation, and fallback reasoning.
- Waiting follow-up date triggering and resumable handoff ordering.
- JSON Backup Schema version 1 & 2 parsing, corrupt data rejection, and duplicate ID prevention.
- Today plan re-insertion after undo without overfilling 5-task limit.

### Manual browser checks before a release:
- Blank-title and duplicate active-task validation.
- Task capture, editing, completion, deletion, undo, and refresh persistence.
- Backup preview, invalid-file rejection, cancellation, and selected recovery.
- Keyboard navigation and responsive layout at **320px, 375px, 768px, 1024px, and 1440px** without horizontal overflow.

---

## Honest Limitations

- **Single Browser Only**: Data stays in one browser profile; there is no automatic background sync across phones or laptops.
- **Timer Resets on Page Refresh**: The focus countdown timer intentionally resets if the page is reloaded.
- **Single-Step Undo**: Undo remembers only the most recent delete or completion action in the active session.
- **Not Clinical or Medical Software**: QueueClear is a personal study helper, not a clinical therapy or medical ADHD treatment tool.

---

## Assistance Statement

AI coding assistants (OpenAI Codex / Google DeepMind Antigravity) were used for implementation guidance, modular architecture refactoring, and test suite generation. The source and test suite in this repository are the reference for current behavior; run the checks above and the main browser flows before each release.
