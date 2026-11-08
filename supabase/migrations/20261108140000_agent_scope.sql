-- The agent's credential names one analysis. It is a token like a member's,
-- carrying the organization the same way, plus `analysis_id`; these
-- restrictive policies narrow every read it makes to that analysis. A
-- member's token carries no `analysis_id` and reads exactly as before.
--
-- Restrictive, so they are ANDed with the organization policies rather than
-- added to them: the credential can only ever see less than a member.

-- Null for every token but an agent credential.
create function private.requesting_analysis_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'analysis_id', '')::uuid;
$$;

grant execute on function private.requesting_analysis_id() to authenticated;

create policy "An agent credential reads only its analysis"
  on public.analyses as restrictive for select to authenticated
  using (
    (select private.requesting_analysis_id()) is null
    or id = (select private.requesting_analysis_id())
  );

create policy "An agent credential reads only its analysis's project"
  on public.projects as restrictive for select to authenticated
  using (
    (select private.requesting_analysis_id()) is null
    or id = (
      select project_id from public.analyses where analyses.id = (select private.requesting_analysis_id())
    )
  );

create policy "An agent credential reads only its analysis's files"
  on public.files as restrictive for select to authenticated
  using (
    (select private.requesting_analysis_id()) is null
    or analysis_id = (select private.requesting_analysis_id())
  );

create policy "An agent credential reads only its analysis's edges"
  on public.edges as restrictive for select to authenticated
  using (
    (select private.requesting_analysis_id()) is null
    or analysis_id = (select private.requesting_analysis_id())
  );

create policy "An agent credential reads only its analysis's file roles"
  on public.file_roles as restrictive for select to authenticated
  using (
    (select private.requesting_analysis_id()) is null
    or analysis_id = (select private.requesting_analysis_id())
  );

create policy "An agent credential reads only its analysis's routes"
  on public.routes as restrictive for select to authenticated
  using (
    (select private.requesting_analysis_id()) is null
    or analysis_id = (select private.requesting_analysis_id())
  );

create policy "An agent credential reads only its analysis's insights"
  on public.insights as restrictive for select to authenticated
  using (
    (select private.requesting_analysis_id()) is null
    or analysis_id = (select private.requesting_analysis_id())
  );

-- Model answers are keyed by content, not by analysis, and no lookup needs
-- them: an agent credential reads none.
create policy "An agent credential reads no model cache"
  on public.model_cache as restrictive for select to authenticated
  using ((select private.requesting_analysis_id()) is null);
