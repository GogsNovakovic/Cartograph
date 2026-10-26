-- What a run needs to store: its stages, the commit it read, and everything
-- the parser returned, so the map can be rebuilt from rows alone.
--
-- Rows are written by the pipeline with the server's secret key, which
-- bypasses row-level security. Nothing writes through the Data API, so the
-- grants stay read-only and the policies stay the whole read path.

-- Every project and analysis before this migration is a seeded stand-in: no
-- run existed to produce a real one. None of them could satisfy the checks
-- below (a complete analysis without a commit or a result), and keeping them
-- would mean inventing those values.
delete from public.projects;

-- One analysis per repository: pasting the same URL again finds the existing
-- one, and a re-run resets that row rather than adding another.
alter table public.analyses
  add constraint analyses_project_id_key unique (project_id);

-- The covering index for project_id is now the unique constraint's.
drop index public.analyses_project_id_idx;

create type public.analysis_stage as enum ('fetching', 'selecting', 'parsing', 'storing');

alter table public.analyses
  -- When the current run began. Not created_at: a re-run reuses the row, and
  -- an unfinished run is told apart from an abandoned one by its age.
  add column started_at timestamptz,
  -- The stage the run is in, or the one it was in when it failed, so a
  -- failed run says where as well as why. Null before a run and after one
  -- completes.
  add column stage public.analysis_stage,
  -- What the stage is doing right now, in words, e.g. how many files it found.
  add column stage_message text,
  -- The commit the archive came from, so a later run can tell whether the
  -- repository has moved on. Null until the fetch has resolved one.
  add column commit_sha text check (commit_sha ~ '^[0-9a-f]{40}$'),
  -- The parser's own output that isn't a file or an edge. Kept as the parser
  -- wrote it rather than reshaped, so reading it back is the same validation
  -- the parser's reader already does.
  add column schema_version integer,
  add column adapters text[],
  add column coverage jsonb,
  add column excluded_directories jsonb,
  add constraint analyses_stage_while_running_or_failed check (
    (stage is not null) = (status in ('parsing', 'failed'))
  ),
  add constraint analyses_started_unless_queued check ((started_at is not null) = (status <> 'queued')),
  -- A complete analysis has everything the map is drawn from.
  add constraint analyses_complete_has_result check (
    status <> 'complete' or (
      commit_sha is not null
      and schema_version is not null
      and adapters is not null
      and coverage is not null
      and excluded_directories is not null
    )
  );

-- Everything the parser says about a file. Fan-in and fan-out are stored as
-- the parser counted them rather than recounted, so there is one definition.
alter table public.files
  add column folder text not null,
  add column bytes integer not null,
  add column lines integer,
  add column sha256 text,
  add column fan_in integer not null,
  add column fan_out integer not null;

alter table public.edges
  add column line integer not null,
  add column type_only boolean not null;
