-- Live progress. When a run moves stage, the database publishes it on that
-- analysis's own channel and the page subscribes. Nothing polls.

-- The channel pattern, declared once: one private topic per analysis. The
-- browser builds the same name (lib/progress.ts), and the two must agree, or
-- the publish goes nowhere and the page simply never updates.
create function private.analysis_topic(analysis_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'analysis:' || analysis_id::text;
$$;

-- The reverse, for the policy. Null for any topic outside the pattern, and
-- null matches no analysis, so a malformed topic is refused rather than an
-- error.
create function private.analysis_id_from_topic(topic text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when topic ~ '^analysis:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then substr(topic, length('analysis:') + 1)::uuid
  end;
$$;

grant execute on function private.analysis_id_from_topic(text) to authenticated;

-- Who may subscribe is a policy, like who may read. A topic is receivable
-- only when it names an analysis in the organization on the token, so
-- another organization's progress is refused the same way its rows are.
create policy "Members receive their organization's analysis progress"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1
      from public.analyses
      where analyses.id = private.analysis_id_from_topic((select realtime.topic()))
        and analyses.organization_id = (select private.requesting_organization_id())
    )
  );

-- Publishes the stage and its message, not the row: the page has nothing to
-- filter and nothing to interpret. A failed run's message is why it failed.
-- Definer rights, because the pipeline's writer is what fires it and sending
-- belongs to the database, not to whoever made the update.
create function private.publish_analysis_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'status', new.status,
      'stage', new.stage,
      'message', coalesce(new.failure_reason, new.stage_message)
    ),
    'progress',
    private.analysis_topic(new.id),
    true
  );
  return null;
end;
$$;

-- On our own table. Only when something a subscriber shows has changed.
create trigger publish_analysis_progress
  after update on public.analyses
  for each row
  when (
    old.status is distinct from new.status
    or old.stage is distinct from new.stage
    or old.stage_message is distinct from new.stage_message
  )
  execute function private.publish_analysis_progress();
