begin;

alter table public.ktk_v2_worlds
  add column if not exists last_simulation_at timestamptz not null default clock_timestamp();

create or replace function ktk_v2_private.apply_player_hit(
  p_target uuid,
  p_raw_damage integer,
  p_knockback_x double precision default 0,
  p_knockback_y double precision default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_player public.ktk_v2_players;
  v_state jsonb;
  v_inventory jsonb;
  v_wearables jsonb;
  v_item jsonb;
  v_item_def public.ktk_v2_item_catalog;
  v_shield_def public.ktk_v2_item_catalog;
  v_armor_def public.ktk_v2_item_catalog;
  v_shield_index integer:=-1;
  v_index integer;
  v_defense integer:=0;
  v_damage integer;
  v_health numeric;
  v_stamina numeric;
  v_armor_cursor integer;
  v_worn_slot text;
  v_worn jsonb;
  v_worn_health numeric;
  v_next_x double precision;
  v_next_y double precision;
  v_blocked boolean:=false;
  v_dead boolean:=false;
  v_now timestamptz:=clock_timestamp();
  v_ttl integer:=900;
begin
  select * into v_player
  from public.ktk_v2_players
  where user_id=p_target and world_id='main' and is_alive
  for update;
  if not found then return jsonb_build_object('active',false); end if;

  v_state:=coalesce(v_player.state,'{}'::jsonb);
  v_inventory:=coalesce(v_state->'inventory','[null,null]'::jsonb);
  v_wearables:=coalesce(v_state->'wearables','{}'::jsonb);
  v_stamina:=greatest(0,coalesce((v_state->>'stamina')::numeric,100));

  select coalesce(sum(c.defense_bonus),0)::integer
  into v_defense
  from jsonb_each(v_wearables) w
  join public.ktk_v2_item_catalog c
    on c.item_id=w.value->>'item_id'
   and c.item_type='armor';

  if coalesce((v_state->>'guarding')::boolean,false) and v_stamina>=2 then
    for v_index in 0..jsonb_array_length(v_inventory)-1 loop
      if v_inventory->v_index='null'::jsonb then continue; end if;
      select * into v_shield_def
      from public.ktk_v2_item_catalog
      where item_id=v_inventory->v_index->>'item_id'
        and item_type='shield';
      if found then
        v_shield_index:=v_index;
        exit;
      end if;
    end loop;

    if v_shield_index>=0 then
      v_item:=v_inventory->v_shield_index;
      v_defense:=v_defense+(2*v_shield_def.defense_bonus);
      v_stamina:=greatest(0,v_stamina-2);
      if v_shield_def.max_durability>0 then
        v_worn_health:=greatest(0,coalesce((v_item->>'durability')::numeric,v_shield_def.max_durability)-1);
        if v_worn_health=0 then
          v_inventory:=jsonb_set(v_inventory,array[v_shield_index::text],'null'::jsonb,true);
        else
          v_inventory:=jsonb_set(v_inventory,array[v_shield_index::text],
            jsonb_set(v_item,'{durability}',to_jsonb(v_worn_health),true),true);
        end if;
      end if;
    else
      v_state:=jsonb_set(v_state,'{guarding}','false'::jsonb,true);
    end if;
  else
    v_state:=jsonb_set(v_state,'{guarding}','false'::jsonb,true);
  end if;

  v_damage:=greatest(1,round(greatest(1,coalesce(p_raw_damage,1))*10.0/(10.0+greatest(0,v_defense)))::integer);
  v_health:=greatest(0,coalesce((v_state->>'health')::numeric,100)-v_damage);

  -- Wear one armor part per confirmed hit, rotating through the five slots.
  v_armor_cursor:=greatest(0,coalesce((v_state->>'armor_damage_cursor')::integer,0))%5;
  for v_index in 0..4 loop
    v_worn_slot:=case ((v_armor_cursor+v_index)%5)
      when 0 then 'head' when 1 then 'chest' when 2 then 'waist' when 3 then 'legs' else 'feet' end;
    v_worn:=v_wearables->v_worn_slot;
    if v_worn is null or v_worn='null'::jsonb then continue; end if;

    select * into v_armor_def
    from public.ktk_v2_item_catalog
    where item_id=v_worn->>'item_id' and item_type='armor';
    if not found or v_armor_def.max_durability<=0 then continue; end if;

    v_worn_health:=greatest(0,coalesce((v_worn->>'durability')::numeric,v_armor_def.max_durability)-1);
    if v_worn_health=0 then
      select greatest(60,least(86400,coalesce((settings->>'loot_ttl_seconds')::integer,900)))
      into v_ttl from public.ktk_v2_worlds where id='main';
      insert into public.ktk_v2_entities(
        world_id,entity_id,entity_type,x,y,collision_radius,state,revision
      ) values (
        'main','drop-'||gen_random_uuid()::text,'item',
        v_player.x+20,v_player.y+18,5,
        jsonb_build_object('status','ground','item_id',v_armor_def.item_id,
          'display_name',v_armor_def.display_name,'quantity',1,
          'durability',0,'max_durability',v_armor_def.max_durability,
          'expires_at',v_now+make_interval(secs=>v_ttl),'dropped_by',p_target::text),1
      );
      v_wearables:=jsonb_set(v_wearables,array[v_worn_slot],'null'::jsonb,true);
    else
      v_wearables:=jsonb_set(v_wearables,array[v_worn_slot],
        jsonb_set(v_worn,'{durability}',to_jsonb(v_worn_health),true),true);
    end if;
    v_state:=jsonb_set(v_state,'{armor_damage_cursor}',to_jsonb((v_armor_cursor+v_index+1)%5),true);
    exit;
  end loop;

  v_state:=jsonb_set(v_state,'{inventory}',v_inventory,true);
  v_state:=jsonb_set(v_state,'{wearables}',v_wearables,true);
  v_state:=jsonb_set(v_state,'{stamina}',to_jsonb(round(v_stamina,2)),true);
  v_state:=jsonb_set(v_state,'{health}',to_jsonb(v_health),true);
  v_state:=jsonb_set(v_state,'{last_knockback}',
    jsonb_build_object('x',coalesce(p_knockback_x,0),'y',coalesce(p_knockback_y,0)),true);
  v_state:=jsonb_set(v_state,'{last_knockback_at}',to_jsonb(v_now),true);

  v_next_x:=v_player.x+sign(coalesce(p_knockback_x,0))*18;
  v_next_y:=v_player.y+sign(coalesce(p_knockback_y,0))*18;
  select exists(
    select 1 from public.ktk_v2_entities e
    where e.world_id='main' and e.entity_type='obstacle'
      and sqrt(power(v_next_x-e.x,2)+power(v_next_y-e.y,2))<18+e.collision_radius
  ) into v_blocked;
  if v_blocked then v_next_x:=v_player.x;v_next_y:=v_player.y; end if;

  v_dead:=v_health<=0;
  if v_dead then
    perform ktk_v2_private.kill_player(p_target,'combat');
    select * into v_player from public.ktk_v2_players where user_id=p_target and world_id='main';
    return jsonb_build_object('active',true,'dead',true,'damage',v_damage,'health',0,'player',to_jsonb(v_player));
  end if;

  update public.ktk_v2_players
  set x=v_next_x,y=v_next_y,state=v_state,
      revision=revision+1,position_updated_at=v_now,movement_updated_at=v_now
  where user_id=p_target and world_id='main'
  returning * into v_player;
  return jsonb_build_object('active',true,'dead',false,'damage',v_damage,
    'health',v_health,'player',to_jsonb(v_player));
end;
$function$;

create or replace function ktk_v2_private.simulation_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_world public.ktk_v2_worlds;
  v_player public.ktk_v2_players;
  v_target public.ktk_v2_players;
  v_enemy public.ktk_v2_entities;
  v_state jsonb;
  v_enemy_state jsonb;
  v_dt double precision;
  v_dx double precision;
  v_dy double precision;
  v_distance double precision;
  v_step double precision;
  v_enemy_x double precision;
  v_enemy_y double precision;
  v_stamina numeric;
  v_satiety numeric;
  v_hydration numeric;
  v_health numeric;
  v_mana numeric;
  v_mana_cap numeric;
  v_magic_level integer;
  v_moving boolean;
  v_running boolean;
  v_guarding boolean;
  v_direction integer;
  v_now timestamptz:=clock_timestamp();
  v_attack_ready timestamptz;
  v_is_target_alive boolean;
begin
  perform pg_catalog.set_config('lock_timeout','750ms',true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ktk-v2:main:movement'));

  select * into v_world
  from public.ktk_v2_worlds where id='main'
  for update;
  if not found then return; end if;

  v_dt:=least(2.0,greatest(0.0,extract(epoch from (v_now-v_world.last_simulation_at))));
  if v_dt<0.1 then return; end if;
  update public.ktk_v2_worlds set last_simulation_at=v_now where id='main';

  -- Expire timed loot and respawn finite world resources independently of players.
  delete from public.ktk_v2_entities
  where world_id='main' and entity_type='item'
    and nullif(state->>'expires_at','') is not null
    and (state->>'expires_at')::timestamptz<=v_now;

  update public.ktk_v2_entities
  set state=(state - 'respawn_at') ||
        jsonb_build_object('status','ready',
          'health',coalesce((state->>'max_health')::numeric,(state->>'health')::numeric,1)),
      revision=revision+1,updated_at=v_now
  where world_id='main' and entity_type='resource'
    and state->>'status'='depleted'
    and nullif(state->>'respawn_at','') is not null
    and (state->>'respawn_at')::timestamptz<=v_now;

  -- Survival values advance on the server for connected characters only.
  -- Paused/suspended clients are not killed merely because their tab is throttled.
  for v_player in
    select * from public.ktk_v2_players
    where world_id='main' and is_alive=true
      and last_seen_at>v_now-interval '30 seconds'
    for update skip locked
  loop
    v_state:=coalesce(v_player.state,'{}'::jsonb);
    v_stamina:=greatest(0,coalesce((v_state->>'stamina')::numeric,100));
    v_satiety:=greatest(0,coalesce((v_state->>'satiety')::numeric,99));
    v_hydration:=greatest(0,coalesce((v_state->>'hydration')::numeric,99));
    v_health:=greatest(0,coalesce((v_state->>'health')::numeric,100));
    v_mana:=greatest(0,coalesce((v_state->>'mana')::numeric,0));
    v_magic_level:=greatest(0,coalesce((v_state->>'magic_level')::integer,0));
    v_moving:=coalesce((v_state->>'moving')::boolean,false);
    v_running:=coalesce((v_state->>'running')::boolean,false) and v_moving;
    v_guarding:=coalesce((v_state->>'guarding')::boolean,false) and not v_moving;

    if v_guarding then
      v_stamina:=greatest(0,v_stamina-2.0*v_dt);
    elsif v_moving and v_running then
      v_stamina:=greatest(0,v_stamina-2.0*v_dt);
    elsif v_moving then
      v_stamina:=greatest(0,v_stamina-1.0*v_dt);
    else
      v_stamina:=least(coalesce((v_state->>'max_stamina')::numeric,100),v_stamina+1.0*v_dt);
    end if;
    if v_stamina<0.5 then
      v_guarding:=false;
      v_running:=false;
    end if;

    v_satiety:=greatest(0,v_satiety-0.003*v_dt);
    v_hydration:=greatest(0,v_hydration-0.005*v_dt);
    if not v_moving and v_stamina>=50 and v_health>=10 and v_health<coalesce((v_state->>'max_health')::numeric,100) then
      v_health:=least(coalesce((v_state->>'max_health')::numeric,100),v_health+0.5*v_dt);
    elsif (v_satiety<=0 or v_hydration<=0) and v_health>0 then
      v_health:=greatest(0,v_health-0.5*v_dt);
    end if;

    v_mana_cap:=least(50.0,v_magic_level*10.0);
    if v_magic_level=0 then
      v_mana:=0;
    elsif not v_moving and v_mana<v_mana_cap then
      v_mana:=least(v_mana_cap,v_mana+(case when v_magic_level>=8 then 2.0 else 1.0 end)*v_dt);
    end if;

    v_state:=jsonb_set(v_state,'{moving}',to_jsonb(v_moving),true);
    v_state:=jsonb_set(v_state,'{running}',to_jsonb(v_running),true);
    v_state:=jsonb_set(v_state,'{guarding}',to_jsonb(v_guarding),true);
    v_state:=jsonb_set(v_state,'{stamina}',to_jsonb(round(v_stamina,2)),true);
    v_state:=jsonb_set(v_state,'{satiety}',to_jsonb(round(v_satiety,2)),true);
    v_state:=jsonb_set(v_state,'{hydration}',to_jsonb(round(v_hydration,2)),true);
    v_state:=jsonb_set(v_state,'{health}',to_jsonb(round(v_health,2)),true);
    v_state:=jsonb_set(v_state,'{mana}',to_jsonb(round(v_mana,2)),true);

    if v_health<=0 then
      perform ktk_v2_private.kill_player(v_player.user_id,'survival');
    else
      update public.ktk_v2_players
      set state=v_state,revision=revision+1
      where user_id=v_player.user_id and world_id='main';
    end if;
  end loop;

  -- The skeleton is a server-owned world entity and only advances while a
  -- connected character is present to give the world an active player target.
  select * into v_enemy
  from public.ktk_v2_entities
  where world_id='main' and entity_id='skeleton-1' and entity_type='enemy'
  for update;

  if found and not coalesce((v_enemy.state->>'defeated')::boolean,false) then
    v_enemy_x:=v_enemy.x;
    v_enemy_y:=v_enemy.y;
    v_enemy_state:=coalesce(v_enemy.state,'{}'::jsonb);
    v_attack_ready:=nullif(v_enemy_state->>'attack_ready_at','')::timestamptz;

    select * into v_target
    from public.ktk_v2_players
    where world_id='main' and is_alive=true
      and last_seen_at>v_now-interval '30 seconds'
    order by sqrt(power(x-v_enemy_x,2)+power(y-v_enemy_y,2))
    limit 1
    for update skip locked;

    if found then
      v_dx:=v_target.x-v_enemy_x;
      v_dy:=v_target.y-v_enemy_y;
      v_distance:=sqrt(power(v_dx,2)+power(v_dy,2));

      if v_distance>48 and v_distance<520 then
        v_step:=least(90.0*v_dt,v_distance-42);
        v_enemy_x:=v_enemy_x+(v_dx/nullif(v_distance,0))*v_step;
        v_enemy_y:=v_enemy_y+(v_dy/nullif(v_distance,0))*v_step;
      end if;

      v_direction:=case
        when abs(v_dx)>abs(v_dy) then case when v_dx<0 then 1 else 3 end
        else case when v_dy<0 then 0 else 2 end
      end;
      v_enemy_state:=v_enemy_state||jsonb_build_object('direction',v_direction);

      if v_distance<=76 and (v_attack_ready is null or v_attack_ready<=v_now) then
        perform ktk_v2_private.apply_player_hit(
          v_target.user_id,greatest(1,coalesce((v_enemy_state->>'attack')::integer,7)),
          case when abs(v_dx)>abs(v_dy) then sign(v_dx) else 0 end,
          case when abs(v_dy)>=abs(v_dx) then sign(v_dy) else 0 end
        );
        v_enemy_state:=jsonb_set(v_enemy_state,'{attack_ready_at}',
          to_jsonb(v_now+interval '1.2 seconds'),true);
        v_enemy_state:=jsonb_set(v_enemy_state,'{attack_started_at}',to_jsonb(v_now),true);
      end if;
    end if;

    update public.ktk_v2_entities
    set x=v_enemy_x,y=v_enemy_y,state=v_enemy_state,
        revision=revision+1,updated_at=v_now
    where world_id='main' and entity_id='skeleton-1';
  end if;
end;
$function$;

revoke all on function ktk_v2_private.apply_player_hit(uuid,integer,double precision,double precision)
  from public,anon,authenticated;
revoke all on function ktk_v2_private.simulation_tick()
  from public,anon,authenticated;

-- V2 owns its own one-second job. V1's jobs are not modified.
do $schedule_v2$
begin
  if pg_catalog.to_regnamespace('cron') is not null then
    execute 'select cron.unschedule(jobid) from cron.job where jobname = ''ktk-v2-world-simulation''';
    execute 'select cron.schedule(''ktk-v2-world-simulation'',''1 second'',''select ktk_v2_private.simulation_tick()'')';
  end if;
end;
$schedule_v2$;

commit;
