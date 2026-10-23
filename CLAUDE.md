# CLAUDE.md

Chrome extension (Manifest V3) that downloads all photos from a TradeMe
residential property listing page to a user-chosen folder.

## Three Man Team
Available agents: Arch (ARCHITECT.md), Val (ARCHITECT-REVIEWER.md), Bob (BUILDER.md), Richard (REVIEWER.md)
Flow: Arch → Val (brief review loop) → Bob → Richard
Handoff files: written to `handoff/` directory (ARCHITECT-BRIEF.md, ARCHITECT-BRIEF-REVIEW-FEEDBACK.md, BUILD-LOG.md, REVIEW-REQUEST.md, REVIEW-FEEDBACK.md, QUALITY-CHECK.md, SESSION-CHECKPOINT.md)
On session start: always run `/start-three-man` before any other work.
Critical rule: All agents must run in foreground (never set run_in_background: true).
If not installed: https://github.com/mywave-agent-coe/mywave-claude-skills
