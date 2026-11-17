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
 v_steps integer; v_step integer; v_step_x double precision; v_step_y double precision;
begin
 if p_elapsed<=0 or (coalesce(p_input_x,0)=0 and coalesce(p_input_y,0)=0) or p_speed<=0 then
  return query select p_start_x,p_start_y; return;
 end if;
 v_length:=pg_catalog.sqrt(pg_catalog.power(coalesce(p_input_x,0)::double precision,2)
  +pg_catalog.power(coalesce(p_input_y,0)::double precision,2));
 if v_length<=0 then return query select p_start_x,p_start_y; return; end if;
 v_dx:=(coalesce(p_input_x,0)::double precision/v_length)*p_speed*p_elapsed;
 v_dy:=(coalesce(p_input_y,0)::double precision/v_length)*p_speed*p_elapsed;
 -- Sweep the complete path in short increments so a long RPC interval cannot
 -- tunnel through a player or enemy merely because its endpoint is clear.
 v_steps:=greatest(1,ceil(greatest(abs(v_dx),abs(v_dy))/6.0)::integer);
 v_step_x:=v_dx/v_steps; v_step_y:=v_dy/v_steps;
 v_next_x:=p_start_x; v_next_y:=p_start_y;
 for v_step in 1..v_steps loop
  -- Preserve the server's axis-separated sliding collision contract.
  select exists(
   select 1 from public.ktk_world_players other_player
   where other_player.world_id='main' and other_player.user_id<>p_user_id and other_player.is_alive=true
    and pg_catalog.sqrt(pg_catalog.power(v_next_x+v_step_x-other_player.x,2)+pg_catalog.power(v_next_y-other_player.y,2))<36.0
    and pg_catalog.sqrt(pg_catalog.power(v_next_x+v_step_x-other_player.x,2)+pg_catalog.power(v_next_y-other_player.y,2))+0.01
     <pg_catalog.sqrt(pg_catalog.power(v_next_x-other_player.x,2)+pg_catalog.power(v_next_y-other_player.y,2))
   union all
   select 1 from public.ktk_world_entities entity
   where entity.world_id='main' and entity.entity_type='enemy'
    and coalesce((entity.state->>'defeated')::boolean,false)=false
    and pg_catalog.sqrt(pg_catalog.power(v_next_x+v_step_x-entity.x,2)+pg_catalog.power(v_next_y-entity.y,2))<18.0+entity.collision_radius
    and pg_catalog.sqrt(pg_catalog.power(v_next_x+v_step_x-entity.x,2)+pg_catalog.power(v_next_y-entity.y,2))+0.01
     <pg_catalog.sqrt(pg_catalog.power(v_next_x-entity.x,2)+pg_catalog.power(v_next_y-entity.y,2))
  ) into v_blocked;
  if not v_blocked then v_next_x:=v_next_x+v_step_x; end if;

  select exists(
   select 1 from public.ktk_world_players other_player
   where other_player.world_id='main' and other_player.user_id<>p_user_id and other_player.is_alive=true
    and pg_catalog.sqrt(pg_catalog.power(v_next_x-other_player.x,2)+pg_catalog.power(v_next_y+v_step_y-other_player.y,2))<36.0
    and pg_catalog.sqrt(pg_catalog.power(v_next_x-other_player.x,2)+pg_catalog.power(v_next_y+v_step_y-other_player.y,2))+0.01
     <pg_catalog.sqrt(pg_catalog.power(v_next_x-other_player.x,2)+pg_catalog.power(v_next_y-other_player.y,2))
   union all
   select 1 from public.ktk_world_entities entity
   where entity.world_id='main' and entity.entity_type='enemy'
    and coalesce((entity.state->>'defeated')::boolean,false)=false
    and pg_catalog.sqrt(pg_catalog.power(v_next_x-entity.x,2)+pg_catalog.power(v_next_y+v_step_y-entity.y,2))<18.0+entity.collision_radius
    and pg_catalog.sqrt(pg_catalog.power(v_next_x-entity.x,2)+pg_catalog.power(v_next_y+v_step_y-entity.y,2))+0.01
     <pg_catalog.sqrt(pg_catalog.power(v_next_x-entity.x,2)+pg_catalog.power(v_next_y-entity.y,2))
  ) into v_blocked;
  if not v_blocked then v_next_y:=v_next_y+v_step_y; end if;
 end loop;
 return query select v_next_x,v_next_y;
end;
$function$;
revoke all on function ktk_private.apply_player_movement_segment(
 uuid,double precision,double precision,smallint,smallint,double precision,double precision
) from public,anon,authenticated;
commit;