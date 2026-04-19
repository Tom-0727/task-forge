# scripts/ — Execution Layer (shell entries)

- `run-once.sh` — convenience wrapper around `one-shot.ts` for manual invocation.
- `cron.example` — Linux default scheduler path. Copy into the user's crontab and edit the target path.
- `install-systemd-timer.sh` — use only when the user explicitly wants systemd-based scheduling.
- Keep shell wrappers thin: set cwd, invoke the compiled JS entry, and let TypeScript code own runtime behavior.
- Do not add scheduler-specific business logic here. Scheduler paths must invoke the same one-shot entry contract.
