-- Each run's rows are its own, and the analysis names which run is its map.
-- A re-run stores beside the map it is replacing and swaps in one update, so
-- a re-run that fails leaves the old map exactly as it was.

-- The run whose rows are this analysis's map. Null until a run has stored
-- one. Everything the map is drawn from (commit, coverage, adapters...) is
-- that run's, and changes only with it.
alter table public.analyses
  add column result_run uuid;

alter table public.files add column run uuid;
alter table public.edges add column run uuid;
alter table public.file_roles add column run uuid;
alter table public.routes add column run uuid;

-- Every map stored so far becomes the run it already is. A failed or
-- unfinished analysis has no rows to keep: a failed run cleared its own.
update public.analyses set result_run = gen_random_uuid() where status = 'complete';
update public.files f set run = a.result_run from public.analyses a where f.analysis_id = a.id;
update public.edges e set run = a.result_run from public.analyses a where e.analysis_id = a.id;
update public.file_roles r set run = a.result_run from public.analyses a where r.analysis_id = a.id;
update public.routes r set run = a.result_run from public.analyses a where r.analysis_id = a.id;
-- Edges, roles and routes hang off files and go with them.
delete from public.files where run is null;

alter table public.files alter column run set not null;
alter table public.edges alter column run set not null;
alter table public.file_roles alter column run set not null;
alter table public.routes alter column run set not null;

-- A path is unique within a run, not within the analysis: two runs of one
-- analysis hold the same paths for as long as the swap takes.
alter table public.files
  drop constraint files_analysis_id_path_key,
  add constraint files_analysis_id_run_path_key unique (analysis_id, run, path),
  -- Target for the run-checked keys below.
  add constraint files_id_run_key unique (id, run);

-- Never a mix: an edge, a role or a route can only name a file of its own run.
alter table public.edges
  add foreign key (source_file_id, run) references public.files (id, run) on delete cascade,
  add foreign key (target_file_id, run) references public.files (id, run) on delete cascade;
alter table public.file_roles
  add foreign key (file_id, run) references public.files (id, run) on delete cascade;
alter table public.routes
  add foreign key (file_id, run) references public.files (id, run) on delete cascade;

-- Every read of a map filters by analysis and run.
create index edges_analysis_id_run_idx on public.edges (analysis_id, run);
create index file_roles_analysis_id_run_idx on public.file_roles (analysis_id, run);
create index routes_analysis_id_run_idx on public.routes (analysis_id, run);

-- A map's facts belong to the run it is, not to the status of whichever run
-- came last: a failed re-run is 'failed' and still has a map.
alter table public.analyses
  drop constraint analyses_complete_has_result,
  add constraint analyses_map_has_result check (
    result_run is null or (
      commit_sha is not null
      and schema_version is not null
      and adapters is not null
      and coverage is not null
      and excluded_directories is not null
    )
  ),
  add constraint analyses_complete_has_map check (status <> 'complete' or result_run is not null),
  drop constraint analyses_classification_failure_when_complete,
  add constraint analyses_classification_failure_with_map check (
    classification_failure is null or result_run is not null
  );
