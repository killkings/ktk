begin;

create or replace function ktk_private.simulate_player_survival(
  p_dt double precision
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
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

    if not v_is_moving and v_stamina>=50 and v_health>=10 and v_health<50 then
      v_health:=least(50,v_health+(0.5*p_dt));
    elsif (v_satiety<=0 or v_hydration<=0) and v_health>0 then
      v_health:=greatest(0,v_health-(0.5*p_dt));
    end if;

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
    else
      update public.ktk_world_players set state=v_state where user_id=v_player.user_id;
    end if;
  end loop;
end;
$function$;

create or replace function ktk_private.simulate_enemy_ai(
  p_dt double precision
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_enemy public.ktk_world_entities;
  v_player public.ktk_world_players;
  v_enemy_state jsonb;
  v_dx double precision;
  v_dy double precision;
  v_dist double precision;
  v_step double precision;
  v_enemy_x double precision;
  v_enemy_y double precision;
  v_next_attack timestamptz;
  v_raw_damage integer;
begin
  select * into v_enemy
  from public.ktk_world_entities
  where world_id='main' and entity_id='skeleton-1' and entity_type='enemy'
  for update;

  if found and not coalesce((v_enemy.state->>'defeated')::boolean,false) then
    v_enemy_x:=v_enemy.x;
    v_enemy_y:=v_enemy.y;
    v_enemy_state:=v_enemy.state;
    v_next_attack:=nullif(v_enemy_state->>'attack_ready_at','')::timestamptz;

    select * into v_player
    from public.ktk_world_players
    where world_id='main' and is_alive=true and last_seen_at>now()-interval '30 seconds'
    order by sqrt(power(x-v_enemy_x,2)+power(y-v_enemy_y,2))
    limit 1
    for update skip locked;

    if found then
      v_dx:=v_player.x-v_enemy_x;
      v_dy:=v_player.y-v_enemy_y;
      v_dist:=sqrt(power(v_dx,2)+power(v_dy,2));

      if v_dist>48 and v_dist<520 then
        v_step:=least(90.0*p_dt,v_dist-42);
        v_enemy_x:=v_enemy_x+(v_dx/nullif(v_dist,0))*v_step;
        v_enemy_y:=v_enemy_y+(v_dy/nullif(v_dist,0))*v_step;
      end if;

      v_enemy_state:=v_enemy_state||jsonb_build_object(
        'direction',
        case
          when abs(v_dx)>abs(v_dy) then case when v_dx<0 then 1 else 3 end
          else case when v_dy<0 then 0 else 2 end
        end
      );

      if v_dist<=76 and (v_next_attack is null or v_next_attack<=now()) then
        v_raw_damage:=greatest(1,coalesce((v_enemy_state->>'attack')::integer,7));
        perform ktk_private.apply_player_hit(
          v_player.user_id,v_raw_damage,
          case when abs(v_dx)>abs(v_dy) then sign(v_dx) else 0 end,
          case when abs(v_dy)>=abs(v_dx) then sign(v_dy) else 0 end
        );
        v_enemy_state:=jsonb_set(v_enemy_state,'{attack_ready_at}',to_jsonb(now()+interval '1.2 seconds'),true);
        v_enemy_state:=jsonb_set(v_enemy_state,'{attack_started_at}',to_jsonb(now()),true);
      end if;
    end if;

    update public.ktk_world_entities
    set x=v_enemy_x,y=v_enemy_y,
        state=v_enemy_state||jsonb_build_object(
          'health',coalesce((v_enemy_state->>'health')::integer,60),
          'max_health',coalesce((v_enemy_state->>'max_health')::integer,100),
          'defeated',coalesce((v_enemy_state->>'defeated')::boolean,false)
        ),
        revision=revision+1,updated_at=now()
    where world_id='main' and entity_id='skeleton-1';
  end if;
end;
$function$;

create or replace function ktk_private.simulation_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_world public.ktk_worlds;
  v_dt double precision;
begin
  select * into v_world from public.ktk_worlds where id='main' for update;
  if not found then return; end if;

  v_dt:=least(2.0,greatest(0.0,extract(epoch from (now()-v_world.last_simulation_at))));
  if v_dt<0.5 then return; end if;
  update public.ktk_worlds set last_simulation_at=now() where id='main';

  perform ktk_private.simulate_player_survival(v_dt);
  perform ktk_private.simulate_enemy_ai(v_dt);
end;
$function$;

revoke all on function ktk_private.simulate_player_survival(double precision)
  from public, anon, authenticated, service_role;
revoke all on function ktk_private.simulate_enemy_ai(double precision)
  from public, anon, authenticated, service_role;

comment on function ktk_private.simulation_tick()
  is 'Single coordinator for authoritative player survival and enemy simulation; preserves the world lock and cron entry point.';

commit;
