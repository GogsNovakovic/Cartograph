-- The first schema. Every row belongs to an organization, and who may read a
-- row is decided here, by policy, never by the application.

-- Not exposed through the Data API: helpers policies call, not endpoints.
create schema private;
grant usage on schema private to authenticated;

-- Row-level security is on by default rather than per table. A table someone
-- forgot to enable it on returns every row silently; a table with it on and no
-- policy returns nothing, which is visible. This makes the first case
-- impossible for anything created in public from here on, including the
-- tables below.
create function private.enable_rls_on_new_tables()
returns event_trigger
language plpgsql
set search_path = ''
as $$
declare
  command record;
begin
  for command in
    select object_identity
    from pg_event_trigger_ddl_commands()
    where object_type = 'table' and schema_name = 'public'
  loop
    execute format('alter table %s enable row level security', command.object_identity);
  end loop;
end;
$$;

create event trigger enable_rls_on_new_tables
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function private.enable_rls_on_new_tables();

-- The one place a policy learns which organization is asking. Clerk's v2
-- session token carries the active organization as `o.id`. Null when the
-- session has no organization, and null matches no row.
create function private.requesting_organization_id()
returns text
language sql
stable
set search_path = ''
as $$
  select auth.jwt() -> 'o' ->> 'id';
$$;

grant execute on function private.requesting_organization_id() to authenticated;

-- Organizations live in Clerk. This table exists so every other row can hold
-- a real foreign key to one, and deleting it removes everything it owns.
create table public.organizations (
  id text primary key, -- Clerk organization ID
  name text not null,
  created_at timestamptz not null default now()
);

-- A repository, as one organization knows it. Mapped once per team.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  owner text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, owner, name),
  -- Target for children's composite keys, so a child can't name a parent in
  -- another organization.
  unique (id, organization_id)
);

create type public.analysis_status as enum ('queued', 'parsing', 'complete', 'failed');

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  project_id uuid not null,
  status public.analysis_status not null default 'queued',
  -- A failed analysis always says why, and only a failed one has a reason.
  failure_reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade,
  check ((status = 'failed') = (failure_reason is not null)),
  check ((status in ('complete', 'failed')) = (completed_at is not null)),
  unique (id, organization_id)
);

-- Every file the parser saw, including the ones it couldn't parse, so
-- coverage is a count rather than a guess.
create table public.files (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  path text not null,
  -- Null means parsed.
  skip_reason text,
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade,
  unique (analysis_id, path),
  -- Target for edges and per-file rows, so both ends stay in one analysis.
  unique (id, analysis_id, organization_id)
);

create type public.edge_kind as enum ('import', 're_export', 'dynamic_import', 'require');

-- An edge exists only because the parser resolved a real import to a real
-- file, so both ends are required. Unresolved imports are not edges.
create table public.edges (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  source_file_id uuid not null,
  target_file_id uuid not null,
  kind public.edge_kind not null,
  -- The import as written, so an edge can always be traced back to its line.
  specifier text not null,
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade,
  foreign key (source_file_id, analysis_id, organization_id)
    references public.files (id, analysis_id, organization_id) on delete cascade,
  foreign key (target_file_id, analysis_id, organization_id)
    references public.files (id, analysis_id, organization_id) on delete cascade
);

-- Both method and full path, or no row. An approximate route is the same
-- failure as an invented edge.
create table public.routes (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid not null,
  method text not null,
  path text not null,
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade,
  foreign key (file_id, analysis_id, organization_id)
    references public.files (id, analysis_id, organization_id) on delete cascade
);

create table public.explanations (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid not null,
  body text not null,
  model text not null,
  created_at timestamptz not null default now(),
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade,
  foreign key (file_id, analysis_id, organization_id)
    references public.files (id, analysis_id, organization_id) on delete cascade
);

-- Who assigned a role is kept, so a label from convention is never mistaken
-- for one a model suggested.
create type public.file_role_source as enum ('convention', 'model');

create table public.file_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid not null unique,
  role text not null,
  source public.file_role_source not null,
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade,
  foreign key (file_id, analysis_id, organization_id)
    references public.files (id, analysis_id, organization_id) on delete cascade
);

-- Ownership only. What an insight holds is decided by the phase that writes
-- one, not guessed at here.
create table public.insights (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (analysis_id, organization_id)
    references public.analyses (id, organization_id) on delete cascade
);

-- Every policy column is indexed, and so is every foreign key a cascade or a
-- join walks. Leading columns of the unique constraints above already cover
-- organizations.id, projects (organization_id), files (analysis_id) and
-- file_roles (file_id).
create index analyses_organization_id_created_at_idx on public.analyses (organization_id, created_at desc);
create index analyses_project_id_idx on public.analyses (project_id);
create index files_organization_id_idx on public.files (organization_id);
create index edges_organization_id_idx on public.edges (organization_id);
create index edges_analysis_id_idx on public.edges (analysis_id);
create index edges_source_file_id_idx on public.edges (source_file_id);
create index edges_target_file_id_idx on public.edges (target_file_id);
create index routes_organization_id_idx on public.routes (organization_id);
create index routes_analysis_id_idx on public.routes (analysis_id);
create index routes_file_id_idx on public.routes (file_id);
create index explanations_organization_id_idx on public.explanations (organization_id);
create index explanations_analysis_id_idx on public.explanations (analysis_id);
create index explanations_file_id_idx on public.explanations (file_id);
create index file_roles_organization_id_idx on public.file_roles (organization_id);
create index file_roles_analysis_id_idx on public.file_roles (analysis_id);
create index insights_organization_id_idx on public.insights (organization_id);
create index insights_analysis_id_idx on public.insights (analysis_id);

-- Read access only: nothing writes through the Data API yet. Grants say which
-- operations exist; the policies say which rows.
grant select on
  public.organizations,
  public.projects,
  public.analyses,
  public.files,
  public.edges,
  public.routes,
  public.explanations,
  public.file_roles,
  public.insights
to authenticated;

-- The whole authorization layer: a row is visible when it belongs to the
-- organization on the token. The select wrapper evaluates the claim once per
-- query rather than once per row.
create policy "Members read their organization"
  on public.organizations for select to authenticated
  using (id = (select private.requesting_organization_id()));

create policy "Members read their organization's projects"
  on public.projects for select to authenticated
  using (organization_id = (select private.requesting_organization_id()));

create policy "Members read their organization's analyses"
  on public.analyses for select to authenticated
  using (organization_id = (select private.requesting_organization_id()));

create policy "Members read their organization's files"
  on public.files for select to authenticated
  using (organization_id = (select private.requesting_organization_id()));

create policy "Members read their organization's edges"
  on public.edges for select to authenticated
  using (organization_id = (select private.requesting_organization_id()));

create policy "Members read their organization's routes"
  on public.routes for select to authenticated
  using (organization_id = (select private.requesting_organization_id()));

create policy "Members read their organization's explanations"
  on public.explanations for select to authenticated
  using (organization_id = (select private.requesting_organization_id()));

create policy "Members read their organization's file roles"
  on public.file_roles for select to authenticated
  using (organization_id = (select private.requesting_organization_id()));

create policy "Members read their organization's insights"
  on public.insights for select to authenticated
  using (organization_id = (select private.requesting_organization_id()));
