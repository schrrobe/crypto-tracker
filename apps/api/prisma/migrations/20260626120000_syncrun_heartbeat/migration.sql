-- SyncRun liveness lease: executors claim a run by setting heartbeatAt and bump it
-- while working. A fresh heartbeat blocks a second start; a stale/null one means the
-- previous executor crashed or has not claimed the run yet.
ALTER TABLE "SyncRun" ADD COLUMN "heartbeatAt" TIMESTAMP(3);
