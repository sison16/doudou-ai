-- Apply after username_auth_rate_limit.sql, before deploying username-auth.
begin;
create table public.user_memberships (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_login_at timestamptz,
  is_admin boolean not null default false,
  is_beta boolean generated always as (
    coalesce(first_login_at < timestamptz '2026-11-16 00:00:00+08', false)
  ) stored
);
alter table public.user_memberships enable row level security;
revoke all on table public.user_memberships from public, anon, authenticated;
grant select, insert, update on table public.user_memberships to service_role;
comment on table public.user_memberships is 'Server-owned badges. Beijing cutoff is exclusive; signup alone does not qualify.';

-- Never trust user_metadata, a submitted badge, or the browser clock.
create function public.record_username_login(p_user_id uuid, p_login_at timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare membership public.user_memberships;
begin
  if p_login_at is null then raise exception 'Successful login timestamp required'; end if;
  insert into public.user_memberships (user_id, first_login_at)
  values (p_user_id, p_login_at)
  on conflict (user_id) do update
    set first_login_at = least(public.user_memberships.first_login_at, excluded.first_login_at)
  returning * into membership;
  return jsonb_build_object(
    'is_beta', membership.is_beta,
    'is_admin', membership.is_admin,
    'first_login_at', membership.first_login_at
  );
end;
$$;
revoke all on function public.record_username_login(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.record_username_login(uuid, timestamptz) to service_role;

-- Backfill existing successful logins; never use account creation time.
-- Retained sessions may provide an earlier successful login than last_sign_in_at.
insert into public.user_memberships (user_id, first_login_at)
select u.id, least(u.last_sign_in_at, (select min(s.created_at) from auth.sessions s where s.user_id = u.id))
from auth.users u
where u.last_sign_in_at is not null
on conflict (user_id) do update
  set first_login_at = least(public.user_memberships.first_login_at, excluded.first_login_at);
commit;
