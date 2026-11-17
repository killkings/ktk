begin;

create or replace function ktk_private.apply_player_movement_segment(
 p_user_id uuid,p_start_x double precision,p_start_y double precision,
 p_input_x smallint,p_input_y smallint,p_speed double precision,p_elapsed double precision
)
returns table(x double precision,y double precision)
language plpgsql set search_path=''
as $function$
declare
 v_length double precision; v_dx double precision; v_dy double precision;
 v_next_x double precision; v_next_y double precision; v_blocked boolean;
begin
 if p_elapsed<=0 or (coalesce(p_input_x,0)=0 and coalesce(p_input_y,0)=0) or p_speed<=0 then
  return query select p_start_x,p_start_y; return;
 end if;
 v_length:=pg_catalog.sqrt(pg_catalog.power(coalesce(p_input_x,0)::double precision,2)
  +pg_catalog.power(coalesce(p_input_y,0)::double precision,2));
 if v_length<=0 then return query select p_start_x,p_start_y; return; end if;
 v_dx:=(coalesce(p_input_x,0)::double precision/v_length)*p_speed*p_elapsed;
 v_dy:=(coalesce(p_input_y,0)::double precision/v_length)*p_speed*p_elapsed;

 v_next_x:=p_start_x+v_dx;
 select exists(
  select 1 from public.ktk_world_players other_player
  where other_player.world_id='main' and other_player.user_id<>p_user_id and other_player.is_alive=true
   and pg_catalog.sqrt(pg_catalog.power(v_next_x-other_player.x,2)+pg_catalog.power(p_start_y-other_player.y,2))<36.0
   and pg_catalog.sqrt(pg_catalog.power(v_next_x-other_player.x,2)+pg_catalog.power(p_start_y-other_player.y,2))+0.01
    <pg_catalog.sqrt(pg_catalog.power(p_start_x-other_player.x,2)+pg_catalog.power(p_start_y-other_player.y,2))
  union all
  select 1 from public.ktk_world_entities entity
  where entity.world_id='main' and entity.entity_type='enemy'
   and coalesce((entity.state->>'defeated')::boolean,false)=false
   and pg_catalog.sqrt(pg_catalog.power(v_next_x-entity.x,2)+pg_catalog.power(p_start_y-entity.y,2))<18.0+entity.collision_radius
   and pg_catalog.sqrt(pg_catalog.power(v_next_x-entity.x,2)+pg_catalog.power(p_start_y-entity.y,2))+0.01
    <pg_catalog.sqrt(pg_catalog.power(p_start_x-entity.x,2)+pg_catalog.power(p_start_y-entity.y,2))
 ) into v_blocked;
 if v_blocked then v_next_x:=p_start_x; end if;

 v_next_y:=p_start_y+v_dy;
 select exists(
  select 1 from public.ktk_world_players other_player
  where other_player.world_id='main' and other_player.user_id<>p_user_id and other_player.is_alive=true
   and pg_catalog.sqrt(pg_catalog.power(v_next_x-other_player.x,2)+pg_catalog.power(v_next_y-other_player.y,2))<36.0
   and pg_catalog.sqrt(pg_catalog.power(v_next_x-other_player.x,2)+pg_catalog.power(v_next_y-other_player.y,2))+0.01
    <pg_catalog.sqrt(pg_catalog.power(v_next_x-other_player.x,2)+pg_catalog.power(p_start_y-other_player.y,2))
  union all
  select 1 from public.ktk_world_entities entity
  where entity.world_id='main' and entity.entity_type='enemy'
   and coalesce((entity.state->>'defeated')::boolean,false)=false
   and pg_catalog.sqrt(pg_catalog.power(v_next_x-entity.x,2)+pg_catalog.power(v_next_y-entity.y,2))<18.0+entity.collision_radius
   and pg_catalog.sqrt(pg_catalog.power(v_next_x-entity.x,2)+pg_catalog.power(v_next_y-entity.y,2))+0.01
    <pg_catalog.sqrt(pg_catalog.power(v_next_x-entity.x,2)+pg_catalog.power(p_start_y-entity.y,2))
 ) into v_blocked;
 if v_blocked then v_next_y:=p_start_y; end if;
 return query select v_next_x,v_next_y;
end;
$function$;

revoke all on function ktk_private.apply_player_movement_segment(
 uuid,double precision,double precision,smallint,smallint,double precision,double precision
) from public,anon,authenticated;

