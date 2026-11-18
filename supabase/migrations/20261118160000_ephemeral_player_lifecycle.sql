-- Character data is temporary: death/exit removes the identity and profile.
-- A separate heartbeat keeps idle connected players alive; a 2-minute silence is a disconnect.

begin;

create or replace function ktk_private.delete_player_identity(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if p_user_id is null then
    return;
  end if;

  -- If a stale king reference remains, release it and leave the crown in-world.
  update public.ktk_worlds
  set king_user_id = null,
      crown_version = crown_version + 1
  where id = 'main'
    and king_user_id = p_user_id;

  if found then
    update public.ktk_world_entities
    set state = coalesce(state, '{}'::jsonb) ||
          jsonb_build_object('status', 'ground', 'item_id', 'king-crown', 'display_name', 'Coroa Real'),
        revision = revision + 1,
        updated_at = clock_timestamp()
    where world_id = 'main'
      and entity_type = 'item'
      and entity_id = 'king-crown';
  end if;

  -- The character and profile are disposable; a real Auth account, if ever
  -- introduced, remains available but receives no saved character.
  delete from public.ktk_profiles
  where id = p_user_id;

  delete from auth.users
  where id = p_user_id
    and is_anonymous is true;
end;
$function$;

revoke all on function ktk_private.delete_player_identity(uuid) from public, anon, authenticated;

create or replace function public.ktk_heartbeat()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.ktk_world_players
  set last_seen_at = v_now
  where user_id = v_uid
    and world_id = 'main'
    and is_alive is true;

  if not found then
    raise exception 'PLAYER_NOT_ACTIVE';
  end if;

  return jsonb_build_object('ok', true, 'server_time', v_now);
end;
$function$;

revoke all on function public.ktk_heartbeat() from public, anon;
grant execute on function public.ktk_heartbeat() to authenticated;

create or replace function public.ktk_discard_unused_identity()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1 from auth.users
    where id = v_uid and is_anonymous is true
  ) then
    return jsonb_build_object('ok', true, 'already_discarded', true);
  end if;

  if exists (
    select 1 from public.ktk_world_players
    where user_id = v_uid and world_id = 'main' and is_alive is true
  ) then
    raise exception 'ACTIVE_PLAYER_CANNOT_BE_DISCARDED';
  end if;

  perform ktk_private.delete_player_identity(v_uid);
  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.ktk_discard_unused_identity() from public, anon;
grant execute on function public.ktk_discard_unused_identity() to authenticated;


CREATE OR REPLACE FUNCTION ktk_private.expire_stale_players()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_player public.ktk_world_players;
  v_state jsonb;
  v_count integer := 0;
  v_now timestamptz := clock_timestamp();
begin
  -- Heartbeats keep connected players present, including idle players.
  -- A two-minute gap means the browser session was lost.
  perform 1
  from public.ktk_worlds
  where id = 'main'
  for update;

  for v_player in
    select *
    from public.ktk_world_players
    where world_id = 'main'
      and is_alive = true
      and last_seen_at < v_now - interval '2 minutes'
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
      perform ktk_private.delete_player_identity(v_player.user_id);
    end if;
  end loop;

  return v_count;
end;
$function$


CREATE OR REPLACE FUNCTION ktk_private.simulate_player_survival(p_dt double precision)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_player public.ktk_world_players;
  v_state jsonb;
  v_stamina numeric;
  v_satiety numeric;
  v_hydration numeric;
  v_mana numeric;
  v_mana_cap numeric;
  v_health numeric;
  v_temp numeric;
  v_magic_level integer;
  v_selected_slot integer;
  v_is_moving boolean;
  v_is_guarding boolean;
  v_is_running boolean;
  v_has_selected_magic boolean;
  v_has_inventory_magic boolean;
  v_can_regen_mana boolean;
