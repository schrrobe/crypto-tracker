# Production process declaration (Heroku / Render / Railway / Foreman style).
# When REDIS_URL is set, the worker process is REQUIRED — without it, queued
# sync jobs never run (runs sit RUNNING until the reaper marks them STALE).
# Without REDIS_URL the API runs sync inline and the worker process is unused.
release: pnpm --filter @crypto-tracker/api db:deploy
web: pnpm --filter @crypto-tracker/api start
worker: pnpm --filter @crypto-tracker/api start:worker
