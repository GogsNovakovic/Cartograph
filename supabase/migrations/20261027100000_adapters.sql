-- Framework adapters: which framework matched, whether a role is one the
-- framework loads itself, and where each route is declared.

-- Null when no framework matched; the repository still renders.
alter table public.analyses
  add column framework text;

-- Whether the framework or a tool loads the file itself (a page, a config)
-- or the role only describes it (a component). Existing rows came from a
-- parser that didn't distinguish; they belong to analyses stored under the
-- previous result version, which are read as needing a re-run, so the
-- value they get here is never shown.
alter table public.file_roles
  add column entry boolean not null default false;
alter table public.file_roles
  alter column entry drop default;

-- Exact or absent: a route row exists only when both its method and its
-- full pattern were read from the syntax.
alter table public.routes
  add column line integer not null check (line > 0),
  add constraint routes_method_check check (
    method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'SEARCH', 'ALL')
  ),
  add constraint routes_path_check check (path like '/%');