begin
  -- Preserves the coordinator's connected-player filter and row lock order.
  for v_player in
    select * from public.ktk_world_players
    where world_id='main' and is_alive=true and last_seen_at>now()-interval '30 seconds'
    for update skip locked
  loop
    v_state:=coalesce(v_player.state,'{}'::jsonb);
    v_stamina:=greatest(0,coalesce((v_state->>'stamina')::numeric,50));
    v_satiety:=greatest(0,coalesce((v_state->>'satiety')::numeric,99));
    v_hydration:=greatest(0,coalesce((v_state->>'hydration')::numeric,99));
    v_health:=greatest(0,coalesce((v_state->>'health')::numeric,50));
    v_mana:=greatest(0,coalesce((v_state->>'mana')::numeric,0));
    v_magic_level:=greatest(0,coalesce((v_state->>'magic_level')::integer,0));
    v_is_moving:=coalesce((v_state->>'moving')::boolean,false);
    v_is_guarding:=coalesce((v_state->>'guarding')::boolean,false);
    v_is_running:=coalesce((v_state->>'running')::boolean,false) and v_is_moving;

    -- Original rates: walking 1/s, running 2/s, blocking doubles the
    -- movement cost (or costs 2/s while standing still). Recovery stops at 50.
    if v_is_guarding and v_stamina>=0.5 then
      v_stamina:=greatest(0,v_stamina-(case when v_is_moving and v_is_running then 4.0 else 2.0 end)*p_dt);
    elsif v_is_moving and v_is_running then
      v_stamina:=greatest(0,v_stamina-2.0*p_dt);
    elsif v_is_moving then
      v_stamina:=greatest(0,v_stamina-1.0*p_dt);
    elsif v_stamina<50 then
      v_stamina:=least(50,v_stamina+1.0*p_dt);
    end if;

    if v_stamina<0.5 then
      v_is_guarding:=false;
      v_is_running:=false;
    end if;

    v_satiety:=greatest(0,v_satiety-(0.003*p_dt));
    v_hydration:=greatest(0,v_hydration-(0.005*p_dt));
    v_temp:=coalesce((v_state->>'temperature')::numeric,36.5);
    if v_hydration<15 then
      v_temp:=least(38,v_temp+(0.01*p_dt));
    else
      v_temp:=v_temp+(36.5-v_temp)*least(1,0.05*p_dt);
    end if;

    -- Health regenerates only while stationary, with enough stamina and
    -- at least 10 health, exactly as in the existing rules.
    if not v_is_moving and v_stamina>=50 and v_health>=10 and v_health<50 then
      v_health:=least(50,v_health+(0.5*p_dt));
    elsif (v_satiety<=0 or v_hydration<=0) and v_health>0 then
      v_health:=greatest(0,v_health-(0.5*p_dt));
    end if;

    -- Mana follows the existing per-level caps and requirements.
    v_mana_cap:=least(50.0,v_magic_level*10.0);
    v_can_regen_mana:=false;
    if v_magic_level>0 and not v_is_moving and v_mana<v_mana_cap then
      v_selected_slot:=greatest(0,coalesce((v_state->>'selected_slot')::integer,0));
      v_has_selected_magic:=exists(
        select 1
        from jsonb_array_elements(coalesce(v_state->'inventory','[null,null]'::jsonb))
             with ordinality as inv(item,slot_number)
        join ktk_private.item_catalog c on c.item_id=inv.item->>'item_id'
        where inv.slot_number=v_selected_slot+1 and c.item_type='magic'
      );
      v_has_inventory_magic:=exists(
        select 1
        from jsonb_array_elements(coalesce(v_state->'inventory','[null,null]'::jsonb)) as inv(item)
        join ktk_private.item_catalog c on c.item_id=inv.item->>'item_id'
        where c.item_type='magic'
      );

      if v_magic_level=1 then
        v_can_regen_mana:=v_has_selected_magic and v_health>=50 and v_stamina>=50;
      elsif v_magic_level=2 then
        v_can_regen_mana:=v_has_inventory_magic and v_health>=50 and v_stamina>=50;
      elsif v_magic_level=3 then
        v_can_regen_mana:=v_stamina>=50;
      else
        v_can_regen_mana:=true;
      end if;

      if v_can_regen_mana then
        v_mana:=least(v_mana_cap,v_mana+(case when v_magic_level>=8 then 2.0 else 1.0 end)*p_dt);
      end if;
    elsif v_magic_level=0 then
      v_mana:=0;
    end if;

    v_state:=jsonb_set(v_state,'{moving}',to_jsonb(v_is_moving),true);
    v_state:=jsonb_set(v_state,'{running}',to_jsonb(v_is_running),true);
    v_state:=jsonb_set(v_state,'{guarding}',to_jsonb(v_is_guarding),true);
    v_state:=jsonb_set(v_state,'{stamina}',to_jsonb(round(v_stamina,2)),true);
    v_state:=jsonb_set(v_state,'{satiety}',to_jsonb(round(v_satiety,2)),true);
    v_state:=jsonb_set(v_state,'{hydration}',to_jsonb(round(v_hydration,2)),true);
    v_state:=jsonb_set(v_state,'{health}',to_jsonb(round(v_health,2)),true);
    v_state:=jsonb_set(v_state,'{mana}',to_jsonb(round(v_mana,2)),true);
    v_state:=jsonb_set(v_state,'{temperature}',to_jsonb(round(v_temp,2)),true);

    if v_health<=0 then
      perform ktk_private.drop_player_assets(v_player.user_id,v_player.x,v_player.y,v_state);
      v_state:=jsonb_set(v_state,'{inventory}','[null,null]'::jsonb,true);
      v_state:=jsonb_set(v_state,'{wearables}',jsonb_build_object('head',null,'chest',null,'waist',null,'legs',null,'feet',null),true);
      v_state:=jsonb_set(v_state,'{moving}','false'::jsonb,true);
      v_state:=jsonb_set(v_state,'{running}','false'::jsonb,true);
      v_state:=jsonb_set(v_state,'{guarding}','false'::jsonb,true);
      update public.ktk_world_players
      set state=v_state,is_alive=false,last_seen_at=now()
      where user_id=v_player.user_id;
      perform ktk_private.delete_player_identity(v_player.user_id);
    else
      update public.ktk_world_players set state=v_state where user_id=v_player.user_id;
    end if;
  end loop;
