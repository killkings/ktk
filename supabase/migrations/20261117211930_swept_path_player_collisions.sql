begin;

create or replace function ktk_private.movement_segment_hits_circle(
 p_start_x double precision,p_start_y double precision,
 p_end_x double precision,p_end_y double precision,
 p_center_x double precision,p_center_y double precision,
 p_radius double precision
)
returns boolean
language plpgsql immutable
set search_path=''
as $function$
declare
 v_dx double precision;
 v_dy double precision;
 v_length_squared double precision;
 v_projection double precision;
 v_start_distance double precision;
 v_closest_distance double precision;
 v_closest_x double precision;
 v_closest_y double precision;
begin
 if p_radius is null or p_radius<=0 then return false; end if;
 v_dx:=p_end_x-p_start_x;
 v_dy:=p_end_y-p_start_y;
 v_length_squared:=v_dx*v_dx+v_dy*v_dy;
 if v_length_squared<=0.000000000001 then return false; end if;

 v_start_distance:=pg_catalog.sqrt(
  pg_catalog.power(p_start_x-p_center_x,2)+pg_catalog.power(p_start_y-p_center_y,2)
 );
 v_projection:=greatest(0.0,least(1.0,
  ((p_center_x-p_start_x)*v_dx+(p_center_y-p_start_y)*v_dy)/v_length_squared
 ));
 v_closest_x:=p_start_x+v_dx*v_projection;
 v_closest_y:=p_start_y+v_dy*v_projection;
 v_closest_distance:=pg_catalog.sqrt(
  pg_catalog.power(v_closest_x-p_center_x,2)+pg_catalog.power(v_closest_y-p_center_y,2)
 );

 -- Se já começou dentro do raio, permite sair sem se aproximar mais.
 if v_start_distance<p_radius then
  return v_closest_distance+0.01<v_start_distance;
 end if;
 -- A menor distância do segmento detecta tunneling mesmo com endpoint além do obstáculo.
 return v_closest_distance<p_radius;
end;
$function$;

revoke all on function ktk_private.movement_segment_hits_circle(
 double precision,double precision,double precision,double precision,
 double precision,double precision,double precision
) from public,anon,authenticated;

create or replace function ktk_private.apply_player_movement_segment(
 p_user_id uuid,p_start_x double precision,p_start_y double precision,
 p_input_x smallint,p_input_y smallint,p_speed double precision,p_elapsed double precision
)
returns table(x double precision,y double precision)
language plpgsql set search_path=''
as $function$
declare
 v_length double precision;
 v_dx double precision;
 v_dy double precision;
 v_next_x double precision;
 v_next_y double precision;
 v_blocked boolean;
begin
 if p_elapsed<=0
    or (coalesce(p_input_x,0)=0 and coalesce(p_input_y,0)=0)
    or p_speed<=0 then
  return query select p_start_x,p_start_y;
  return;
 end if;
 v_length:=pg_catalog.sqrt(
  pg_catalog.power(coalesce(p_input_x,0)::double precision,2)
  +pg_catalog.power(coalesce(p_input_y,0)::double precision,2)
 );
 if v_length<=0 then return query select p_start_x,p_start_y; return; end if;
 v_dx:=(coalesce(p_input_x,0)::double precision/v_length)*p_speed*p_elapsed;
 v_dy:=(coalesce(p_input_y,0)::double precision/v_length)*p_speed*p_elapsed;

 -- Horizontal: valida o segmento completo até o novo X.
 v_next_x:=p_start_x+v_dx;
 select exists(
  select 1 from public.ktk_world_players other_player
  where other_player.world_id='main'
   and other_player.user_id<>p_user_id
   and other_player.is_alive=true
   and ktk_private.movement_segment_hits_circle(
    p_start_x,p_start_y,v_next_x,p_start_y,
    other_player.x,other_player.y,36.0
   )
  union all
  select 1 from public.ktk_world_entities entity
  where entity.world_id='main'
   and entity.entity_type='enemy'
   and coalesce((entity.state->>'defeated')::boolean,false)=false
   and ktk_private.movement_segment_hits_circle(
    p_start_x,p_start_y,v_next_x,p_start_y,
    entity.x,entity.y,18.0+greatest(0.0,coalesce(entity.collision_radius,0)::double precision)
   )
 ) into v_blocked;
 if v_blocked then v_next_x:=p_start_x; end if;

 -- Vertical: valida o segmento Y a partir do X horizontal já aceito.
 v_next_y:=p_start_y+v_dy;
 select exists(
  select 1 from public.ktk_world_players other_player
  where other_player.world_id='main'
   and other_player.user_id<>p_user_id
   and other_player.is_alive=true
   and ktk_private.movement_segment_hits_circle(
    v_next_x,p_start_y,v_next_x,v_next_y,
    other_player.x,other_player.y,36.0
   )
  union all
  select 1 from public.ktk_world_entities entity
  where entity.world_id='main'
   and entity.entity_type='enemy'
   and coalesce((entity.state->>'defeated')::boolean,false)=false
   and ktk_private.movement_segment_hits_circle(
    v_next_x,p_start_y,v_next_x,v_next_y,
    entity.x,entity.y,18.0+greatest(0.0,coalesce(entity.collision_radius,0)::double precision)
   )
 ) into v_blocked;
 if v_blocked then v_next_y:=p_start_y; end if;

 return query select v_next_x,v_next_y;
end;
$function$;

revoke all on function ktk_private.apply_player_movement_segment(
 uuid,double precision,double precision,smallint,smallint,double precision,double precision
) from public,anon,authenticated;

comment on function ktk_private.apply_player_movement_segment(
 uuid,double precision,double precision,smallint,smallint,double precision,double precision
) is 'Applies axis-separated server-authoritative movement with swept-segment collision checks for players and enemies.';

commit;
