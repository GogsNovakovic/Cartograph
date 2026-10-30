-- The first model calls: a cache for everything a model writes, a stage for
-- the roles a model suggests during a run, and where a run says why it
-- couldn't suggest any.

-- Never written: it predates knowing how explanations are keyed. An
-- explanation belongs to the content it was written from, not to one
-- analysis's file row, so a re-run of an unchanged file finds it again.
drop table public.explanations;

-- Everything a model has answered, keyed on a hash of everything it was
-- handed: the task, the pinned model, the prompt and the input. Re-pinning a
-- model or editing a prompt changes the key, so it invalidates only its own
-- rows. Per organization, like every other row.
--
-- Written by the server with the secret key, like the pipeline's rows;
-- read through the policy.
create table public.model_cache (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  key text not null check (key ~ '^[0-9a-f]{64}$'),
  task text not null check (task in ('explain-file', 'explain-folder', 'classify')),
  model text not null,
  -- The answer as the task reads it back; its shape is checked there.
  output jsonb not null,
  created_at timestamptz not null default now(),
  -- Also the policy's index: organization first.
  unique (organization_id, key)
);

grant select on public.model_cache to authenticated;

create policy "Members read their organization's model cache"
  on public.model_cache for select to authenticated
  using (organization_id = (select private.requesting_organization_id()));

-- Suggesting roles runs after the result is stored, while the source is
-- still on disk.
alter type public.analysis_stage add value 'classifying' after 'storing';

-- Why no roles were suggested, when the run couldn't ask. The map is
-- complete without them, so this doesn't fail the run, but it is never
-- silent either. Null when classification ran.
alter table public.analyses
  add column classification_failure text,
  add constraint analyses_classification_failure_when_complete check (
    classification_failure is null or status = 'complete'
  );
