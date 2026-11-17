begin;

-- Stop only the three jobs created by KTK V2.
do $cleanup_jobs$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'ktk-v2-projectile-simulation',
      'ktk-v2-world-simulation',
      'ktk-v2-disconnect-expirer'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$cleanup_jobs$;

-- Remove only V2-specific authorization policies from the shared Realtime table.
drop policy if exists "KTK V2 clients can publish own presence" on realtime.messages;
drop policy if exists "KTK V2 clients can receive world broadcasts" on realtime.messages;
drop policy if exists "KTK V2 clients can receive world presence" on realtime.messages;

-- Remove the V2-only table triggers before their trigger functions.
drop trigger if exists ktk_v2_entity_broadcast on public.ktk_v2_entities;
drop trigger if exists ktk_v2_player_broadcast on public.ktk_v2_players;
drop trigger if exists ktk_v2_world_broadcast on public.ktk_v2_worlds;

drop function if exists public.ktk_v2_attack();
drop function if exists public.ktk_v2_broadcast_entity_change();
drop function if exists public.ktk_v2_broadcast_player_change();
drop function if exists public.ktk_v2_broadcast_world_change();
drop function if exists public.ktk_v2_choose_clan(text);
drop function if exists public.ktk_v2_claim_crown();
drop function if exists public.ktk_v2_enter_world(text, jsonb);
drop function if exists public.ktk_v2_interact();
drop function if exists public.ktk_v2_item_action(text, jsonb);
drop function if exists public.ktk_v2_launch_projectile();
drop function if exists public.ktk_v2_leave_world();
drop function if exists public.ktk_v2_set_suspended(boolean, bigint);
drop function if exists public.ktk_v2_step_player(smallint, smallint, boolean, boolean);
drop function if exists public.ktk_v2_world_state();

drop schema if exists ktk_v2_private cascade;

drop table if exists public.ktk_v2_entities;
drop table if exists public.ktk_v2_players;
drop table if exists public.ktk_v2_worlds;
drop table if exists public.ktk_v2_item_catalog;

commit;
