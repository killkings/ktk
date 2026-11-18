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
  v_wear_slot text; v_old_wearable jsonb; v_old_wearable_id text; v_drop_direction integer;
  v_drop_x double precision; v_drop_y double precision; v_king_user_id uuid;
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
        and not (
          p.user_id = (select w.king_user_id from public.ktk_worlds w where w.id='main')
          and a.clan_color is not null
          and a.clan_color=b.clan_color
        )
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
    -- Ordem de bloqueio estável: mundo -> jogador -> item.
    perform 1 from public.ktk_worlds where id='main' for update;
    if not found then raise exception 'WORLD_NOT_FOUND'; end if;
    select * into v_player from public.ktk_world_players
    where user_id=v_uid and world_id='main' and is_alive for update;
    if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;
    v_state:=coalesce(v_player.state,'{}'::jsonb);
    v_inventory:=coalesce(v_state->'inventory','[null,null]'::jsonb);
    v_wearables:=coalesce(v_state->'wearables','{}'::jsonb);
    v_entity_id:=left(coalesce(p_payload->>'entity_id',''),120);
    select * into v_resource from public.ktk_world_entities
      where world_id='main' and entity_id=v_entity_id and entity_type='item' for update;
    if not found or coalesce(v_resource.state->>'status','ground')<>'ground' then
      raise exception 'ITEM_NOT_AVAILABLE';
    end if;
    if sqrt(power(v_player.x-v_resource.x,2)+power(v_player.y-v_resource.y,2))>64 then
      raise exception 'ITEM_TOO_FAR';
    end if;
    v_item_id:=v_resource.state->>'item_id';
    select * into v_item_def from ktk_private.item_catalog where item_id=v_item_id;
    if not found then raise exception 'UNKNOWN_ITEM'; end if;
    v_item:=jsonb_build_object(
      'item_id',v_item_id,
      'display_name',v_item_def.display_name,
      'durability',coalesce((v_resource.state->>'durability')::integer,v_item_def.max_durability),
      'max_durability',v_item_def.max_durability,
      'quantity',greatest(1,coalesce((v_resource.state->>'quantity')::integer,1))
    );

    -- Vestimenta nunca ocupa mochila: entra no espaço correspondente imediatamente.
    if v_item_def.wear_slot is not null then
      v_wear_slot:=v_item_def.wear_slot;
      if v_wear_slot is null or v_wear_slot not in ('head','chest','waist','legs','feet') then
        raise exception 'INVALID_WEAR_SLOT';
      end if;

      select king_user_id into v_king_user_id from public.ktk_worlds where id='main';
      if v_item_id='king-crown' and v_king_user_id is not null and v_king_user_id<>v_uid then
        raise exception 'CROWN_ALREADY_CLAIMED';
      end if;

      v_old_wearable:=coalesce(v_wearables->v_wear_slot,'null'::jsonb);
      if v_old_wearable<>'null'::jsonb then
        v_old_wearable_id:=v_old_wearable->>'item_id';
        if v_old_wearable_id is null then raise exception 'INVALID_WEARABLE_STATE'; end if;

        if v_old_wearable_id='king-crown' then
          update public.ktk_worlds
          set king_user_id=null,crown_version=crown_version+1
          where id='main' and king_user_id=v_uid;

          update public.ktk_world_entities
          set x=v_resource.x,y=v_resource.y,
              state=jsonb_build_object('status','ground','item_id','king-crown','display_name','Coroa Real'),
              revision=revision+1,updated_at=now()
          where world_id='main' and entity_id='king-crown';

          if not found then
            insert into public.ktk_world_entities(
              world_id,entity_id,entity_type,x,y,collision_radius,state,revision
            ) values (
              'main','king-crown','item',v_resource.x,v_resource.y,0,
              jsonb_build_object('status','ground','item_id','king-crown','display_name','Coroa Real'),1
            );
          end if;
        else
          -- O item substituído aparece no mesmo ponto da peça coletada.
          insert into public.ktk_world_entities(
            world_id,entity_id,entity_type,x,y,collision_radius,state,revision
          ) values (
            'main','drop-'||gen_random_uuid()::text,'item',v_resource.x,v_resource.y,0,
            v_old_wearable||jsonb_build_object('status','ground'),1
          );
        end if;
      end if;

      v_wearables:=jsonb_set(v_wearables,array[v_wear_slot],v_item,true);

      if v_item_id='king-crown' then
        update public.ktk_worlds
        set king_user_id=v_uid,crown_version=crown_version+1
        where id='main' and (king_user_id is null or king_user_id=v_uid);
        if not found then raise exception 'CROWN_ALREADY_CLAIMED'; end if;

        update public.ktk_world_entities
        set x=v_resource.x,y=v_resource.y,
            state=jsonb_build_object(
              'status','carried','item_id','king-crown','display_name','Coroa Real','owner_id',v_uid::text
            ),
            revision=revision+1,updated_at=now()
        where world_id='main' and entity_id='king-crown';

        if not found then
          insert into public.ktk_world_entities(
            world_id,entity_id,entity_type,x,y,collision_radius,state,revision
          ) values (
            'main','king-crown','item',v_resource.x,v_resource.y,0,
            jsonb_build_object(
              'status','carried','item_id','king-crown','display_name','Coroa Real','owner_id',v_uid::text
            ),1
          );
        end if;
      else
        delete from public.ktk_world_entities
        where world_id='main' and entity_id=v_entity_id;
      end if;

    elsif coalesce((v_item_def.metadata->>'stackable')::boolean,false) then
      v_stack_slot:=-1;
      for v_i in 0..jsonb_array_length(v_inventory)-1 loop
        if v_inventory->v_i->>'item_id'=v_item_id then
          v_stack_slot:=v_i;
          exit;
        end if;
      end loop;

      if v_stack_slot>=0 then
        v_item:=jsonb_set(
          v_inventory->v_stack_slot,'{quantity}',
          to_jsonb(least(
            99,
            coalesce((v_inventory->v_stack_slot->>'quantity')::integer,1)
              + coalesce((v_item->>'quantity')::integer,1)
          )),true
        );
        v_inventory:=jsonb_set(v_inventory,array[v_stack_slot::text],v_item,true);
      else
        v_slot:=-1;
        for v_i in 0..jsonb_array_length(v_inventory)-1 loop
          if v_inventory->v_i='null'::jsonb then
            v_slot:=v_i;
            exit;
          end if;
        end loop;
        if v_slot<0 then raise exception 'INVENTORY_FULL'; end if;
        v_inventory:=jsonb_set(v_inventory,array[v_slot::text],v_item,true);
      end if;
      delete from public.ktk_world_entities
      where world_id='main' and entity_id=v_entity_id;

    else
      v_slot:=-1;
      for v_i in 0..jsonb_array_length(v_inventory)-1 loop
        if v_inventory->v_i='null'::jsonb then
          v_slot:=v_i;
          exit;
        end if;
      end loop;
      if v_slot<0 then raise exception 'INVENTORY_FULL'; end if;
      v_inventory:=jsonb_set(v_inventory,array[v_slot::text],v_item,true);
      delete from public.ktk_world_entities
      where world_id='main' and entity_id=v_entity_id;
    end if;

    v_state:=jsonb_set(v_state,'{inventory}',v_inventory,true);
    v_state:=jsonb_set(v_state,'{wearables}',v_wearables,true);
    update public.ktk_world_players set state=v_state where user_id=v_uid;
    return jsonb_build_object('ok',true,'state',v_state,'collected',v_item_id);

  elsif p_action='equip' then
    -- Compatibilidade: se um cliente antigo tentar equipar roupa da mochila,
    -- a peça sai do inventário e a que estava vestida vai direto ao chão.
    perform 1 from public.ktk_worlds where id='main' for update;
    if not found then raise exception 'WORLD_NOT_FOUND'; end if;
    select * into v_player from public.ktk_world_players
    where user_id=v_uid and world_id='main' and is_alive for update;
    if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;

    v_state:=coalesce(v_player.state,'{}'::jsonb);
    v_inventory:=coalesce(v_state->'inventory','[null,null]'::jsonb);
    v_wearables:=coalesce(v_state->'wearables','{}'::jsonb);
    v_slot:=coalesce((p_payload->>'slot_index')::integer,-1);
    v_wear_slot:=p_payload->>'wear_slot';
    if v_slot<0 or v_slot>=jsonb_array_length(v_inventory)
       or v_wear_slot is null or v_wear_slot not in ('head','chest','waist','legs','feet') then
      raise exception 'INVALID_EQUIPMENT_SLOT';
    end if;

    v_item:=v_inventory->v_slot;
    if v_item='null'::jsonb then raise exception 'EMPTY_SLOT'; end if;
    v_item_id:=v_item->>'item_id';
    select * into v_item_def from ktk_private.item_catalog where item_id=v_item_id;
    if not found or v_item_def.wear_slot is distinct from v_wear_slot then
      raise exception 'WRONG_WEAR_SLOT';
    end if;

    v_old_wearable:=coalesce(v_wearables->v_wear_slot,'null'::jsonb);
    v_drop_direction:=coalesce((p_payload->>'direction')::integer,v_player.direction,2);
    if v_drop_direction not between 0 and 3 then raise exception 'INVALID_DIRECTION'; end if;
    v_vx:=case v_drop_direction when 1 then -1 when 3 then 1 else 0 end;
    v_vy:=case v_drop_direction when 0 then -1 when 2 then 1 else 0 end;
    v_drop_x:=v_player.x+v_vx*48;
    v_drop_y:=v_player.y+v_vy*48;

    if v_old_wearable<>'null'::jsonb then
      v_old_wearable_id:=v_old_wearable->>'item_id';
      if v_old_wearable_id='king-crown' then
        update public.ktk_worlds
        set king_user_id=null,crown_version=crown_version+1
        where id='main' and king_user_id=v_uid;

        update public.ktk_world_entities
        set x=v_drop_x,y=v_drop_y,
            state=jsonb_build_object('status','ground','item_id','king-crown','display_name','Coroa Real'),
            revision=revision+1,updated_at=now()
        where world_id='main' and entity_id='king-crown';

        if not found then
          insert into public.ktk_world_entities(
            world_id,entity_id,entity_type,x,y,collision_radius,state,revision
          ) values (
            'main','king-crown','item',v_drop_x,v_drop_y,0,
            jsonb_build_object('status','ground','item_id','king-crown','display_name','Coroa Real'),1
          );
        end if;
      else
        insert into public.ktk_world_entities(
          world_id,entity_id,entity_type,x,y,collision_radius,state,revision
        ) values (
          'main','drop-'||gen_random_uuid()::text,'item',v_drop_x,v_drop_y,0,
          v_old_wearable||jsonb_build_object('status','ground'),1
        );
      end if;
    end if;

    if v_item_id='king-crown' then
      select king_user_id into v_king_user_id from public.ktk_worlds where id='main';
      if v_king_user_id is not null and v_king_user_id<>v_uid then
        raise exception 'CROWN_ALREADY_CLAIMED';
      end if;
      update public.ktk_worlds
      set king_user_id=v_uid,crown_version=crown_version+1 where id='main';

      update public.ktk_world_entities
      set x=v_drop_x,y=v_drop_y,
          state=jsonb_build_object(
            'status','carried','item_id','king-crown','display_name','Coroa Real','owner_id',v_uid::text
          ),
          revision=revision+1,updated_at=now()
      where world_id='main' and entity_id='king-crown';

      if not found then
        insert into public.ktk_world_entities(
          world_id,entity_id,entity_type,x,y,collision_radius,state,revision
        ) values (
          'main','king-crown','item',v_drop_x,v_drop_y,0,
          jsonb_build_object(
            'status','carried','item_id','king-crown','display_name','Coroa Real','owner_id',v_uid::text
          ),1
        );
      end if;
    end if;

    v_inventory:=jsonb_set(v_inventory,array[v_slot::text],'null'::jsonb,true);
    v_wearables:=jsonb_set(v_wearables,array[v_wear_slot],v_item,true);
    v_state:=jsonb_set(v_state,'{inventory}',v_inventory,true);
    v_state:=jsonb_set(v_state,'{wearables}',v_wearables,true);
    update public.ktk_world_players set state=v_state where user_id=v_uid;
    return jsonb_build_object('ok',true,'state',v_state);

  elsif p_action='unequip' then
    -- Clique em VESTINDO retira a peça do personagem e a põe no mapa,
    -- sem depender de espaço livre e sem alterar o inventário.
    perform 1 from public.ktk_worlds where id='main' for update;
    if not found then raise exception 'WORLD_NOT_FOUND'; end if;
    select * into v_player from public.ktk_world_players
    where user_id=v_uid and world_id='main' and is_alive for update;
    if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;

    v_state:=coalesce(v_player.state,'{}'::jsonb);
    v_inventory:=coalesce(v_state->'inventory','[null,null]'::jsonb);
    v_wearables:=coalesce(v_state->'wearables','{}'::jsonb);
    v_wear_slot:=p_payload->>'wear_slot';
    if v_wear_slot is null or v_wear_slot not in ('head','chest','waist','legs','feet') then
      raise exception 'INVALID_WEAR_SLOT';
    end if;

    v_item:=coalesce(v_wearables->v_wear_slot,'null'::jsonb);
    if v_item='null'::jsonb then raise exception 'EMPTY_WEAR_SLOT'; end if;
    v_item_id:=v_item->>'item_id';
    select * into v_item_def from ktk_private.item_catalog where item_id=v_item_id;
    if not found or v_item_def.wear_slot is distinct from v_wear_slot then
      raise exception 'INVALID_WEARABLE_STATE';
    end if;

    v_drop_direction:=coalesce((p_payload->>'direction')::integer,v_player.direction,2);
    if v_drop_direction not between 0 and 3 then raise exception 'INVALID_DIRECTION'; end if;
    v_vx:=case v_drop_direction when 1 then -1 when 3 then 1 else 0 end;
    v_vy:=case v_drop_direction when 0 then -1 when 2 then 1 else 0 end;
    v_drop_x:=v_player.x+v_vx*48;
    v_drop_y:=v_player.y+v_vy*48;

    if v_item_id='king-crown' then
      select king_user_id into v_king_user_id from public.ktk_worlds where id='main';
      if v_king_user_id is not null and v_king_user_id<>v_uid then
        raise exception 'NOT_THE_KING';
      end if;
      update public.ktk_worlds
      set king_user_id=null,crown_version=crown_version+1
      where id='main' and king_user_id=v_uid;

      update public.ktk_world_entities
      set x=v_drop_x,y=v_drop_y,
          state=jsonb_build_object('status','ground','item_id','king-crown','display_name','Coroa Real'),
          revision=revision+1,updated_at=now()
      where world_id='main' and entity_id='king-crown';

      if not found then
        insert into public.ktk_world_entities(
          world_id,entity_id,entity_type,x,y,collision_radius,state,revision
        ) values (
          'main','king-crown','item',v_drop_x,v_drop_y,0,
          jsonb_build_object('status','ground','item_id','king-crown','display_name','Coroa Real'),1
        );
      end if;
    else
      insert into public.ktk_world_entities(
        world_id,entity_id,entity_type,x,y,collision_radius,state,revision
      ) values (
        'main','drop-'||gen_random_uuid()::text,'item',v_drop_x,v_drop_y,0,
        v_item||jsonb_build_object('status','ground'),1
      );
    end if;

    v_wearables:=jsonb_set(v_wearables,array[v_wear_slot],'null'::jsonb,true);
    v_state:=jsonb_set(v_state,'{inventory}',v_inventory,true);
    v_state:=jsonb_set(v_state,'{wearables}',v_wearables,true);
    update public.ktk_world_players set state=v_state where user_id=v_uid;
    return jsonb_build_object('ok',true,'state',v_state);
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
$function$

