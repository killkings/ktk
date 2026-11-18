-- Combat pipeline repair: nullable fist metadata, fresh attacker checkpoints,
-- extrapolated moving targets and knockback from the actual hit-time position.
create or replace function ktk_private.estimate_player_position(
  p_x double precision,
  p_y double precision,
  p_state jsonb,
  p_position_updated_at timestamptz
)
returns table(x double precision,y double precision)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_state jsonb:=coalesce(p_state,'{}'::jsonb);
  v_input_x double precision;
  v_input_y double precision;
  v_input_length double precision;
  v_elapsed double precision;
  v_level double precision;
  v_speed_penalty double precision:=0;
  v_speed double precision;
begin
  if p_x is null or p_y is null then
    return;
  end if;

  v_input_x:=greatest(-1,least(1,coalesce((v_state->>'movement_input_x')::double precision,0)));
  v_input_y:=greatest(-1,least(1,coalesce((v_state->>'movement_input_y')::double precision,0)));
  v_input_length:=sqrt(v_input_x*v_input_x+v_input_y*v_input_y);

  if not coalesce((v_state->>'moving')::boolean,false) or v_input_length<=0 then
    return query select p_x,p_y;
    return;
  end if;

  v_elapsed:=least(0.65,greatest(0,
    extract(epoch from (pg_catalog.clock_timestamp()-coalesce(p_position_updated_at,pg_catalog.clock_timestamp())))
  ));
  if v_elapsed<=0 then
    return query select p_x,p_y;
    return;
  end if;

  select coalesce(sum(greatest(0,coalesce((catalog.metadata->>'speed_penalty')::numeric,0))),0)::double precision
    into v_speed_penalty
  from pg_catalog.jsonb_each(
    case when pg_catalog.jsonb_typeof(v_state->'wearables')='object'
      then v_state->'wearables' else '{}'::jsonb end
  ) as wearable(slot,item)
  join ktk_private.item_catalog catalog on catalog.item_id=wearable.item->>'item_id'
  where coalesce((wearable.item->>'durability')::numeric,0)>0;

  v_level:=case when coalesce((v_state->>'running')::boolean,false) then 3.0 else 2.0 end;
  if coalesce((v_state->>'guarding')::boolean,false) then
    v_level:=v_level*0.5;
  end if;
  v_speed:=225.0*greatest(1.0,v_level-v_speed_penalty)/2.0;

  return query
  select p_x+(v_input_x/v_input_length)*v_speed*v_elapsed,
         p_y+(v_input_y/v_input_length)*v_speed*v_elapsed;
end;
$function$;

revoke all on function ktk_private.estimate_player_position(double precision,double precision,jsonb,timestamp with time zone) from public,anon,authenticated;


