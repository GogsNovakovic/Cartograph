-- When a run last reported in. Staleness was measured from started_at, which
-- nothing moves during a run, so a live run past five minutes read as
-- abandoned and could be claimed a second time. A run touches this on every
-- write it makes to its row and after each batch of model calls.

alter table public.analyses
  add column heartbeat_at timestamptz;

-- A run that has started has reported in at least when it started.
update public.analyses set heartbeat_at = started_at where started_at is not null;

alter table public.analyses
  add constraint analyses_heartbeat_unless_queued check ((heartbeat_at is not null) = (status <> 'queued'));
