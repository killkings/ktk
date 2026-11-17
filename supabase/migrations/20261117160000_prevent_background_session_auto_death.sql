create or replace function ktk_private.expire_stale_players()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_player public.ktk_world_players;
  v_state jsonb;
  v_count integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  -- A missing heartbeat means the client has not contacted the server.
  -- Do not treat a backgrounded/suspended browser as an intentional exit.
  -- Explicit exits still use public.ktk_leave_world() and kill immediately.
  perform 1
  from public.ktk_worlds
  where id = 'main'
  for update;

  for v_player in
    select *
    from public.ktk_world_players
    where world_id = 'main'
      and is_alive = true
      and last_seen_at < v_now - interval '7 days'
    order by last_seen_at
    for update skip locked
  loop
    v_state := coalesce(v_player.state, '{}'::jsonb);

    perform ktk_private.drop_player_assets(
      v_player.user_id, v_player.x, v_player.y, v_state
    );

    v_state := jsonb_set(v_state, '{health}', '0'::jsonb, true);
    v_state := jsonb_set(v_state, '{inventory}', '[null,null]'::jsonb, true);
    v_state := jsonb_set(v_state, '{wearables}',
      '{"head":null,"chest":null,"waist":null,"legs":null,"feet":null}'::jsonb, true);
    v_state := jsonb_set(v_state, '{moving}', 'false'::jsonb, true);
    v_state := jsonb_set(v_state, '{running}', 'false'::jsonb, true);
    v_state := jsonb_set(v_state, '{guarding}', 'false'::jsonb, true);
    v_state := v_state - 'backgrounded_at';

    update public.ktk_world_players
    set is_alive = false,
        state = v_state,
        last_seen_at = v_now
    where user_id = v_player.user_id
      and world_id = 'main'
      and is_alive = true;

    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$function$;