create or replace function ktk_private.step_player_unlocked_v2(
 p_input_x smallint,p_input_y smallint,p_running boolean default false,
 p_guarding boolean default false,p_input_age_ms integer default 0
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
 v_uid uuid:=auth.uid();
 v_player public.ktk_world_players;
 v_state jsonb;
 v_inventory jsonb;
 v_item_def ktk_private.item_catalog%rowtype;
 v_input_x smallint; v_input_y smallint;
 v_previous_input_x smallint; v_previous_input_y smallint;
 v_moving boolean; v_running boolean; v_guarding boolean;
 v_previous_moving boolean; v_previous_running boolean; v_previous_guarding boolean;
 v_input_changed boolean; v_direction smallint;
 v_elapsed double precision; v_previous_elapsed double precision; v_current_elapsed double precision;
 v_speed_level double precision; v_speed_penalty double precision; v_speed double precision;
 v_next_x double precision; v_next_y double precision; v_slot integer; v_moved boolean; v_now timestamptz;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
 v_input_x:=coalesce(p_input_x,0); v_input_y:=coalesce(p_input_y,0);
 if v_input_x not between -1 and 1 or v_input_y not between -1 and 1 then
  raise exception 'INVALID_MOVEMENT_INPUT';
 end if;
 perform pg_catalog.set_config('lock_timeout','250ms',true);
 select * into v_player from public.ktk_world_players
 where user_id=v_uid and world_id='main' and is_alive=true for update;
 if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;

 v_now:=pg_catalog.clock_timestamp();
 v_state:=coalesce(v_player.state,'{}'::jsonb);
 v_inventory:=coalesce(v_state->'inventory','[null,null]'::jsonb);
 v_moving:=v_input_x<>0 or v_input_y<>0;
 v_running:=coalesce(p_running,false) and v_moving
  and coalesce((v_state->>'stamina')::numeric,0)>0;
 v_guarding:=coalesce(p_guarding,false);

 if v_guarding then
  v_slot:=greatest(0,least(jsonb_array_length(v_inventory)-1,coalesce((v_state->>'selected_slot')::integer,0)));
  if v_inventory->v_slot<>'null'::jsonb then
   select * into v_item_def from ktk_private.item_catalog where item_id=v_inventory->v_slot->>'item_id';
   if found and v_item_def.two_handed then raise exception 'TWO_HANDED_WEAPON_CANNOT_BLOCK'; end if;
  end if;
  if not exists(
   select 1 from jsonb_array_elements(v_inventory) as inv(item)
   join ktk_private.item_catalog c on c.item_id=inv.item->>'item_id' and c.item_type='shield'
  ) then raise exception 'SHIELD_REQUIRED'; end if;
  if coalesce((v_state->>'stamina')::numeric,0)<1 then raise exception 'NOT_ENOUGH_STAMINA'; end if;
 end if;

 v_previous_input_x:=greatest(-1,least(1,coalesce((v_state->>'movement_input_x')::integer,0)))::smallint;
 v_previous_input_y:=greatest(-1,least(1,coalesce((v_state->>'movement_input_y')::integer,0)))::smallint;
 v_previous_moving:=v_previous_input_x <> 0 or v_previous_input_y <> 0;
 v_previous_running:=coalesce((v_state->>'movement_running')::boolean,false)
  and v_previous_moving and coalesce((v_state->>'stamina')::numeric,0)>0;
 v_previous_guarding:=coalesce((v_state->>'movement_guarding')::boolean,false);

 if v_previous_guarding then
  v_slot:=greatest(0,least(jsonb_array_length(v_inventory)-1,coalesce((v_state->>'selected_slot')::integer,0)));
  if v_inventory->v_slot<>'null'::jsonb then
   select * into v_item_def from ktk_private.item_catalog where item_id=v_inventory->v_slot->>'item_id';
   if found and v_item_def.two_handed then v_previous_guarding:=false; end if;
  end if;
  if not exists(
   select 1 from jsonb_array_elements(v_inventory) as inv(item)
   join ktk_private.item_catalog c on c.item_id=inv.item->>'item_id' and c.item_type='shield'
  ) then v_previous_guarding:=false; end if;
 end if;

 select coalesce(sum(greatest(0,coalesce(nullif(c.metadata->>'speed_penalty','')::double precision,0))),0)
 into v_speed_penalty
 from jsonb_each(coalesce(v_state->'wearables','{}'::jsonb)) as worn(slot,item)
 join ktk_private.item_catalog c on c.item_id=coalesce(worn.item->>'item_id',worn.item->>'itemId',worn.item->>'id')
 where worn.item<>'null'::jsonb
  and coalesce(nullif(worn.item->>'durability','')::double precision,c.max_durability::double precision,0)>0;

 -- The real end-to-end RPC interval exceeded the old 200ms cap.
 v_elapsed:=least(0.75,greatest(0,extract(epoch from(v_now-v_player.movement_updated_at))));
 v_input_changed:=v_input_x<>v_previous_input_x or v_input_y<>v_previous_input_y
  or v_running<>v_previous_running or v_guarding<>v_previous_guarding;
 if v_input_changed then
  v_current_elapsed:=least(v_elapsed,greatest(0,least(750,coalesce(p_input_age_ms,0)))/1000.0);
 else
  v_current_elapsed:=v_elapsed;
 end if;
 v_previous_elapsed:=greatest(0,v_elapsed-v_current_elapsed);
 v_next_x:=v_player.x; v_next_y:=v_player.y;

 if v_previous_moving and v_previous_elapsed>0 then
  v_speed_level:=case when v_previous_running then 3.0 else 2.0 end;
  if v_previous_guarding then v_speed_level:=v_speed_level*0.5; end if;
  v_speed:=225.0*greatest(1.0,v_speed_level-v_speed_penalty)/2.0;
  select moved.x,moved.y into v_next_x,v_next_y
  from ktk_private.apply_player_movement_segment(v_uid,v_next_x,v_next_y,
   v_previous_input_x,v_previous_input_y,v_speed,v_previous_elapsed) as moved;
 end if;

 if v_moving and v_current_elapsed>0 then
  v_speed_level:=case when v_running then 3.0 else 2.0 end;
  if v_guarding then v_speed_level:=v_speed_level*0.5; end if;
  v_speed:=225.0*greatest(1.0,v_speed_level-v_speed_penalty)/2.0;
  if abs(v_input_x)>abs(v_input_y) then
   v_direction:=case when v_input_x>0 then 3 else 1 end;
  else
   v_direction:=case when v_input_y>0 then 2 else 0 end;
  end if;
  select moved.x,moved.y into v_next_x,v_next_y
  from ktk_private.apply_player_movement_segment(v_uid,v_next_x,v_next_y,
   v_input_x,v_input_y,v_speed,v_current_elapsed) as moved;
 else
  v_direction:=v_player.direction;
 end if;

 v_state:=jsonb_set(v_state,'{moving}',to_jsonb(v_moving),true);
 v_state:=jsonb_set(v_state,'{running}',to_jsonb(v_running),true);
 v_state:=jsonb_set(v_state,'{guarding}',to_jsonb(v_guarding),true);
 v_state:=jsonb_set(v_state,'{movement_input_x}',to_jsonb(v_input_x),true);
 v_state:=jsonb_set(v_state,'{movement_input_y}',to_jsonb(v_input_y),true);
 v_state:=jsonb_set(v_state,'{movement_running}',to_jsonb(v_running),true);
 v_state:=jsonb_set(v_state,'{movement_guarding}',to_jsonb(v_guarding),true);
 v_moved:=abs(v_next_x-v_player.x)>0.001 or abs(v_next_y-v_player.y)>0.001;
 update public.ktk_world_players set x=v_next_x,y=v_next_y,direction=v_direction,state=v_state,
  last_seen_at=v_now,position_updated_at=v_now,movement_updated_at=v_now
 where user_id=v_uid and world_id='main' returning * into v_player;

 return jsonb_build_object('accepted',true,'x',v_player.x,'y',v_player.y,
  'direction',v_player.direction,'position_updated_at',v_player.position_updated_at,
  'movement_updated_at',v_player.movement_updated_at,'state',v_player.state,'moved',v_moved,
  'processed_elapsed_ms',round(v_elapsed*1000)::integer,
  'current_input_elapsed_ms',round(v_current_elapsed*1000)::integer);
end;
$function$;

revoke all on function ktk_private.step_player_unlocked_v2(smallint,smallint,boolean,boolean,integer)
 from public,anon,authenticated;
drop function public.ktk_step_player(smallint,smallint,boolean,boolean);
create function public.ktk_step_player(
 p_input_x smallint,p_input_y smallint,p_running boolean default false,
 p_guarding boolean default false,p_input_age_ms integer default 0
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 perform pg_catalog.set_config('lock_timeout','250ms',true);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ktk:main:movement'));
 return ktk_private.step_player_unlocked_v2(p_input_x,p_input_y,p_running,p_guarding,p_input_age_ms);
end;
$function$;
revoke all on function public.ktk_step_player(smallint,smallint,boolean,boolean,integer)
 from public,anon;
grant execute on function public.ktk_step_player(smallint,smallint,boolean,boolean,integer) to authenticated;
comment on function public.ktk_step_player(smallint,smallint,boolean,boolean,integer)
 is 'Applies timestamped server-authoritative movement intent segments with bounded latency catch-up and server-side collision validation.';
commit;