CREATE OR REPLACE FUNCTION ktk_private.apply_player_hit(p_target uuid, p_raw_damage integer, p_knockback_x double precision DEFAULT 0, p_knockback_y double precision DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_player public.ktk_world_players; v_state jsonb; v_wearables jsonb; v_inventory jsonb;
  v_shield jsonb; v_shield_def record; v_slot integer; v_shield_index integer:=-1;
  v_defense integer; v_damage integer; v_health integer; v_is_dead boolean:=false;
  v_condition numeric; v_armor_cursor integer; v_worn_slot text; v_worn jsonb; v_worn_def record; v_worn_health integer;
  v_next_x double precision; v_next_y double precision; v_position_at timestamptz;
  v_hit_x double precision; v_hit_y double precision;
  i integer;
begin
  perform 1 from public.ktk_worlds where id='main' for update;
  select * into v_player from public.ktk_world_players
  where user_id=p_target and world_id='main' and is_alive=true for update;
  if not found then return jsonb_build_object('active',false); end if;
  v_state:=coalesce(v_player.state,'{}'::jsonb);
  select position_estimate.x,position_estimate.y
    into v_hit_x,v_hit_y
  from ktk_private.estimate_player_position(
    v_player.x,v_player.y,v_state,v_player.position_updated_at
  ) as position_estimate;
  v_hit_x:=coalesce(v_hit_x,v_player.x);
  v_hit_y:=coalesce(v_hit_y,v_player.y);
  v_wearables:=coalesce(v_state->'wearables','{}'::jsonb);
  v_inventory:=coalesce(v_state->'inventory','[null,null]'::jsonb);
  v_condition:=(
    least(1,greatest(0,coalesce((v_state->>'health')::numeric,50)/greatest(1,coalesce((v_state->>'max_health')::numeric,99))))+
    least(1,greatest(0,coalesce((v_state->>'satiety')::numeric,99)/99.0))+
    least(1,greatest(0,coalesce((v_state->>'hydration')::numeric,99)/99.0))+
    least(1,greatest(0,coalesce((v_state->>'stamina')::numeric,50)/99.0))
  )/4;
  v_defense:=greatest(0,round(coalesce((v_state->>'defense')::numeric,10)*v_condition*2)::integer)
    +ktk_private.player_armor_defense(v_state);

  if coalesce((v_state->>'guarding')::boolean,false)
     and coalesce((v_state->>'stamina')::numeric,0)>=2 then
    for i in 0..jsonb_array_length(v_inventory)-1 loop
      if v_inventory->i<>'null'::jsonb then
        select * into v_shield_def from ktk_private.item_catalog
        where item_id=v_inventory->i->>'item_id' and item_type='shield';
        if found then v_shield:=v_inventory->i; v_shield_index:=i; exit; end if;
      end if;
    end loop;
    if v_shield_index>=0 then
      v_defense:=v_defense+2*greatest(0,coalesce(v_shield_def.defense_bonus,0));
      v_state:=jsonb_set(v_state,'{stamina}',to_jsonb(greatest(0,coalesce((v_state->>'stamina')::numeric,0)-2)),true);
      v_worn_health:=greatest(0,coalesce((v_shield->>'durability')::integer,v_shield_def.max_durability)-1);
      if v_worn_health=0 and v_shield_def.max_durability>0 then
        v_inventory:=jsonb_set(v_inventory,array[v_shield_index::text],'null'::jsonb,true);
      else
        v_inventory:=jsonb_set(v_inventory,array[v_shield_index::text],
          jsonb_set(v_shield,'{durability}',to_jsonb(v_worn_health),true),true);
      end if;
      v_state:=jsonb_set(v_state,'{inventory}',v_inventory,true);
    else
      v_state:=jsonb_set(v_state,'{guarding}','false'::jsonb,true);
    end if;
  else
    v_state:=jsonb_set(v_state,'{guarding}','false'::jsonb,true);
  end if;

  v_damage:=greatest(1,round(greatest(1,p_raw_damage)*10.0/(10.0+greatest(0,v_defense)))::integer);

  -- Wear one armor part per confirmed hit, rotating through the equipped set.
  v_armor_cursor:=greatest(0,coalesce((v_state->>'armor_damage_cursor')::integer,0))%5;
  for i in 0..4 loop
    v_worn_slot:=case ((v_armor_cursor+i)%5)
      when 0 then 'head' when 1 then 'chest' when 2 then 'waist' when 3 then 'legs' else 'feet' end;
    v_worn:=v_wearables->v_worn_slot;
    if v_worn is null or v_worn='null'::jsonb then continue; end if;
    select * into v_worn_def from ktk_private.item_catalog
      where item_id=v_worn->>'item_id' and item_type='armor';
    if not found or v_worn_def.max_durability<=0 then continue; end if;
    v_worn_health:=greatest(0,coalesce((v_worn->>'durability')::integer,v_worn_def.max_durability)-1);
    if v_worn_health=0 then
      insert into public.ktk_world_entities(world_id,entity_id,entity_type,x,y,collision_radius,state,revision)
      values('main','drop-'||gen_random_uuid()::text,'item',v_hit_x+24,v_hit_y+24,0,
        jsonb_build_object('status','ground','item_id',v_worn_def.item_id,'display_name',v_worn_def.display_name,
          'durability',0,'max_durability',v_worn_def.max_durability),1);
      v_wearables:=jsonb_set(v_wearables,array[v_worn_slot],'null'::jsonb,true);
    else
      v_wearables:=jsonb_set(v_wearables,array[v_worn_slot],
        jsonb_set(v_worn,'{durability}',to_jsonb(v_worn_health),true),true);
    end if;
    v_state:=jsonb_set(v_state,'{armor_damage_cursor}',to_jsonb((v_armor_cursor+i+1)%5),true);
    exit;
  end loop;

  v_health:=greatest(0,coalesce((v_state->>'health')::integer,50)-v_damage);
  v_state:=jsonb_set(v_state,'{health}',to_jsonb(v_health),true);
  v_state:=jsonb_set(v_state,'{wearables}',v_wearables,true);
  -- Use one timestamp after the victim row is locked. now() is transaction-start
  -- time and can predate a movement update that committed while this call waited.
  v_position_at:=clock_timestamp();
  v_state:=jsonb_set(v_state,'{last_knockback}',jsonb_build_object('x',coalesce(p_knockback_x,0),'y',coalesce(p_knockback_y,0)),true);
  v_state:=jsonb_set(v_state,'{last_knockback_at}',to_jsonb(v_position_at),true);
  v_next_x:=v_hit_x+sign(coalesce(p_knockback_x,0))*18;
  v_next_y:=v_hit_y+sign(coalesce(p_knockback_y,0))*18;
  -- A hit interrupts extrapolated movement until the browser sends fresh input.
  v_state:=jsonb_set(v_state,'{moving}','false'::jsonb,true);
  v_state:=jsonb_set(v_state,'{running}','false'::jsonb,true);
  v_state:=jsonb_set(v_state,'{movement_input_x}','0'::jsonb,true);
  v_state:=jsonb_set(v_state,'{movement_input_y}','0'::jsonb,true);
  v_state:=jsonb_set(v_state,'{movement_running}','false'::jsonb,true);
  v_is_dead:=v_health<=0;

  if v_is_dead then
    perform ktk_private.drop_player_assets(p_target,v_hit_x,v_hit_y,v_state);
    v_state:=jsonb_set(v_state,'{inventory}','[null,null]'::jsonb,true);
    v_state:=jsonb_set(v_state,'{wearables}',jsonb_build_object('head',null,'chest',null,'waist',null,'legs',null,'feet',null),true);
    v_state:=jsonb_set(v_state,'{guarding}','false'::jsonb,true);
    v_state:=jsonb_set(v_state,'{moving}','false'::jsonb,true);
    v_state:=jsonb_set(v_state,'{running}','false'::jsonb,true);
  end if;

  update public.ktk_world_players set state=v_state,is_alive=not v_is_dead,
    x=case when v_is_dead then v_hit_x else v_next_x end,
    y=case when v_is_dead then v_hit_y else v_next_y end,
    position_updated_at=v_position_at,
    movement_updated_at=v_position_at,
    last_seen_at=case when v_is_dead then v_position_at else last_seen_at end
  where user_id=p_target;

  return jsonb_build_object('active',true,'damage',v_damage,'health',v_health,'dead',v_is_dead,'state',v_state);
end;
$function$;

CREATE OR REPLACE FUNCTION public.ktk_game_action(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid:=auth.uid(); v_player public.ktk_world_players; v_state jsonb; v_inventory jsonb;
  v_direction integer; v_vx double precision; v_vy double precision; v_item_id text;
  v_item jsonb; v_item_def ktk_private.item_catalog%rowtype; v_target record;
  v_attack integer; v_damage integer; v_health integer; v_dead boolean:=false;
  v_weapon_bonus integer:=0; v_range numeric:=0.8; v_cost numeric:=3; v_interval numeric:=0.5;
  v_mana_cost numeric:=0; v_level integer; v_condition numeric; v_multiplier numeric;
  v_guard boolean; v_running boolean; v_moving boolean; v_hit boolean:=false; v_target_kind text; v_target_id text;
  v_result jsonb; v_slot integer; v_i integer; v_ammo_slot integer:=-1; v_ammo jsonb;
  v_projectile_id text; v_projectile_type text; v_projectile_speed numeric;
  v_resource public.ktk_world_entities; v_entity_id text; v_required_tool text; v_efficiency numeric;
  v_remaining numeric; v_item_health integer; v_wearables jsonb; v_stack_slot integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  if p_action in ('intent','guard','magic_level','select_slot') then
    select * into v_player from public.ktk_world_players where user_id=v_uid and world_id='main' and is_alive for update;
    if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;
    v_state:=coalesce(v_player.state,'{}'::jsonb); v_inventory:=coalesce(v_state->'inventory','[null,null]'::jsonb);
    if p_action='magic_level' then
      v_level:=(coalesce((v_state->>'magic_level')::integer,0)+1)%11;
      v_state:=jsonb_set(v_state,'{magic_level}',to_jsonb(v_level),true);
      if v_level=0 then v_state:=jsonb_set(v_state,'{mana}','0'::jsonb,true); end if;
    elsif p_action='select_slot' then
      v_slot:=coalesce((p_payload->>'slot')::integer,-1);
      if v_slot<0 or v_slot>=jsonb_array_length(v_inventory) then raise exception 'INVALID_SLOT'; end if;
      v_state:=jsonb_set(v_state,'{selected_slot}',to_jsonb(v_slot),true);
      if v_inventory->v_slot<>'null'::jsonb then
        select * into v_item_def from ktk_private.item_catalog where item_id=v_inventory->v_slot->>'item_id';
        if found and v_item_def.two_handed then
          v_state:=jsonb_set(v_state,'{guarding}','false'::jsonb,true);
        end if;
      end if;
    else
      v_moving:=coalesce((p_payload->>'moving')::boolean,coalesce((v_state->>'moving')::boolean,false));
      v_running:=coalesce((p_payload->>'running')::boolean,coalesce((v_state->>'running')::boolean,false));
      v_running:=v_running and v_moving;
      v_guard:=case when p_action='guard' then coalesce((p_payload->>'enabled')::boolean,false)
        else coalesce((p_payload->>'guarding')::boolean,coalesce((v_state->>'guarding')::boolean,false)) end;
      if v_guard then
        v_slot:=greatest(0,least(jsonb_array_length(v_inventory)-1,coalesce((v_state->>'selected_slot')::integer,0)));
        if v_inventory->v_slot<>'null'::jsonb then
          select * into v_item_def from ktk_private.item_catalog where item_id=v_inventory->v_slot->>'item_id';
          if found and v_item_def.two_handed then raise exception 'TWO_HANDED_WEAPON_CANNOT_BLOCK'; end if;
        end if;
        if not exists(select 1 from jsonb_array_elements(v_inventory) s join ktk_private.item_catalog c on c.item_id=s->>'item_id' and c.item_type='shield') then raise exception 'SHIELD_REQUIRED'; end if;
        if coalesce((v_state->>'stamina')::numeric,0)<1 then raise exception 'NOT_ENOUGH_STAMINA'; end if;
      end if;
      v_state:=jsonb_set(v_state,'{moving}',to_jsonb(v_moving),true);
      v_state:=jsonb_set(v_state,'{running}',to_jsonb(v_running),true);
      v_state:=jsonb_set(v_state,'{guarding}',to_jsonb(v_guard),true);
    end if;
    update public.ktk_world_players set state=v_state where user_id=v_uid;
    return jsonb_build_object('ok',true,'state',v_state);

  elsif p_action='attack' then
    -- Preserve the world -> player lock order used by the simulation and damage pipeline.
    perform 1 from public.ktk_worlds where id='main' for update;
    select * into v_player from public.ktk_world_players where user_id=v_uid and world_id='main' and is_alive for update;
    if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;
    v_state:=coalesce(v_player.state,'{}'::jsonb); v_inventory:=coalesce(v_state->'inventory','[null,null]'::jsonb);
    v_direction:=coalesce((p_payload->>'direction')::integer,-1);
    if v_direction not between 0 and 3 then raise exception 'INVALID_DIRECTION'; end if;
    v_vx:=case v_direction when 1 then -1 when 3 then 1 else 0 end;
    v_vy:=case v_direction when 0 then -1 when 2 then 1 else 0 end;
    v_item_id:=nullif(p_payload->>'weapon_id','');
    v_level:=greatest(0,coalesce((v_state->>'magic_level')::integer,0));
    if v_item_id='level-six-innate-magic' then
      if v_level<6 then raise exception 'MAGIC_LEVEL_TOO_LOW'; end if;
      select * into v_item_def from ktk_private.item_catalog where item_id=v_item_id;
      v_weapon_bonus:=6; v_range:=3.5; v_mana_cost:=case when v_level>=9 then 5 else 10 end;
      v_cost:=case when v_level>=10 then 0 else 1.5 end;
    elsif v_item_id is not null then
      if not exists(select 1 from jsonb_array_elements(v_inventory) s where s->>'item_id'=v_item_id) then raise exception 'ITEM_NOT_OWNED'; end if;
      select * into v_item_def from ktk_private.item_catalog where item_id=v_item_id;
      if not found or v_item_def.item_type not in ('weapon','tool') then raise exception 'INVALID_MELEE_WEAPON'; end if;
      v_weapon_bonus:=v_item_def.attack_bonus; v_range:=greatest(0.8,v_item_def.range_tiles);
      v_cost:=greatest(1,v_item_def.stamina_cost); v_interval:=greatest(0.3,v_item_def.attack_interval);
    end if;
    if nullif(v_state->>'next_attack_at','') is not null and (v_state->>'next_attack_at')::timestamptz>now() then raise exception 'ATTACK_COOLDOWN'; end if;
    if coalesce((v_state->>'stamina')::numeric,50)<v_cost then raise exception 'NOT_ENOUGH_STAMINA'; end if;
    if coalesce((v_state->>'mana')::numeric,0)<v_mana_cost then raise exception 'NOT_ENOUGH_MANA'; end if;
    v_state:=jsonb_set(v_state,'{stamina}',to_jsonb(greatest(0,coalesce((v_state->>'stamina')::numeric,50)-v_cost)),true);
    v_state:=jsonb_set(v_state,'{mana}',to_jsonb(greatest(0,coalesce((v_state->>'mana')::numeric,0)-v_mana_cost)),true);
    v_state:=jsonb_set(v_state,'{next_attack_at}',to_jsonb(now()+make_interval(secs=>v_interval::double precision)),true);
    v_state:=jsonb_set(v_state,'{last_attack_at}',to_jsonb(now()),true);
    v_state:=jsonb_set(v_state,'{last_attack_direction}',to_jsonb(v_direction),true);
    v_state:=jsonb_set(v_state,'{last_attack_type}',to_jsonb(case when v_item_id is null then 'punch' else coalesce(nullif(v_item_def.metadata->>'attack_type',''),'slash') end),true);
    v_state:=jsonb_set(v_state,'{last_attack_weapon_id}',coalesce(to_jsonb(v_item_id),'null'::jsonb),true);
    v_condition:=(
      least(1,greatest(0,coalesce((v_state->>'health')::numeric,50)/greatest(1,coalesce((v_state->>'max_health')::numeric,99))))+
      least(1,greatest(0,coalesce((v_state->>'satiety')::numeric,99)/99.0))+
      least(1,greatest(0,coalesce((v_state->>'hydration')::numeric,99)/99.0))+
      least(1,greatest(0,coalesce((v_state->>'stamina')::numeric,50)/99.0))
    )/4;
    v_multiplier:=v_condition*2;
    v_attack:=greatest(1,round((coalesce((v_state->>'attack')::numeric,10)+v_weapon_bonus)*v_multiplier)::integer);

    with candidates as (
      select 'player'::text kind,p.user_id::text target_id,position_estimate.x,position_estimate.y,
        sqrt(power(position_estimate.x-v_player.x,2)+power(position_estimate.y-v_player.y,2)) distance,
        ((position_estimate.x-v_player.x)*v_vx+(position_estimate.y-v_player.y)*v_vy) forward,
        abs((position_estimate.x-v_player.x)*v_vy-(position_estimate.y-v_player.y)*v_vx) sideways
      from public.ktk_world_players p
      cross join lateral ktk_private.estimate_player_position(
        p.x,p.y,p.state,p.position_updated_at
      ) as position_estimate
      join public.ktk_profiles a on a.id=v_uid join public.ktk_profiles b on b.id=p.user_id
      where p.world_id='main' and p.is_alive and p.user_id<>v_uid
        and p.last_seen_at>now()-interval '30 seconds'
        and not(a.clan_color is not null and a.clan_color=b.clan_color)
      union all
      select 'enemy',e.entity_id,e.x,e.y,
        sqrt(power(e.x-v_player.x,2)+power(e.y-v_player.y,2)),
        ((e.x-v_player.x)*v_vx+(e.y-v_player.y)*v_vy),
        abs((e.x-v_player.x)*v_vy-(e.y-v_player.y)*v_vx)
      from public.ktk_world_entities e where e.world_id='main' and e.entity_type='enemy'
        and not coalesce((e.state->>'defeated')::boolean,false)
    )
    select * into v_target from candidates
    where forward>0 and forward<=(v_range*72+18) and sideways<=32 order by distance limit 1;

    if found then
      v_hit:=true; v_target_kind:=v_target.kind; v_target_id:=v_target.target_id;
      if v_target_kind='player' then
        v_result:=ktk_private.apply_player_hit(v_target_id::uuid,v_attack,v_vx,v_vy);
        v_damage:=coalesce((v_result->>'damage')::integer,0);
        v_health:=coalesce((v_result->>'health')::integer,0);
        v_dead:=coalesce((v_result->>'dead')::boolean,false);
      else
        select greatest(0,coalesce((state->>'defense')::integer,6)),
               greatest(0,coalesce((state->>'health')::integer,60))
          into v_slot,v_health from public.ktk_world_entities where world_id='main' and entity_id=v_target_id;
        v_damage:=greatest(1,round(v_attack*10.0/(10.0+coalesce(v_slot,6)))::integer);
        if v_item_id='level-six-innate-magic' and v_level>=7 then v_damage:=v_damage*2; end if;
        update public.ktk_world_entities set
          x=x+v_vx*18,y=y+v_vy*18,
          state=state||jsonb_build_object('health',greatest(0,v_health-v_damage),
            'defeated',(v_health-v_damage)<=0,'last_hit_by',v_uid::text),
          revision=revision+1,updated_at=now()
        where world_id='main' and entity_id=v_target_id;
        v_health:=greatest(0,v_health-v_damage); v_dead:=v_health=0;
      end if;
      if v_item_id is not null and v_item_id<>'level-six-innate-magic'
         and v_item_def.max_durability>0 and v_item_def.durability_unit<>'blocks' then
        for v_i in 0..jsonb_array_length(v_inventory)-1 loop
          if v_inventory->v_i->>'item_id'=v_item_id then
            v_item:=v_inventory->v_i;
            v_item_health:=greatest(0,coalesce((v_item->>'durability')::integer,v_item_def.max_durability)-1);
            if v_item_health=0 then v_inventory:=jsonb_set(v_inventory,array[v_i::text],'null'::jsonb,true);
            else v_inventory:=jsonb_set(v_inventory,array[v_i::text],jsonb_set(v_item,'{durability}',to_jsonb(v_item_health),true),true); end if;
            exit;
          end if;
        end loop;
        v_state:=jsonb_set(v_state,'{inventory}',v_inventory,true);
      end if;
    end if;
    update public.ktk_world_players set state=v_state where user_id=v_uid;
    return jsonb_build_object('ok',true,'hit',v_hit,'target_type',v_target_kind,'target_id',v_target_id,
      'damage',coalesce(v_damage,0),'target_health',v_health,'target_dead',v_dead,'state',v_state,'target_state',v_result);

  elsif p_action='launch_projectile' then
    select * into v_player from public.ktk_world_players where user_id=v_uid and world_id='main' and is_alive for update;
    if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;
    v_state:=coalesce(v_player.state,'{}'::jsonb); v_inventory:=coalesce(v_state->'inventory','[null,null]'::jsonb);
    v_direction:=coalesce((p_payload->>'direction')::integer,-1);
    if v_direction not between 0 and 3 then raise exception 'INVALID_DIRECTION'; end if;
    v_item_id:=left(coalesce(p_payload->>'weapon_id',''),100);
    select * into v_item_def from ktk_private.item_catalog where item_id=v_item_id;
    if not found or v_item_def.item_type not in ('ranged','magic') then raise exception 'INVALID_PROJECTILE_WEAPON'; end if;
    v_level:=greatest(0,coalesce((v_state->>'magic_level')::integer,0));
    if v_item_id='level-six-innate-magic' then
      if v_level<6 then raise exception 'MAGIC_LEVEL_TOO_LOW'; end if;
      v_cost:=case when v_level>=10 then 0 else 1.5 end;
      v_mana_cost:=case when v_level>=9 then 5 else 10 end;
    else
      if not exists(select 1 from jsonb_array_elements(v_inventory) s where s->>'item_id'=v_item_id) then raise exception 'ITEM_NOT_OWNED'; end if;
      v_cost:=greatest(1,v_item_def.stamina_cost);
      v_mana_cost:=coalesce((v_item_def.metadata->>'mana_cost')::numeric,0);
    end if;
    if nullif(v_state->>'next_attack_at','') is not null and (v_state->>'next_attack_at')::timestamptz>now() then raise exception 'ATTACK_COOLDOWN'; end if;
    if coalesce((v_state->>'stamina')::numeric,50)<v_cost then raise exception 'NOT_ENOUGH_STAMINA'; end if;
    if coalesce((v_state->>'mana')::numeric,0)<v_mana_cost then raise exception 'NOT_ENOUGH_MANA'; end if;
    if coalesce(v_item_def.metadata->>'ammo','')='stone' or v_item_id='equipment-slingshot' then
      v_ammo_slot:=-1;
      for v_i in 0..jsonb_array_length(v_inventory)-1 loop
        if v_inventory->v_i->>'item_id'='resource-stone' then v_ammo_slot:=v_i; exit; end if;
      end loop;
      if v_ammo_slot<0 then raise exception 'STONE_AMMO_REQUIRED'; end if;
      v_ammo:=v_inventory->v_ammo_slot;
      v_item_health:=greatest(1,coalesce((v_ammo->>'quantity')::integer,1))-1;
      if v_item_health=0 then v_inventory:=jsonb_set(v_inventory,array[v_ammo_slot::text],'null'::jsonb,true);
      else v_inventory:=jsonb_set(v_inventory,array[v_ammo_slot::text],jsonb_set(v_ammo,'{quantity}',to_jsonb(v_item_health),true),true); end if;
    elsif v_item_def.metadata ? 'ammo' then
      v_ammo_slot:=-1;
      for v_i in 0..jsonb_array_length(v_inventory)-1 loop
        if v_inventory->v_i->>'item_id' in ('equipment-arrow','equipment-arrow-2') then v_ammo_slot:=v_i; exit; end if;
      end loop;
      if v_ammo_slot<0 then raise exception 'AMMO_REQUIRED'; end if;
      v_ammo:=v_inventory->v_ammo_slot;
      v_item_health:=greatest(1,coalesce((v_ammo->>'quantity')::integer,1))-1;
      if v_item_health=0 then v_inventory:=jsonb_set(v_inventory,array[v_ammo_slot::text],'null'::jsonb,true);
      else v_inventory:=jsonb_set(v_inventory,array[v_ammo_slot::text],jsonb_set(v_ammo,'{quantity}',to_jsonb(v_item_health),true),true); end if;
    end if;
    v_state:=jsonb_set(v_state,'{stamina}',to_jsonb(greatest(0,coalesce((v_state->>'stamina')::numeric,50)-v_cost)),true);
    v_state:=jsonb_set(v_state,'{mana}',to_jsonb(greatest(0,coalesce((v_state->>'mana')::numeric,0)-v_mana_cost)),true);
    v_state:=jsonb_set(v_state,'{inventory}',v_inventory,true);
    v_state:=jsonb_set(v_state,'{next_attack_at}',to_jsonb(now()+make_interval(secs=>greatest(0.3,v_item_def.attack_interval)::double precision)),true);
    v_state:=jsonb_set(v_state,'{last_attack_at}',to_jsonb(now()),true);
    v_state:=jsonb_set(v_state,'{last_attack_direction}',to_jsonb(v_direction),true);
    v_state:=jsonb_set(v_state,'{last_attack_type}',to_jsonb(coalesce(nullif(v_item_def.metadata->>'attack_type',''),'shoot')),true);
    v_state:=jsonb_set(v_state,'{last_attack_weapon_id}',to_jsonb(v_item_id),true);
    v_vx:=case v_direction when 1 then -1 when 3 then 1 else 0 end;
    v_vy:=case v_direction when 0 then -1 when 2 then 1 else 0 end;
    v_projectile_type:=case when v_item_id='equipment-boomerang' then 'boomerang' when v_item_id='equipment-slingshot' then 'stone' when v_item_def.item_type='magic' then 'magic' else 'arrow' end;
    v_projectile_speed:=case v_projectile_type when 'arrow' then case when v_item_id='equipment-crossbow' then 840 else 720 end when 'stone' then 600 when 'boomerang' then 480 else 620 end;
    v_projectile_id:='projectile-'||gen_random_uuid()::text;
    insert into public.ktk_world_entities(world_id,entity_id,entity_type,x,y,collision_radius,state,revision)
    values('main',v_projectile_id,'projectile',v_player.x+v_vx*18,v_player.y+v_vy*18,6,
      jsonb_build_object('owner_id',v_uid::text,'weapon_id',v_item_id,'projectile_type',v_projectile_type,'vector_x',v_vx,'vector_y',v_vy,
        'speed',v_projectile_speed,'max_distance',v_item_def.range_tiles*72,'distance',0,
        'damage',greatest(1,round((coalesce((v_state->>'attack')::numeric,10)+v_item_def.attack_bonus)*
          case when v_item_id='level-six-innate-magic' and v_level>=7 then 2 else 1 end)::integer),
        'direction',v_direction,'phase','outbound','created_at',now(),'ttl',15),1);
    if v_item_id<>'level-six-innate-magic' and v_item_def.max_durability>0
       and v_item_def.durability_unit is not null then
      for v_i in 0..jsonb_array_length(v_inventory)-1 loop
        if v_inventory->v_i->>'item_id'=v_item_id then
          v_item:=v_inventory->v_i;
          v_item_health:=greatest(0,coalesce((v_item->>'durability')::integer,v_item_def.max_durability)-1);
          if v_item_health=0 then
            v_inventory:=jsonb_set(v_inventory,array[v_i::text],'null'::jsonb,true);
          else
            v_inventory:=jsonb_set(v_inventory,array[v_i::text],jsonb_set(v_item,'{durability}',to_jsonb(v_item_health),true),true);
          end if;
          exit;
        end if;
      end loop;
      v_state:=jsonb_set(v_state,'{inventory}',v_inventory,true);
    end if;
    update public.ktk_world_players set state=v_state where user_id=v_uid;
    return jsonb_build_object('ok',true,'projectile_id',v_projectile_id,'state',v_state);

  elsif p_action='pickup' then
    select * into v_player from public.ktk_world_players
    where user_id=v_uid and world_id='main' and is_alive for update;
    if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;
    v_state:=coalesce(v_player.state,'{}'::jsonb);
    v_inventory:=coalesce(v_state->'inventory','[null,null]'::jsonb);
    v_wearables:=coalesce(v_state->'wearables','{}'::jsonb);
    v_entity_id:=left(coalesce(p_payload->>'entity_id',''),120);
    select * into v_resource from public.ktk_world_entities
      where world_id='main' and entity_id=v_entity_id and entity_type='item' for update;
    if not found or coalesce(v_resource.state->>'status','ground')<>'ground' then raise exception 'ITEM_NOT_AVAILABLE'; end if;
    if sqrt(power(v_player.x-v_resource.x,2)+power(v_player.y-v_resource.y,2))>64 then raise exception 'ITEM_TOO_FAR'; end if;
    v_item_id:=v_resource.state->>'item_id';
    if v_item_id='king-crown' then return public.ktk_game_action_legacy(p_action,p_payload); end if;
    select * into v_item_def from ktk_private.item_catalog where item_id=v_item_id;
    if not found then raise exception 'UNKNOWN_ITEM'; end if;
    v_item:=jsonb_build_object(
      'item_id',v_item_id,'display_name',v_item_def.display_name,
      'durability',coalesce((v_resource.state->>'durability')::integer,v_item_def.max_durability),
      'max_durability',v_item_def.max_durability,
      'quantity',greatest(1,coalesce((v_resource.state->>'quantity')::integer,1))
    );
    if coalesce((v_item_def.metadata->>'stackable')::boolean,false) then
      v_stack_slot:=-1;
      for v_i in 0..jsonb_array_length(v_inventory)-1 loop
        if v_inventory->v_i->>'item_id'=v_item_id then v_stack_slot:=v_i; exit; end if;
      end loop;
      if v_stack_slot>=0 then
        v_item:=jsonb_set(v_inventory->v_stack_slot,'{quantity}',
          to_jsonb(least(99,coalesce((v_inventory->v_stack_slot->>'quantity')::integer,1)+coalesce((v_item->>'quantity')::integer,1))),true);
        v_inventory:=jsonb_set(v_inventory,array[v_stack_slot::text],v_item,true);
      else
        v_slot:=-1;
        for v_i in 0..jsonb_array_length(v_inventory)-1 loop
          if v_inventory->v_i='null'::jsonb then v_slot:=v_i; exit; end if;
        end loop;
        if v_slot<0 then raise exception 'INVENTORY_FULL'; end if;
        v_inventory:=jsonb_set(v_inventory,array[v_slot::text],v_item,true);
      end if;
    elsif v_item_def.wear_slot is not null and coalesce(v_wearables->v_item_def.wear_slot,'null'::jsonb)='null'::jsonb then
      v_wearables:=jsonb_set(v_wearables,array[v_item_def.wear_slot],v_item,true);
    else
      v_slot:=-1;
      for v_i in 0..jsonb_array_length(v_inventory)-1 loop
        if v_inventory->v_i='null'::jsonb then v_slot:=v_i; exit; end if;
      end loop;
      if v_slot<0 then raise exception 'INVENTORY_FULL'; end if;
      v_inventory:=jsonb_set(v_inventory,array[v_slot::text],v_item,true);
    end if;
    delete from public.ktk_world_entities where world_id='main' and entity_id=v_entity_id;
    v_state:=jsonb_set(v_state,'{inventory}',v_inventory,true);
    v_state:=jsonb_set(v_state,'{wearables}',v_wearables,true);
    update public.ktk_world_players set state=v_state where user_id=v_uid;
    return jsonb_build_object('ok',true,'state',v_state,'collected',v_item_id);

  elsif p_action='harvest' then
    select * into v_player from public.ktk_world_players where user_id=v_uid and world_id='main' and is_alive for update;
    if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;
    v_state:=coalesce(v_player.state,'{}'::jsonb); v_inventory:=coalesce(v_state->'inventory','[null,null]'::jsonb);
    v_entity_id:=left(coalesce(p_payload->>'entity_id',''),120);
    select * into v_resource from public.ktk_world_entities where world_id='main' and entity_id=v_entity_id and entity_type='resource' for update;
    if not found then raise exception 'RESOURCE_NOT_FOUND'; end if;
    if coalesce(v_resource.state->>'status','ready')<>'ready' then raise exception 'RESOURCE_DEPLETED'; end if;
    if sqrt(power(v_player.x-v_resource.x,2)+power(v_player.y-v_resource.y,2))>80 then raise exception 'RESOURCE_TOO_FAR'; end if;
    v_required_tool:=nullif(v_resource.state->>'required_tool',''); v_efficiency:=1;
    if v_required_tool is not null then
      v_slot:=-1;
      for v_i in 0..jsonb_array_length(v_inventory)-1 loop if v_inventory->v_i->>'item_id'=v_required_tool then v_slot:=v_i; exit; end if; end loop;
      if v_slot<0 then raise exception 'REQUIRED_TOOL_MISSING'; end if;
      select * into v_item_def from ktk_private.item_catalog where item_id=v_required_tool;
      v_item:=v_inventory->v_slot; v_efficiency:=greatest(1,coalesce((v_item_def.metadata->>'work_efficiency')::numeric,1));
      v_item_health:=greatest(0,coalesce((v_item->>'durability')::integer,v_item_def.max_durability)-1);
      if v_item_health=0 then v_inventory:=jsonb_set(v_inventory,array[v_slot::text],'null'::jsonb,true);
      else v_inventory:=jsonb_set(v_inventory,array[v_slot::text],jsonb_set(v_item,'{durability}',to_jsonb(v_item_health),true),true); end if;
    end if;
    if coalesce((v_state->>'stamina')::numeric,0)<2 then raise exception 'NOT_ENOUGH_STAMINA'; end if;
    v_state:=jsonb_set(v_state,'{stamina}',to_jsonb(greatest(0,coalesce((v_state->>'stamina')::numeric,0)-2)),true);
    v_state:=jsonb_set(v_state,'{inventory}',v_inventory,true);
    v_remaining:=greatest(0,coalesce((v_resource.state->>'health')::numeric,1)-v_efficiency);
    if v_remaining<=0 then
      update public.ktk_world_entities set state=state||jsonb_build_object('status','depleted','health',0,'depleted_at',now()),revision=revision+1,updated_at=now() where world_id='main' and entity_id=v_entity_id;
      insert into public.ktk_world_entities(world_id,entity_id,entity_type,x,y,collision_radius,state,revision)
      values('main','drop-'||gen_random_uuid()::text,'item',v_resource.x+24,v_resource.y+12,0,
        jsonb_build_object('status','ground','item_id',v_resource.state->>'drop_item_id','quantity',greatest(1,coalesce((v_resource.state->>'drop_quantity')::integer,1))),1);
    else
      update public.ktk_world_entities set state=state||jsonb_build_object('health',v_remaining),revision=revision+1,updated_at=now() where world_id='main' and entity_id=v_entity_id;
    end if;
    update public.ktk_world_players set state=v_state where user_id=v_uid;
    return jsonb_build_object('ok',true,'depleted',v_remaining<=0,'remaining_health',v_remaining,'state',v_state);

  elsif p_action='consume' then
    select * into v_player from public.ktk_world_players where user_id=v_uid and world_id='main' and is_alive for update;
    if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;
    v_state:=coalesce(v_player.state,'{}'::jsonb); v_inventory:=coalesce(v_state->'inventory','[null,null]'::jsonb);
    v_slot:=coalesce((p_payload->>'slot')::integer,-1);
    if v_slot<0 or v_slot>=jsonb_array_length(v_inventory) then raise exception 'INVALID_SLOT'; end if;
    v_item:=v_inventory->v_slot;
    select * into v_item_def from ktk_private.item_catalog where item_id=v_item->>'item_id';
    if not found or v_item_def.item_type not in ('food','drink') then raise exception 'NOT_CONSUMABLE'; end if;
    if v_item_def.item_type='food' then v_state:=jsonb_set(v_state,'{satiety}',to_jsonb(least(99,coalesce((v_state->>'satiety')::numeric,0)+coalesce((v_item_def.metadata->>'satiety')::numeric,0))),true); end if;
    if v_item_def.item_type='drink' then v_state:=jsonb_set(v_state,'{hydration}',to_jsonb(least(99,coalesce((v_state->>'hydration')::numeric,0)+coalesce((v_item_def.metadata->>'hydration')::numeric,0))),true); end if;
    v_item_health:=greatest(1,coalesce((v_item->>'quantity')::integer,1))-1;
    if v_item_health=0 then v_inventory:=jsonb_set(v_inventory,array[v_slot::text],'null'::jsonb,true);
    else v_inventory:=jsonb_set(v_inventory,array[v_slot::text],jsonb_set(v_item,'{quantity}',to_jsonb(v_item_health),true),true); end if;
    v_state:=jsonb_set(v_state,'{inventory}',v_inventory,true);
    update public.ktk_world_players set state=v_state where user_id=v_uid;
    return jsonb_build_object('ok',true,'state',v_state);
  end if;

  return public.ktk_game_action_legacy(p_action,p_payload);
end;
$function$;

CREATE OR REPLACE FUNCTION ktk_private.projectile_tick()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_p public.ktk_world_entities;
  v_owner public.ktk_world_players;
  v_proj jsonb;
  v_dt double precision;
  v_speed double precision;
  v_dx double precision;
  v_dy double precision;
  v_len double precision;
  v_end_x double precision;
  v_end_y double precision;
  v_travel double precision;
  v_distance double precision;
  v_max_distance double precision;
  v_t double precision;
  v_player_id uuid;
  v_hit record;
  v_owner_profile public.ktk_profiles;
  v_result jsonb;
  v_target_health integer;
  v_damage integer;
  v_kind text;
  v_type text;
  v_owner_id uuid;
begin
  for v_p in
    select * from public.ktk_world_entities
    where world_id='main' and entity_type='projectile'
    order by updated_at
    for update skip locked
  loop
    v_proj:=v_p.state;
    v_owner_id:=nullif(v_proj->>'owner_id','')::uuid;
    v_type:=coalesce(v_proj->>'projectile_type','arrow');
    v_speed:=greatest(1,coalesce((v_proj->>'speed')::double precision,600));
    v_max_distance:=greatest(1,coalesce((v_proj->>'max_distance')::double precision,160));
    v_distance:=greatest(0,coalesce((v_proj->>'distance')::double precision,0));
    v_dt:=least(1.5,greatest(0.05,extract(epoch from (now()-v_p.updated_at))));
    if coalesce((v_proj->>'ttl')::numeric,15)<=0
       or coalesce((v_proj->>'created_at')::timestamptz,now())<now()-interval '20 seconds' then
      delete from public.ktk_world_entities where world_id='main' and entity_id=v_p.entity_id;
      continue;
    end if;

    if v_proj->>'phase'='returning' and v_type='boomerang' then
      select * into v_owner from public.ktk_world_players where user_id=v_owner_id and world_id='main' and is_alive for update;
      if not found then
        delete from public.ktk_world_entities where world_id='main' and entity_id=v_p.entity_id;
        continue;
      end if;
      v_dx:=v_owner.x-v_p.x; v_dy:=v_owner.y-v_p.y; v_len:=sqrt(v_dx*v_dx+v_dy*v_dy);
      v_travel:=v_speed*v_dt;
      if v_len<=v_travel+12 then
        delete from public.ktk_world_entities where world_id='main' and entity_id=v_p.entity_id;
      else
        update public.ktk_world_entities set x=v_p.x+(v_dx/v_len)*v_travel,y=v_p.y+(v_dy/v_len)*v_travel,
          state=state||jsonb_build_object('distance',v_distance+v_travel),revision=revision+1,updated_at=now()
        where world_id='main' and entity_id=v_p.entity_id;
      end if;
      continue;
    end if;

    v_dx:=coalesce((v_proj->>'vector_x')::double precision,0);
    v_dy:=coalesce((v_proj->>'vector_y')::double precision,0);
    v_len:=sqrt(v_dx*v_dx+v_dy*v_dy);
    if v_len<=0 then
      delete from public.ktk_world_entities where world_id='main' and entity_id=v_p.entity_id;
      continue;
    end if;
    v_travel:=least(v_speed*v_dt,greatest(0,v_max_distance-v_distance));
    v_end_x:=v_p.x+(v_dx/v_len)*v_travel;
    v_end_y:=v_p.y+(v_dy/v_len)*v_travel;

    with points as (
      select 'player'::text kind,p.user_id::text target_id,
        position_estimate.x,position_estimate.y,
        greatest(0,least(1,((position_estimate.x-v_p.x)*(v_end_x-v_p.x)+(position_estimate.y-v_p.y)*(v_end_y-v_p.y))/
          greatest(0.0001,power(v_end_x-v_p.x,2)+power(v_end_y-v_p.y,2)))) t
      from public.ktk_world_players p
      cross join lateral ktk_private.estimate_player_position(
        p.x,p.y,p.state,p.position_updated_at
      ) as position_estimate
      join public.ktk_profiles target_profile on target_profile.id=p.user_id
      left join public.ktk_profiles owner_profile on owner_profile.id=v_owner_id
      where p.world_id='main' and p.is_alive and p.user_id<>v_owner_id
        and p.last_seen_at>now()-interval '30 seconds'
        and not(owner_profile.clan_color is not null and owner_profile.clan_color=target_profile.clan_color)
      union all
      select 'enemy',e.entity_id,e.x,e.y,
        greatest(0,least(1,((e.x-v_p.x)*(v_end_x-v_p.x)+(e.y-v_p.y)*(v_end_y-v_p.y))/
          greatest(0.0001,power(v_end_x-v_p.x,2)+power(v_end_y-v_p.y,2)))) t
      from public.ktk_world_entities e
      where e.world_id='main' and e.entity_type='enemy'
        and not coalesce((e.state->>'defeated')::boolean,false)
    )
    select kind,target_id,x,y,t,
      sqrt(power(x-(v_p.x+(v_end_x-v_p.x)*t),2)+power(y-(v_p.y+(v_end_y-v_p.y)*t),2)) distance
    into v_hit from points
    where sqrt(power(x-(v_p.x+(v_end_x-v_p.x)*t),2)+power(y-(v_p.y+(v_end_y-v_p.y)*t),2))<=24
    order by t limit 1;

    if found then
      v_damage:=greatest(1,coalesce((v_proj->>'damage')::integer,5));
      if v_hit.kind='player' then
        v_result:=ktk_private.apply_player_hit(v_hit.target_id::uuid,v_damage,
          sign(v_dx)::double precision,sign(v_dy)::double precision);
      else
        select greatest(0,coalesce((state->>'health')::integer,60)) into v_target_health
        from public.ktk_world_entities where world_id='main' and entity_id=v_hit.target_id;
        update public.ktk_world_entities set
          x=x+(v_dx/v_len)*18,y=y+(v_dy/v_len)*18,
          state=state||jsonb_build_object(
            'health',greatest(0,v_target_health-v_damage),'defeated',(v_target_health-v_damage)<=0,
            'last_hit_by',v_owner_id::text),revision=revision+1,updated_at=now()
        where world_id='main' and entity_id=v_hit.target_id;
      end if;
      if v_type='boomerang' then
        update public.ktk_world_entities set x=v_p.x+(v_end_x-v_p.x)*v_hit.t,y=v_p.y+(v_end_y-v_p.y)*v_hit.t,
          state=state||jsonb_build_object('phase','returning','distance',v_distance+v_travel*v_hit.t),
          revision=revision+1,updated_at=now() where world_id='main' and entity_id=v_p.entity_id;
      else
        delete from public.ktk_world_entities where world_id='main' and entity_id=v_p.entity_id;
      end if;
      continue;
    end if;

    if v_distance+v_travel>=v_max_distance then
      if v_type='boomerang' then
        update public.ktk_world_entities set x=v_end_x,y=v_end_y,
          state=state||jsonb_build_object('distance',v_max_distance,'phase','returning'),
          revision=revision+1,updated_at=now()
        where world_id='main' and entity_id=v_p.entity_id;
      else
        delete from public.ktk_world_entities where world_id='main' and entity_id=v_p.entity_id;
      end if;
    else
      update public.ktk_world_entities set x=v_end_x,y=v_end_y,
        state=state||jsonb_build_object('distance',v_distance+v_travel),
        revision=revision+1,updated_at=now()
      where world_id='main' and entity_id=v_p.entity_id;
    end if;
  end loop;
end;
$function$;
