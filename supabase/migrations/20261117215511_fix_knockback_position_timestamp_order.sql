begin;

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
  i integer;
begin
  perform 1 from public.ktk_worlds where id='main' for update;
  select * into v_player from public.ktk_world_players
  where user_id=p_target and world_id='main' and is_alive=true for update;
  if not found then return jsonb_build_object('active',false); end if;
  v_state:=coalesce(v_player.state,'{}'::jsonb);
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
      values('main','drop-'||gen_random_uuid()::text,'item',v_player.x+24,v_player.y+24,0,
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
  v_next_x:=v_player.x+sign(coalesce(p_knockback_x,0))*18;
  v_next_y:=v_player.y+sign(coalesce(p_knockback_y,0))*18;
  v_is_dead:=v_health<=0;

  if v_is_dead then
    perform ktk_private.drop_player_assets(p_target,v_player.x,v_player.y,v_state);
    v_state:=jsonb_set(v_state,'{inventory}','[null,null]'::jsonb,true);
    v_state:=jsonb_set(v_state,'{wearables}',jsonb_build_object('head',null,'chest',null,'waist',null,'legs',null,'feet',null),true);
    v_state:=jsonb_set(v_state,'{guarding}','false'::jsonb,true);
    v_state:=jsonb_set(v_state,'{moving}','false'::jsonb,true);
    v_state:=jsonb_set(v_state,'{running}','false'::jsonb,true);
  end if;

  update public.ktk_world_players set state=v_state,is_alive=not v_is_dead,
    x=case when v_is_dead then v_player.x else v_next_x end,
    y=case when v_is_dead then v_player.y else v_next_y end,
    position_updated_at=v_position_at,
    movement_updated_at=v_position_at,
    last_seen_at=case when v_is_dead then v_position_at else last_seen_at end
  where user_id=p_target;

  return jsonb_build_object('active',true,'damage',v_damage,'health',v_health,'dead',v_is_dead,'state',v_state);
end;
$function$
;

commit;
