begin;

do $$
declare
  v_uid uuid := '10000000-0000-4000-8000-000000000001';
  v_other_uid uuid := '10000000-0000-4000-8000-000000000002';
  v_third_uid uuid := '10000000-0000-4000-8000-000000000003';
  v_enter jsonb;
  v_step jsonb;
  v_claim jsonb;
  v_snapshot jsonb;
  v_action jsonb;
  v_attack jsonb;
  v_world public.ktk_v2_worlds;
  v_crown public.ktk_v2_entities;
  v_drop public.ktk_v2_entities;
  v_player public.ktk_v2_players;
  v_other public.ktk_v2_players;
  v_third public.ktk_v2_players;
  v_start_x double precision;
  v_start_y double precision;
  v_king_x double precision;
  v_king_y double precision;
  v_distance double precision;
  v_satiety numeric;
  v_loot_count integer;
  v_failed boolean;
  i integer;
begin
  insert into auth.users(id) values (v_uid),(v_other_uid),(v_third_uid);

  -- Character entry, appearance and clan assignment are server-owned.
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

  v_enter := public.ktk_v2_choose_clan('#d94343');
  if v_enter->>'clan_color' <> '#d94343' then
    raise exception 'V2_CLAN_ASSIGNMENT_NOT_PERSISTED';
  end if;
  v_failed := false;
  begin
    perform public.ktk_v2_choose_clan('#3d75d6');
  exception when others then
    v_failed := sqlerrm = 'CLAN_ALREADY_CHOSEN';
  end;
  if not v_failed then raise exception 'V2_CLAN_COLOR_WAS_CHANGED'; end if;

  -- The snapshot may now contain the crown, starter loot, resources and NPC.
  v_snapshot := public.ktk_v2_world_state();
  if jsonb_array_length(v_snapshot->'players') <> 1 then
    raise exception 'V2_WORLD_SNAPSHOT_PLAYER_COUNT_WRONG';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_snapshot->'entities') entity
    where entity->>'entity_id'='crown-main'
      and entity->'state'->>'status'='ground'
  ) then
    raise exception 'V2_WORLD_SNAPSHOT_CROWN_MISSING';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_snapshot->'entities') entity
    where entity->>'entity_id'='item-starter-sword'
  ) then
    raise exception 'V2_STARTER_ITEM_MISSING';
  end if;

  -- Pickup, drop and pickup again must update the same server-owned inventory.
  v_action := public.ktk_v2_item_action('pickup',jsonb_build_object('entity_id','item-starter-sword'));
  if v_action->>'ok' <> 'true' then raise exception 'V2_STARTER_SWORD_PICKUP_FAILED'; end if;
  select * into v_player from public.ktk_v2_players where user_id=v_uid;
  if not exists (
    select 1 from jsonb_array_elements(v_player.state->'inventory') item
    where item->>'item_id'='equipment-longsword'
  ) then raise exception 'V2_PICKUP_NOT_STORED_IN_INVENTORY'; end if;

  v_action := public.ktk_v2_item_action('drop',jsonb_build_object('slot',0));
  if v_action->>'ok' <> 'true' then raise exception 'V2_ITEM_DROP_FAILED'; end if;
  select * into v_drop from public.ktk_v2_entities
  where world_id='main' and entity_type='item'
    and state->>'item_id'='equipment-longsword'
    and entity_id like 'drop-%'
  order by updated_at desc limit 1;
  if not found then raise exception 'V2_DROPPED_ITEM_NOT_IN_WORLD'; end if;

  v_action := public.ktk_v2_item_action('pickup',jsonb_build_object('entity_id',v_drop.entity_id));
  if v_action->>'ok' <> 'true' then raise exception 'V2_DROPPED_ITEM_CANNOT_BE_RECOLLECTED'; end if;

  -- Consumables change server stats and are removed from the inventory.
  select * into v_player from public.ktk_v2_players where user_id=v_uid;
  update public.ktk_v2_players
  set state=jsonb_set(state,'{satiety}','20'::jsonb,true),revision=revision+1
  where user_id=v_uid;
  insert into public.ktk_v2_entities(
    world_id,entity_id,entity_type,x,y,collision_radius,state,revision
  ) values (
    'main','test-food-drop','item',v_player.x+10,v_player.y+10,4,
    '{"status":"ground","item_id":"resource-berries","quantity":1,"expires_at":null}'::jsonb,1
  );
  v_action:=public.ktk_v2_item_action('pickup',jsonb_build_object('entity_id','test-food-drop'));
  if v_action->>'ok'<>'true' then raise exception 'V2_CONSUMABLE_PICKUP_FAILED'; end if;
  v_action:=public.ktk_v2_item_action('consume','{"slot":1}'::jsonb);
  if v_action->>'ok'<>'true' then raise exception 'V2_CONSUME_FAILED'; end if;
  select * into v_player from public.ktk_v2_players where user_id=v_uid;
  if (v_player.state->>'satiety')::numeric <> 38 then
    raise exception 'V2_CONSUMABLE_DID_NOT_UPDATE_SATIETY';
  end if;
  if v_player.state->'inventory'->1 <> 'null'::jsonb then
    raise exception 'V2_CONSUMED_ITEM_REMAINS_IN_INVENTORY';
  end if;

  -- Wearable loot is automatically equipped, and equip/unequip swaps server state.
  insert into public.ktk_v2_entities(
    world_id,entity_id,entity_type,x,y,collision_radius,state,revision
  ) values (
    'main','test-shirt-drop','item',v_player.x+10,v_player.y+10,4,
    '{"status":"ground","item_id":"cosmetic-linen-shirt","quantity":1,"expires_at":null}'::jsonb,1
  );
  v_action:=public.ktk_v2_item_action('pickup',jsonb_build_object('entity_id','test-shirt-drop'));
  if v_action->>'ok'<>'true' then raise exception 'V2_WEARABLE_PICKUP_FAILED'; end if;
  select * into v_player from public.ktk_v2_players where user_id=v_uid;
  if v_player.state->'wearables'->'chest'->>'item_id' <> 'cosmetic-linen-shirt' then
    raise exception 'V2_WEARABLE_NOT_EQUIPPED';
  end if;
  perform public.ktk_v2_item_action('unequip','{"wear_slot":"chest"}'::jsonb);
  select * into v_player from public.ktk_v2_players where user_id=v_uid;
  if v_player.state->'wearables'->'chest' <> 'null'::jsonb
     or v_player.state->'inventory'->1->>'item_id' <> 'cosmetic-linen-shirt' then
    raise exception 'V2_WEARABLE_UNEQUIP_FAILED';
  end if;
  perform public.ktk_v2_item_action('equip','{"slot":1}'::jsonb);
  select * into v_player from public.ktk_v2_players where user_id=v_uid;
  if v_player.state->'wearables'->'chest'->>'item_id' <> 'cosmetic-linen-shirt' then
    raise exception 'V2_WEARABLE_REEQUIP_FAILED';
  end if;

  -- Server-authoritative movement and direction.
  perform pg_sleep(0.22);
  v_step := public.ktk_v2_step_player(-1::smallint,0::smallint,false,false);
  if (v_step->>'x')::double precision >= v_start_x then
    raise exception 'V2_SERVER_MOVEMENT_DID_NOT_CHANGE_X';
  end if;
  if (v_step->>'direction')::integer <> 1 then
    raise exception 'V2_SERVER_DIRECTION_NOT_LEFT';
  end if;

  -- Move close enough to the world crown through server-approved RPC steps.
  for i in 1..3 loop
    perform pg_sleep(0.22);
    v_step := public.ktk_v2_step_player(-1::smallint,0::smallint,false,false);
  end loop;

  select * into v_player
  from public.ktk_v2_players where user_id = v_uid and world_id = 'main';
  select * into v_crown
  from public.ktk_v2_entities where world_id = 'main' and entity_id = 'crown-main';
  v_distance := sqrt(power(v_player.x-v_crown.x,2)+power(v_player.y-v_crown.y,2));
  if v_distance > 64 then
    raise exception 'V2_TEST_PLAYER_DID_NOT_REACH_CROWN distance=%',v_distance;
  end if;
  v_king_x:=v_player.x;
  v_king_y:=v_player.y;

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

  -- Same-clan members cannot damage the King.
  perform set_config('request.jwt.claim.sub',v_other_uid::text,true);
  v_enter:=public.ktk_v2_enter_world('Segundo Jogador','{}'::jsonb);
  perform public.ktk_v2_choose_clan('#d94343');
  select * into v_other from public.ktk_v2_players where user_id=v_other_uid;
  insert into public.ktk_v2_entities(
    world_id,entity_id,entity_type,x,y,collision_radius,state,revision
  ) values (
    'main','test-second-player-sword','item',v_other.x+10,v_other.y+10,4,
    '{"status":"ground","item_id":"equipment-longsword","quantity":1,"durability":150,"max_durability":150}'::jsonb,1
  );
  perform public.ktk_v2_item_action('pickup','{"entity_id":"test-second-player-sword"}'::jsonb);
  update public.ktk_v2_players
  set x=v_king_x+30,y=v_king_y,direction=1,revision=revision+1
  where user_id=v_other_uid;
  select * into v_player from public.ktk_v2_players where user_id=v_uid;
  v_failed:=false;
  v_attack:=public.ktk_v2_attack();
  if v_attack->>'hit'='true' then
    raise exception 'V2_SAME_CLAN_ATTACKED_THE_KING';
  end if;
  select * into v_player from public.ktk_v2_players where user_id=v_uid;
  if (v_player.state->>'health')::integer<>100 then
    raise exception 'V2_SAME_CLAN_DAMAGED_THE_KING';
  end if;

  -- A voluntary exit kills the character and drops carried items as timed loot.
  update public.ktk_v2_players
  set x=2000,y=2000,revision=revision+1
  where user_id=v_other_uid;
  v_action:=public.ktk_v2_leave_world();
  select * into v_other from public.ktk_v2_players where user_id=v_other_uid;
  if v_other.is_alive then raise exception 'V2_EXIT_DID_NOT_KILL_SECOND_CHARACTER'; end if;
  if not exists (
    select 1 from public.ktk_v2_entities
    where world_id='main' and entity_type='item'
      and state->>'dropped_by'=v_other_uid::text
      and state->>'item_id'='equipment-longsword'
      and nullif(state->>'expires_at','') is not null
  ) then raise exception 'V2_EXIT_DID_NOT_DROP_CARRIED_ITEMS'; end if;

  -- A different clan can attack the King; death drops gear and releases the crown.
  perform set_config('request.jwt.claim.sub',v_third_uid::text,true);
  perform public.ktk_v2_enter_world('Terceiro Jogador','{}'::jsonb);
  perform public.ktk_v2_choose_clan('#3d75d6');
  update public.ktk_v2_players
  set x=v_king_x+30,y=v_king_y,direction=1,revision=revision+1
  where user_id=v_third_uid;
  update public.ktk_v2_players
  set state=jsonb_set(state,'{health}','1'::jsonb,true),revision=revision+1
  where user_id=v_uid;

  v_attack:=public.ktk_v2_attack();
  if v_attack->>'hit'<>'true' or v_attack->>'target_type'<>'player' then
    raise exception 'V2_OPPOSING_CLAN_COULD_NOT_ATTACK_THE_KING';
  end if;

  select * into v_player from public.ktk_v2_players where user_id=v_uid;
  select * into v_world from public.ktk_v2_worlds where id='main';
  select * into v_crown from public.ktk_v2_entities
    where world_id='main' and entity_id='crown-main';
  if v_player.is_alive then raise exception 'V2_ATTACK_DID_NOT_KILL_THE_KING'; end if;
  if v_world.king_user_id is not null then raise exception 'V2_DEAD_KING_STILL_OWNS_CROWN'; end if;
  if v_crown.state->>'status' <> 'ground' then raise exception 'V2_CROWN_NOT_DROPPED_ON_KING_DEATH'; end if;
  if v_crown.x <> v_king_x or v_crown.y <> v_king_y then
    raise exception 'V2_CROWN_DROP_NOT_AT_SERVER_POSITION';
  end if;
  select count(*) into v_loot_count from public.ktk_v2_entities
  where world_id='main' and entity_type='item' and state->>'dropped_by'=v_uid::text;
  if v_loot_count<2 then raise exception 'V2_KING_DID_NOT_DROP_INVENTORY_AND_EQUIPMENT'; end if;

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
     or has_table_privilege('authenticated','public.ktk_v2_entities','UPDATE')
     or has_table_privilege('authenticated','public.ktk_v2_item_catalog','INSERT')
     or has_table_privilege('authenticated','public.ktk_v2_item_catalog','UPDATE') then
    raise exception 'V2_CLIENT_HAS_DIRECT_TABLE_WRITE_PERMISSION';
  end if;
  if has_function_privilege('anon','public.ktk_v2_step_player(smallint,smallint,boolean,boolean)','EXECUTE')
     or has_function_privilege('anon','public.ktk_v2_item_action(text,jsonb)','EXECUTE')
     or has_function_privilege('anon','public.ktk_v2_attack()','EXECUTE')
     or has_function_privilege('anon','public.ktk_v2_interact()','EXECUTE') then
    raise exception 'V2_ANON_CAN_EXECUTE_GAMEPLAY_RPC';
  end if;
  if not has_function_privilege('authenticated','public.ktk_v2_item_action(text,jsonb)','EXECUTE')
     or not has_function_privilege('authenticated','public.ktk_v2_attack()','EXECUTE')
     or not has_function_privilege('authenticated','public.ktk_v2_interact()','EXECUTE') then
    raise exception 'V2_AUTHENTICATED_CANNOT_EXECUTE_GAMEPLAY_RPC';
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
