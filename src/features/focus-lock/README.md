# features/focus-lock

Placeholder folder — nothing has been extracted here yet.

Focus Lock's actual logic is still inline in `blocks.html`, `timer.html`,
and `admin.html` (block/schedule creation, the countdown/gauge session UI,
per-subject Unlimited-mode timers, session-goal → Recall Curve logging —
see `endFocusSession()`/`commitFocusLockTopic()` in `timer.html`).

This folder exists now so the directory shape matches the target
`features/` layout (auth, tracker, focus-lock, groups, materials), but
extracting the real logic out of those three HTML files is a separate,
higher-risk pass — same "extract, verify, diff" discipline as
`groups.page.js` (see `docs/MODULARIZATION.md` → "What's still
monolithic"). Each of those three files needs to be checked for circular
coupling first, the way `groups.html` was, before deciding whether a
verbatim extraction or a real split is safe.
