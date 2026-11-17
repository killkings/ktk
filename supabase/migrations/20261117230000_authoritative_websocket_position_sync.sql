begin;

-- Only the authenticated game server may persist live positions.
-- The browser never receives the Supabase secret API key and cannot call this RPC.
create or replace function public.ktk_sync_live_positions(p_positions jsonb)
returns table(user_id uuid, position_updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role text;
  v_entry jsonb;
  v_user_id uuid;
  v_x double precision;
  v_y double precision;
  v_direction smallint;
  v_input_x smallint;
  v_input_y smallint;
  v_moving boolean;
  v_running boolean;
  v_guarding boolean;
  v_state jsonb;
  v_updated_at timestamptz;
  v_expected_updated_at timestamptz;
  v_count integer := 0;
begin
  v_role := coalesce(
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    ''
  );
  if v_role <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVER_ROLE_REQUIRED';
  end if;

  if p_positions is null or jsonb_typeof(p_positions) <> 'array' then
    raise exception 'INVALID_POSITION_BATCH';
  end if;
  if jsonb_array_length(p_positions) > 128 then
    raise exception 'POSITION_BATCH_TOO_LARGE';
  end if;

  for v_entry in select value from jsonb_array_elements(p_positions)
  loop
    if jsonb_typeof(v_entry) <> 'object' then
      raise exception 'INVALID_POSITION_ENTRY';
    end if;

    v_user_id := (v_entry->>'user_id')::uuid;
    v_x := (v_entry->>'x')::double precision;
    v_y := (v_entry->>'y')::double precision;
    v_direction := (v_entry->>'direction')::smallint;
    v_expected_updated_at := nullif(v_entry->>'expected_position_updated_at','')::timestamptz;
    v_input_x := coalesce((v_entry->>'input_x')::smallint, 0);
    v_input_y := coalesce((v_entry->>'input_y')::smallint, 0);
    v_moving := coalesce((v_entry->>'moving')::boolean, false);
    v_running := coalesce((v_entry->>'running')::boolean, false);
    v_guarding := coalesce((v_entry->>'guarding')::boolean, false);

    if v_user_id is null
       or v_x is null
       or v_y is null
       or v_direction is null
       or v_expected_updated_at is null
       or not (v_x >= -100000 and v_x <= 100000)
       or not (v_y >= -100000 and v_y <= 100000)
       or v_direction not between 0 and 3
       or v_input_x not between -1 and 1
       or v_input_y not between -1 and 1
       or (v_running and not v_moving) then
      raise exception 'INVALID_POSITION_ENTRY';
    end if;

    update public.ktk_world_players as player
    set x = v_x,
        y = v_y,
        direction = v_direction,
        state = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(coalesce(player.state, '{}'::jsonb),
                    '{moving}', to_jsonb(v_moving), true),
                    '{running}', to_jsonb(v_running), true),
                    '{guarding}', to_jsonb(v_guarding), true),
                    '{movement_input_x}', to_jsonb(v_input_x), true),
                    '{movement_input_y}', to_jsonb(v_input_y), true),
                    '{movement_running}', to_jsonb(v_running), true)
                    || jsonb_build_object('movement_guarding', v_guarding),
        last_seen_at = clock_timestamp(),
        position_updated_at = clock_timestamp(),
        movement_updated_at = clock_timestamp()
    where player.user_id = v_user_id
      and player.world_id = 'main'
      and player.is_alive = true
      and player.position_updated_at = v_expected_updated_at
    returning player.position_updated_at into v_updated_at;

    if found then
      user_id := v_user_id;
      position_updated_at := v_updated_at;
      return next;
      v_count := v_count + 1;
    end if;
  end loop;

  return;
end;
$function$;

revoke all on function public.ktk_sync_live_positions(jsonb) from public, anon, authenticated;
grant execute on function public.ktk_sync_live_positions(jsonb) to service_role;

comment on function public.ktk_sync_live_positions(jsonb)
is 'Persists a bounded batch of in-memory authoritative WebSocket world positions; service_role only.';

commit;
