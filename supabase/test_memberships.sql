-- Run with a database administrator in SQL Editor. All fixtures roll back.
begin;
set local timezone = 'America/New_York';
do $$
declare
  early_id uuid := gen_random_uuid();
  boundary_id uuid := gen_random_uuid();
  late_id uuid := gen_random_uuid();
  signup_id uuid := gen_random_uuid();
  result jsonb;
begin
  insert into auth.users (id) values (early_id), (boundary_id), (late_id), (signup_id);
  if exists (select 1 from public.user_memberships where user_id = signup_id) then
    raise exception 'Signup must not grant membership';
  end if;
  result := public.record_username_login(early_id, '2026-11-15T23:59:59.999999+08');
  if result->>'is_beta' <> 'true' or result->>'is_admin' <> 'false' then
    raise exception 'Pre-cutoff normal-user badge failed';
  end if;
  update public.user_memberships set is_admin = true where user_id = early_id;
  result := public.record_username_login(early_id, '2026-11-17T00:00:00+08');
  if result->>'is_beta' <> 'true' or result->>'is_admin' <> 'true' then
    raise exception 'Permanent beta/admin badges were lost';
  end if;
  result := public.record_username_login(boundary_id, '2026-11-16T00:00:00+08');
  if result->>'is_beta' <> 'false' then raise exception 'Cutoff must be exclusive'; end if;
  result := public.record_username_login(late_id, '2026-11-16T00:00:01+08');
  if result->>'is_beta' <> 'false' then raise exception 'Late login earned badge'; end if;
  -- Out-of-order concurrent requests retain the earliest successful login.
  result := public.record_username_login(late_id, '2026-11-15T15:59:59Z');
  if result->>'is_beta' <> 'true' then raise exception 'Earlier login was lost'; end if;
  if has_table_privilege('anon', 'public.user_memberships', 'SELECT')
    or has_table_privilege('authenticated', 'public.user_memberships', 'UPDATE')
    or has_function_privilege('anon', 'public.record_username_login(uuid,timestamp with time zone)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.record_username_login(uuid,timestamp with time zone)', 'EXECUTE') then
    raise exception 'Client can read or forge memberships';
  end if;
  if not has_function_privilege('service_role', 'public.record_username_login(uuid,timestamp with time zone)', 'EXECUTE') then
    raise exception 'Backend cannot record login';
  end if;
end;
$$;
rollback;
select 'PASS: signup, cutoff, persistence, admin, ordering and client permissions' as result;
