begin;

do $$
declare
  v_uid uuid := '10000000-0000-4000-8000-000000000001';
  v_other_uid uuid := '10000000-0000-4000-8000-000000000002';
  v_enter jsonb;
  v_step jsonb;
  v_claim jsonb;
  v_world public.ktk_v2_worlds;
  v_crown public.ktk_v2_entities;
  v_player public.ktk_v2_players;
  v_start_x double precision;
  v_start_y double precision;
  v_distance double precision;
  v_failed boolean;
begin
  insert into auth.users(id) values (v_uid),(v_other_uid);

  perform set_config('request.jwt.claim.sub',v_uid::text,true);
  v_enter := public.ktk_v2_enter_world(
    'Teste V2',
    jsonb_build_object(
      'gender','male','skin','brown','eyes','brown','hair','dark_brown',
      'hairstyle','hair_pixie','clothing','#8d3030'
    )
  );

  if v_enter->>'user_id' <> v_uid::text then
    raise exception 'V2_ENTRY_DID_NOT_RETURN_NEW_PLAYER';
  end if;
  if v_enter->'appearance'->>'hairstyle' <> 'hair_pixie' then
    raise exception 'V2_APPEARANCE_NOT_PERSISTED';
  end if;
  v_start_x := (v_enter->>'x')::double precision;
  v_start_y := (v_enter->>'y')::double precision;

  if (public.ktk_v2_world_state()->'players') is null then
    raise exception 'V2_WORLD_SNAPSHOT_MISSING_PLAYERS';
  end if;
  if jsonb_array_length(public.ktk_v2_world_state()->'players') <> 1 then
    raise exception 'V2_WORLD_SNAPSHOT_PLAYER_COUNT_WRONG';
  end if;
  if jsonb_array_length(public.ktk_v2_world_state()->'entities') <> 1 then
    raise exception 'V2_WORLD_SNAPSHOT_CROWN_MISSING';
  end if;

  perform pg_sleep(0.22);
  v_step := public.ktk_v2_step_player(-1,0,false,false);
  if (v_step->>'x')::double precision >= v_start_x then
    raise exception 'V2_SERVER_MOVEMENT_DID_NOT_CHANGE_X';
  end if;
  if (v_step->>'direction')::integer <> 1 then
    raise exception 'V2_SERVER_DIRECTION_NOT_LEFT';
  end if;

  -- Move close enough to the world crown through server-approved RPC steps.
  for i in 1..3 loop
    perform pg_sleep(0.22);
    v_step := public.ktk_v2_step_player(-1,0,false,false);
  end loop;

  select * into v_player
  from public.ktk_v2_players where user_id = v_uid and world_id = 'main';
  select * into v_crown
  from public.ktk_v2_entities where world_id = 'main' and entity_id = 'crown-main';
  v_distance := sqrt(power(v_player.x-v_crown.x,2)+power(v_player.y-v_crown.y,2));
  if v_distance > 64 then
    raise exception 'V2_TEST_PLAYER_DID_NOT_REACH_CROWN distance=%',v_distance;
  end if;

  v_claim := public.ktk_v2_claim_crown();
  if v_claim->>'ok' <> 'true' then
    raise exception 'V2_CROWN_CLAIM_NOT_CONFIRMED';
  end if;
  select * into v_world from public.ktk_v2_worlds where id = 'main';
  select * into v_crown from public.ktk_v2_entities
    where world_id = 'main' and entity_id = 'crown-main';
  if v_world.king_user_id <> v_uid then
    raise exception 'V2_CROWN_OWNER_NOT_STORED';
  end if;
  if v_crown.state->>'status' <> 'held' then
    raise exception 'V2_CROWN_ENTITY_NOT_HELD';
  end if;

  -- A second player cannot take a crown that the first player owns.
  perform set_config('request.jwt.claim.sub',v_other_uid::text,true);
  perform public.ktk_v2_enter_world('Segundo Jogador','{}'::jsonb);
  v_failed := false;
  begin
    perform public.ktk_v2_claim_crown();
  exception when others then
    v_failed := sqlerrm = 'CROWN_ALREADY_CLAIMED';
  end;
  if not v_failed then
    raise exception 'V2_SECOND_PLAYER_CLAIMED_ALREADY_HELD_CROWN';
  end if;

  -- The King dies on exit; crown is released at the old server position.
  perform set_config('request.jwt.claim.sub',v_uid::text,true);
  perform public.ktk_v2_leave_world();
  select * into v_player from public.ktk_v2_players where user_id = v_uid;
  select * into v_world from public.ktk_v2_worlds where id = 'main';
  select * into v_crown from public.ktk_v2_entities
    where world_id = 'main' and entity_id = 'crown-main';
  if v_player.is_alive then raise exception 'V2_EXIT_DID_NOT_KILL_CHARACTER'; end if;
  if v_world.king_user_id is not null then raise exception 'V2_DEAD_KING_STILL_OWNS_CROWN'; end if;
  if v_crown.state->>'status' <> 'ground' then raise exception 'V2_CROWN_NOT_DROPPED_ON_KING_DEATH'; end if;
  if v_crown.x <> v_player.x or v_crown.y <> v_player.y then
    raise exception 'V2_CROWN_DROP_NOT_AT_SERVER_POSITION';
  end if;

  v_failed := false;
  begin
    perform public.ktk_v2_enter_world('Teste V2','{}'::jsonb);
  exception when others then
    v_failed := sqlerrm = 'CHARACTER_ALREADY_DEAD_NEW_SESSION_REQUIRED';
  end;
  if not v_failed then raise exception 'V2_DEAD_IDENTITY_WAS_REUSED'; end if;

  if has_table_privilege('authenticated','public.ktk_v2_players','INSERT')
     or has_table_privilege('authenticated','public.ktk_v2_players','UPDATE')
     or has_table_privilege('authenticated','public.ktk_v2_entities','INSERT')
     or has_table_privilege('authenticated','public.ktk_v2_entities','UPDATE') then
    raise exception 'V2_CLIENT_HAS_DIRECT_TABLE_WRITE_PERMISSION';
  end if;
  if has_function_privilege('anon','public.ktk_v2_step_player(smallint,smallint,boolean,boolean)','EXECUTE') then
    raise exception 'V2_ANON_CAN_EXECUTE_MOVEMENT_RPC';
  end if;
  if not has_function_privilege('authenticated','public.ktk_v2_step_player(smallint,smallint,boolean,boolean)','EXECUTE') then
    raise exception 'V2_AUTHENTICATED_CANNOT_EXECUTE_MOVEMENT_RPC';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='realtime' and tablename='messages'
      and policyname='KTK V2 clients can publish own presence'
  ) then
    raise exception 'V2_PRESENCE_INSERT_POLICY_MISSING';
  end if;
end
$$;

rollback;