-- Conserta qualquer vestimenta que tenha entrado na mochila antes desta regra.
-- A trava do mundo segue a ordem usada pelos RPCs de equipamento e coroa.
DO $wearable_cleanup$
DECLARE
  v_player record;
  v_inventory jsonb;
  v_wearables jsonb;
  v_item jsonb;
  v_old_wearable jsonb;
  v_slot text;
  v_old_id text;
  v_index integer;
  v_king_user_id uuid;
BEGIN
  PERFORM 1 FROM public.ktk_worlds WHERE id='main' FOR UPDATE;
  FOR v_player IN
    SELECT user_id,world_id,x,y,direction,state
    FROM public.ktk_world_players
    WHERE world_id='main' AND is_alive=true
    ORDER BY user_id
    FOR UPDATE
  LOOP
    v_inventory:=coalesce(v_player.state->'inventory','[null,null]'::jsonb);
    v_wearables:=coalesce(v_player.state->'wearables','{}'::jsonb);
    IF jsonb_typeof(v_inventory)<>'array' THEN
      RAISE EXCEPTION 'INVALID_PLAYER_INVENTORY_STATE';
    END IF;

    FOR v_index IN 0..jsonb_array_length(v_inventory)-1 LOOP
      v_item:=v_inventory->v_index;
      IF v_item IS NULL OR v_item='null'::jsonb THEN CONTINUE; END IF;

      SELECT wear_slot INTO v_slot
      FROM ktk_private.item_catalog
      WHERE item_id=v_item->>'item_id';
      IF v_slot IS NULL THEN CONTINUE; END IF;
      IF v_slot NOT IN ('head','chest','waist','legs','feet') THEN
        RAISE EXCEPTION 'INVALID_WEAR_SLOT_IN_PLAYER_INVENTORY';
      END IF;

      v_old_wearable:=coalesce(v_wearables->v_slot,'null'::jsonb);
      IF v_old_wearable<>'null'::jsonb THEN
        v_old_id:=v_old_wearable->>'item_id';
        IF v_old_id='king-crown' THEN
          UPDATE public.ktk_worlds
          SET king_user_id=null,crown_version=crown_version+1
          WHERE id=v_player.world_id AND king_user_id=v_player.user_id;

          UPDATE public.ktk_world_entities
          SET x=v_player.x,y=v_player.y,
              state=jsonb_build_object('status','ground','item_id','king-crown','display_name','Coroa Real'),
              revision=revision+1,updated_at=now()
          WHERE world_id=v_player.world_id AND entity_id='king-crown';
          IF NOT FOUND THEN
            INSERT INTO public.ktk_world_entities(
              world_id,entity_id,entity_type,x,y,collision_radius,state,revision
            ) VALUES (
              v_player.world_id,'king-crown','item',v_player.x,v_player.y,0,
              jsonb_build_object('status','ground','item_id','king-crown','display_name','Coroa Real'),1
            );
          END IF;
        ELSE
          INSERT INTO public.ktk_world_entities(
            world_id,entity_id,entity_type,x,y,collision_radius,state,revision
          ) VALUES (
            v_player.world_id,'drop-'||gen_random_uuid()::text,'item',v_player.x,v_player.y,0,
            v_old_wearable||jsonb_build_object('status','ground'),1
          );
        END IF;
      END IF;

      v_wearables:=jsonb_set(v_wearables,array[v_slot],v_item,true);
      v_inventory:=jsonb_set(v_inventory,array[v_index::text],'null'::jsonb,true);

      IF v_item->>'item_id'='king-crown' THEN
        SELECT king_user_id INTO v_king_user_id
        FROM public.ktk_worlds WHERE id=v_player.world_id;
        IF v_king_user_id IS NOT NULL AND v_king_user_id<>v_player.user_id THEN
          RAISE EXCEPTION 'CROWN_ALREADY_CLAIMED_DURING_WEARABLE_CLEANUP';
        END IF;
        UPDATE public.ktk_worlds
        SET king_user_id=v_player.user_id,crown_version=crown_version+1
        WHERE id=v_player.world_id;

        UPDATE public.ktk_world_entities
        SET x=v_player.x,y=v_player.y,
            state=jsonb_build_object(
              'status','carried','item_id','king-crown','display_name','Coroa Real','owner_id',v_player.user_id::text
            ),
            revision=revision+1,updated_at=now()
        WHERE world_id=v_player.world_id AND entity_id='king-crown';
        IF NOT FOUND THEN
          INSERT INTO public.ktk_world_entities(
            world_id,entity_id,entity_type,x,y,collision_radius,state,revision
          ) VALUES (
            v_player.world_id,'king-crown','item',v_player.x,v_player.y,0,
            jsonb_build_object(
              'status','carried','item_id','king-crown','display_name','Coroa Real','owner_id',v_player.user_id::text
            ),1
          );
        END IF;
      END IF;
    END LOOP;

    UPDATE public.ktk_world_players
    SET state=jsonb_set(
      jsonb_set(coalesce(state,'{}'::jsonb),'{inventory}',v_inventory,true),
      '{wearables}',v_wearables,true
    )
    WHERE user_id=v_player.user_id AND world_id=v_player.world_id;
  END LOOP;
END;
$wearable_cleanup$;