end;
$function$


CREATE OR REPLACE FUNCTION public.ktk_leave_world()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_player public.ktk_world_players;
  v_state jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  -- Ordem de locks consistente com a simulação e a expiração automática.
  perform 1 from public.ktk_worlds where id = 'main' for update;

  select * into v_player
  from public.ktk_world_players
  where user_id = v_uid and world_id = 'main'
  for update;

  if not found then
    perform ktk_private.delete_player_identity(v_uid);
    return jsonb_build_object('ok', true, 'already_dead', true);
  end if;
  if not v_player.is_alive then
    perform ktk_private.delete_player_identity(v_uid);
    return jsonb_build_object('ok', true, 'already_dead', true);
  end if;

  v_state := coalesce(v_player.state, '{}'::jsonb);
  perform ktk_private.drop_player_assets(v_uid, v_player.x, v_player.y, v_state);

  v_state := jsonb_set(v_state, '{health}', '0'::jsonb, true);
  v_state := jsonb_set(v_state, '{inventory}', '[null,null]'::jsonb, true);
  v_state := jsonb_set(v_state, '{wearables}',
    '{"head":null,"chest":null,"waist":null,"legs":null,"feet":null}'::jsonb, true);
  v_state := jsonb_set(v_state, '{moving}', 'false'::jsonb, true);
  v_state := jsonb_set(v_state, '{running}', 'false'::jsonb, true);
  v_state := jsonb_set(v_state, '{guarding}', 'false'::jsonb, true);

  update public.ktk_world_players
  set is_alive = false, state = v_state, last_seen_at = clock_timestamp()
  where user_id = v_uid and world_id = 'main';

  perform ktk_private.delete_player_identity(v_uid);

  return jsonb_build_object('ok', true, 'dead', true);
end;
$function$


CREATE OR REPLACE FUNCTION public.ktk_mark_dead()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid:=auth.uid();
  v_player public.ktk_world_players;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform 1 from public.ktk_worlds where id='main' for update;
  select * into v_player
  from public.ktk_world_players
  where user_id=v_uid and world_id='main'
  for update;
  if not found or not v_player.is_alive then
    perform ktk_private.delete_player_identity(v_uid);
    return;
  end if;
  if coalesce((v_player.state->>'health')::numeric,100)>0 then
    raise exception 'SERVER_HEALTH_ABOVE_ZERO';
  end if;

  perform ktk_private.drop_player_assets(v_uid,v_player.x,v_player.y,v_player.state);

  update public.ktk_world_players
  set is_alive=false,
      state=state||jsonb_build_object(
        'health',0,
        'moving',false,
        'running',false,
        'guarding',false,
        'inventory','[null,null]'::jsonb,
        'wearables',jsonb_build_object('head',null,'chest',null,'waist',null,'legs',null,'feet',null)
      ),
      last_seen_at=now()
  where user_id=v_uid and world_id='main';

  perform ktk_private.delete_player_identity(v_uid);
end;
$function$


commit;
