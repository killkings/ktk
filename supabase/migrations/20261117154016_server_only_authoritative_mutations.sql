-- All world mutations must pass through authenticated, server-authoritative RPCs.
-- Browser clients may read the public world snapshot but cannot write world rows
-- or mutate profiles directly through the PostgREST table endpoints.

revoke all privileges on table
  public.ktk_profiles,
  public.ktk_world_players,
  public.ktk_world_entities,
  public.ktk_worlds
from public, anon, authenticated;

grant select on table
  public.ktk_profiles,
  public.ktk_world_players,
  public.ktk_world_entities,
  public.ktk_worlds
to authenticated;

drop policy if exists "Players create their own KTK profile" on public.ktk_profiles;
drop policy if exists "Players update their own KTK profile" on public.ktk_profiles;
