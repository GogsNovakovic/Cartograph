-- Organizations live in Clerk; these rows exist so analyses can reference
-- them. IDs are the real Clerk ones. Projects and analyses are made by real
-- runs now, not seeded. `on conflict do nothing` makes re-running harmless.

insert into public.organizations (id, name) values
  ('org_3KsvAGdLguxmwsznVCpcMn6SMfN', 'Stokon'),
  ('org_3KyWRbdF9qqjRP8xMFkJqtt8ub9', 'Stagkonst')
on conflict do nothing;
