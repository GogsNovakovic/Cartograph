-- Stand-in rows until something creates real ones. Organization IDs are the
-- real Clerk ones, so signing in to each organization shows its own rows.
-- Fixed IDs and `on conflict do nothing` make re-running this harmless.

insert into public.organizations (id, name) values
  ('org_3KsvAGdLguxmwsznVCpcMn6SMfN', 'Stokon'),
  ('org_3KyWRbdF9qqjRP8xMFkJqtt8ub9', 'Stagkonst')
on conflict do nothing;

insert into public.projects (id, organization_id, owner, name) values
  ('00000000-0000-4000-8000-000000000101', 'org_3KsvAGdLguxmwsznVCpcMn6SMfN', 'vercel', 'next.js'),
  ('00000000-0000-4000-8000-000000000102', 'org_3KsvAGdLguxmwsznVCpcMn6SMfN', 'colinhacks', 'zod'),
  ('00000000-0000-4000-8000-000000000103', 'org_3KsvAGdLguxmwsznVCpcMn6SMfN', 'expressjs', 'express')
on conflict do nothing;

-- One analysis in each state, so the dashboard shows all of them.
insert into public.analyses (id, organization_id, project_id, status, failure_reason, created_at, completed_at) values
  ('00000000-0000-4000-8000-000000000201', 'org_3KsvAGdLguxmwsznVCpcMn6SMfN', '00000000-0000-4000-8000-000000000101', 'complete', null,
    '2026-10-18 09:12:00+00', '2026-10-18 09:14:31+00'),
  ('00000000-0000-4000-8000-000000000202', 'org_3KsvAGdLguxmwsznVCpcMn6SMfN', '00000000-0000-4000-8000-000000000102', 'parsing', null,
    '2026-10-20 08:40:00+00', null),
  ('00000000-0000-4000-8000-000000000203', 'org_3KsvAGdLguxmwsznVCpcMn6SMfN', '00000000-0000-4000-8000-000000000103', 'failed', 'Seeded row, no analysis ran.',
    '2026-10-19 16:05:00+00', '2026-10-19 16:05:12+00'),
  ('00000000-0000-4000-8000-000000000204', 'org_3KsvAGdLguxmwsznVCpcMn6SMfN', '00000000-0000-4000-8000-000000000101', 'queued', null,
    '2026-10-20 09:01:00+00', null)
on conflict do nothing;

-- Stagkonst: different repositories, so a row leaking across organizations
-- is obvious at a glance.
insert into public.projects (id, organization_id, owner, name) values
  ('00000000-0000-4000-8000-000000000111', 'org_3KyWRbdF9qqjRP8xMFkJqtt8ub9', 'trpc', 'trpc'),
  ('00000000-0000-4000-8000-000000000112', 'org_3KyWRbdF9qqjRP8xMFkJqtt8ub9', 'sindresorhus', 'ky')
on conflict do nothing;

insert into public.analyses (id, organization_id, project_id, status, failure_reason, created_at, completed_at) values
  ('00000000-0000-4000-8000-000000000211', 'org_3KyWRbdF9qqjRP8xMFkJqtt8ub9', '00000000-0000-4000-8000-000000000111', 'complete', null,
    '2026-10-17 14:20:00+00', '2026-10-17 14:21:48+00'),
  ('00000000-0000-4000-8000-000000000212', 'org_3KyWRbdF9qqjRP8xMFkJqtt8ub9', '00000000-0000-4000-8000-000000000112', 'queued', null,
    '2026-10-20 10:30:00+00', null)
on conflict do nothing;
