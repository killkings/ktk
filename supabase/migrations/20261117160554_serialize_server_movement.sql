begin;

alter function public.ktk_step_player(smallint, smallint, boolean, boolean)
  set schema ktk_private;
alter function ktk_private.ktk_step_player(smallint, smallint, boolean, boolean)
  rename to step_player_unlocked;

revoke all on function ktk_private.step_player_unlocked(smallint, smallint, boolean, boolean)
  from public, anon, authenticated;

create function public.ktk_step_player(
  p_input_x smallint,
  p_input_y smallint,
  p_running boolean default false,
  p_guarding boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- All movement steps share one transaction-scoped lock. The existing
  -- server-side calculation remains unchanged and now reads a stable world.
  perform pg_catalog.set_config('lock_timeout', '250ms', true);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('ktk:main:movement')
  );

  return ktk_private.step_player_unlocked(
    p_input_x,
    p_input_y,
    p_running,
    p_guarding
  );
end;
$function$;

revoke all on function public.ktk_step_player(smallint, smallint, boolean, boolean)
  from public, anon;
grant execute on function public.ktk_step_player(smallint, smallint, boolean, boolean)
  to authenticated;

comment on function public.ktk_step_player(smallint, smallint, boolean, boolean)
  is 'Serializes authoritative movement steps for the main world before applying server-side movement and collision logic.';

commit;
