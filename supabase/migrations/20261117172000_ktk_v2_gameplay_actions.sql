begin;

create schema if not exists ktk_v2_private;
revoke all on schema ktk_v2_private from public, anon, authenticated;

alter table public.ktk_v2_worlds
  add column if not exists settings jsonb not null
  default '{"loot_ttl_seconds":900,"drop_inventory_on_death":true}'::jsonb;

create table if not exists public.ktk_v2_item_catalog (
  item_id text primary key,
  display_name text not null,
  item_type text not null,
  wear_slot text null,
  attack_bonus integer not null default 0,
  defense_bonus integer not null default 0,
  range_tiles numeric not null default 0.8,
  stamina_cost numeric not null default 0,
  attack_interval numeric not null default 0.5,
  max_durability integer not null default 0,
  durability_unit text null,
  two_handed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default clock_timestamp(),
  constraint ktk_v2_item_catalog_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

alter table public.ktk_v2_item_catalog enable row level security;
revoke all on table public.ktk_v2_item_catalog from public, anon, authenticated;

insert into public.ktk_v2_item_catalog (
  item_id,display_name,item_type,wear_slot,attack_bonus,defense_bonus,
  range_tiles,stamina_cost,attack_interval,max_durability,durability_unit,two_handed,metadata
) values
  ('resource-wood','Madeira','material',null,0,0,0,0,0,0,null,false,'{"stackable":true}'::jsonb),
  ('resource-stone','Pedra','material',null,0,0,0,0,0,0,null,false,'{"stackable":true}'::jsonb),
  ('resource-bone','Osso','material',null,0,0,0,0,0,0,null,false,'{"stackable":true}'::jsonb),
  ('resource-berries','Frutas silvestres','food',null,0,0,0,0,0,0,null,false,'{"stackable":true,"satiety":18}'::jsonb),
  ('resource-water','Água limpa','drink',null,0,0,0,0,0,0,null,false,'{"stackable":true,"hydration":24}'::jsonb),
  ('cosmetic-linen-shirt','Camisa de linho','apparel','chest',0,0,0.8,0,0.5,0,null,false,
    '{"appearance_layers":[{"z":65,"path":"torso/clothes/shortsleeve/shortsleeve/{gender}/walk.png","mode":"tint","palette":"#e7e2c9"}]}'::jsonb),
  ('armor-head-base','Capacete','armor','head',0,1,0.8,3,0.5,100,'hits',false,
    '{"appearance_layers":[{"z":125,"path":"head/armour/helmet/{gender}/walk.png"}]}'::jsonb),
  ('armor-chest-base','Armadura','armor','chest',0,3,0.8,3,0.5,100,'hits',false,
    '{"appearance_layers":[{"z":70,"path":"torso/armour/plate/{gender}/walk.png"}]}'::jsonb),
  ('armor-waist-base','Cinto reforçado','armor','waist',0,1,0.8,3,0.5,100,'hits',false,
    '{"appearance_layers":[{"z":30,"path":"torso/waist/belt_leather/{gender}/walk.png"}]}'::jsonb),
  ('armor-legs-base','Grevas','armor','legs',0,2,0.8,3,0.5,100,'hits',false,
    '{"appearance_layers":[{"z":28,"path":"legs/armour/plate/{lowerBodyGender}/walk.png"}]}'::jsonb),
  ('armor-feet-base','Botas reforçadas','armor','feet',0,1,0.8,3,0.5,100,'hits',false,
    '{"appearance_layers":[{"z":32,"path":"feet/armour/plate/{lowerBodyGender}/walk.png"}]}'::jsonb),
  ('equipment-longsword','Espada longa','weapon',null,10,0,1.5,8,1.0,150,'hits',false,'{"material":"iron"}'::jsonb),
  ('equipment-arming-sword-iron','Espada de combate de ferro','weapon',null,8,0,1.25,7,0.8,173,'hits',false,'{"material":"iron"}'::jsonb),
  ('equipment-pickaxe','Picareta','tool',null,6,0,0.9,6,1.0,150,'uses',false,'{"work_efficiency":1}'::jsonb),
  ('equipment-axe','Machado','tool',null,7,0,0.9,6,1.0,150,'uses',false,'{"work_efficiency":1}'::jsonb),
  ('equipment-shield','Escudo','shield',null,0,4,0.8,3,0.5,100,'blocks',false,'{}'::jsonb),
  ('equipment-bow-normal','Arco','ranged',null,7,0,8,5,1.0,120,'shots',true,'{"ammo":"arrow"}'::jsonb),
  ('equipment-crossbow','Besta','ranged',null,12,0,11,8,1.8,120,'shots',true,'{"ammo":"arrow"}'::jsonb),
  ('equipment-boomerang','Bumerangue','ranged',null,6,0,6,4,1.0,160,'throws',false,'{}'::jsonb),
  ('equipment-arrow','Flecha','ammo',null,0,0,0,0,0.5,0,null,false,'{"stackable":true}'::jsonb)
on conflict (item_id) do nothing;

-- Bring forward the complete V1 item balance when it exists. The V2 test
-- database intentionally has no V1 private schema, so it uses the seed above.
do $copy_v1_catalog$
begin
  if pg_catalog.to_regclass('ktk_private.item_catalog') is not null then
    execute $sql$
      insert into public.ktk_v2_item_catalog(
        item_id,display_name,item_type,wear_slot,attack_bonus,defense_bonus,
        range_tiles,stamina_cost,attack_interval,max_durability,durability_unit,
        two_handed,metadata
      )
      select item_id,display_name,item_type,wear_slot,attack_bonus,defense_bonus,
        range_tiles,stamina_cost,attack_interval,max_durability,durability_unit,
        two_handed,metadata
      from ktk_private.item_catalog
      on conflict (item_id) do update set
        display_name=excluded.display_name,
        item_type=excluded.item_type,
        wear_slot=excluded.wear_slot,
        attack_bonus=excluded.attack_bonus,
        defense_bonus=excluded.defense_bonus,
        range_tiles=excluded.range_tiles,
        stamina_cost=excluded.stamina_cost,
        attack_interval=excluded.attack_interval,
        max_durability=excluded.max_durability,
        durability_unit=excluded.durability_unit,
        two_handed=excluded.two_handed,
        metadata=public.ktk_v2_item_catalog.metadata || excluded.metadata,
        updated_at=clock_timestamp()
    $sql$;
  end if;
end;
$copy_v1_catalog$;

insert into public.ktk_v2_entities(
  world_id,entity_id,entity_type,x,y,collision_radius,state,revision
) values
  ('main','item-starter-sword','item',1098,548,5,
    '{"status":"ground","item_id":"equipment-longsword","display_name":"Espada longa","quantity":1,"durability":150,"max_durability":150,"expires_at":null}'::jsonb,1),
  ('main','item-starter-pickaxe','item',1118,558,5,
    '{"status":"ground","item_id":"equipment-pickaxe","display_name":"Picareta","quantity":1,"durability":150,"max_durability":150,"expires_at":null}'::jsonb,1),
  ('main','item-starter-bow','item',1100,580,5,
    '{"status":"ground","item_id":"equipment-bow-normal","display_name":"Arco","quantity":1,"durability":120,"max_durability":120,"expires_at":null}'::jsonb,1),
  ('main','item-starter-arrows','item',1120,580,5,
    '{"status":"ground","item_id":"equipment-arrow","display_name":"Flecha","quantity":12,"durability":0,"max_durability":0,"expires_at":null}'::jsonb,1),
  ('main','resource-tree-1','resource',1180,560,15,
    '{"status":"ready","resource_kind":"tree","display_name":"Árvore","health":3,"max_health":3,"drop_item_id":"resource-wood","drop_quantity":2,"required_tool":"equipment-axe"}'::jsonb,1),
  ('main','resource-rock-1','resource',1215,600,14,
    '{"status":"ready","resource_kind":"rock","display_name":"Rocha","health":3,"max_health":3,"drop_item_id":"resource-stone","drop_quantity":2,"required_tool":"equipment-pickaxe"}'::jsonb,1),
  ('main','resource-berries-1','resource',1150,620,12,
    '{"status":"ready","resource_kind":"berries","display_name":"Arbusto de frutas","health":2,"max_health":2,"drop_item_id":"resource-berries","drop_quantity":2}'::jsonb,1),
  ('main','skeleton-1','enemy',1390,560,14,
    '{"kind":"skeleton","display_name":"Esqueleto","health":70,"max_health":70,"attack":7,"defense":4,"defeated":false,"attack_ready_at":null,"attack_started_at":null}'::jsonb,1)
on conflict (world_id,entity_id) do nothing;

create or replace function ktk_v2_private.drop_player_items(
  p_player_id uuid,
  p_x double precision,
  p_y double precision,
  p_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_state jsonb := coalesce(p_state,'{}'::jsonb);
  v_inventory jsonb := coalesce(v_state->'inventory','[null,null]'::jsonb);
  v_wearables jsonb := coalesce(v_state->'wearables','{}'::jsonb);
  v_entry jsonb;
  v_ttl integer := 900;
  v_slot text;
  v_index integer;
  v_offset integer := 0;
begin
  select greatest(60,least(86400,coalesce((settings->>'loot_ttl_seconds')::integer,900)))
    into v_ttl
  from public.ktk_v2_worlds where id='main';

  for v_index in 0..jsonb_array_length(v_inventory)-1 loop
    v_entry := v_inventory->v_index;
    if v_entry is null or v_entry='null'::jsonb then continue; end if;
    insert into public.ktk_v2_entities(
      world_id,entity_id,entity_type,x,y,collision_radius,state,revision
    ) values (
      'main','drop-'||gen_random_uuid()::text,'item',
      p_x+24+(v_offset*7),p_y+18+(v_offset*5),5,
      jsonb_build_object(
        'status','ground','item_id',v_entry->>'item_id',
        'display_name',coalesce(v_entry->>'displayName',v_entry->>'display_name','Item'),
        'quantity',greatest(1,coalesce((v_entry->>'quantity')::integer,1)),
        'durability',coalesce((v_entry->>'durability')::integer,0),
        'max_durability',coalesce((v_entry->>'maxDurability')::integer,(v_entry->>'max_durability')::integer,0),
        'expires_at',clock_timestamp()+make_interval(secs=>v_ttl),
        'dropped_by',p_player_id::text
      ),1
    );
    v_offset:=v_offset+1;
  end loop;

  foreach v_slot in array array['head','chest','waist','legs','feet'] loop
    v_entry:=v_wearables->v_slot;
    if v_entry is null or v_entry='null'::jsonb then continue; end if;
    insert into public.ktk_v2_entities(
      world_id,entity_id,entity_type,x,y,collision_radius,state,revision
    ) values (
      'main','drop-'||gen_random_uuid()::text,'item',
      p_x-22-(v_offset*6),p_y+16+(v_offset*5),5,
      jsonb_build_object(
        'status','ground','item_id',v_entry->>'item_id',
        'display_name',coalesce(v_entry->>'displayName',v_entry->>'display_name','Equipamento'),
        'quantity',1,
        'durability',coalesce((v_entry->>'durability')::integer,0),
        'max_durability',coalesce((v_entry->>'maxDurability')::integer,(v_entry->>'max_durability')::integer,0),
        'expires_at',clock_timestamp()+make_interval(secs=>v_ttl),
        'dropped_by',p_player_id::text
      ),1
    );
    v_offset:=v_offset+1;
  end loop;

  v_state:=jsonb_set(v_state,'{inventory}','[null,null]'::jsonb,true);
  v_state:=jsonb_set(v_state,'{wearables}',
    '{"head":null,"chest":null,"waist":null,"legs":null,"feet":null}'::jsonb,true);
  return v_state;
end;
$function$;

create or replace function ktk_v2_private.kill_player(
  p_user_id uuid,
  p_reason text default 'combat'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_player public.ktk_v2_players;
  v_state jsonb;
  v_is_king boolean := false;
begin
  select * into v_player
  from public.ktk_v2_players
  where user_id=p_user_id and world_id='main'
  for update;
  if not found or not v_player.is_alive then return false; end if;

  v_state:=ktk_v2_private.drop_player_items(
    p_user_id,v_player.x,v_player.y,coalesce(v_player.state,'{}'::jsonb)
  );
  v_state:=jsonb_set(v_state,'{health}','0'::jsonb,true);
  v_state:=jsonb_set(v_state,'{moving}','false'::jsonb,true);
  v_state:=jsonb_set(v_state,'{running}','false'::jsonb,true);
  v_state:=jsonb_set(v_state,'{guarding}','false'::jsonb,true);
  v_state:=jsonb_set(v_state,'{death_reason}',to_jsonb(left(coalesce(p_reason,'death'),50)),true);
  v_state:=jsonb_set(v_state,'{died_at}',to_jsonb(clock_timestamp()),true);

  update public.ktk_v2_players
  set is_alive=false,state=v_state,revision=revision+1,
      last_seen_at=clock_timestamp(),position_updated_at=clock_timestamp()
  where user_id=p_user_id and world_id='main';

  select king_user_id=p_user_id into v_is_king
  from public.ktk_v2_worlds where id='main';
  if coalesce(v_is_king,false) then
    update public.ktk_v2_worlds
    set king_user_id=null,crown_version=crown_version+1,
        revision=revision+1,updated_at=clock_timestamp()
    where id='main' and king_user_id=p_user_id;

    update public.ktk_v2_entities
    set x=v_player.x,y=v_player.y,
        state=jsonb_build_object('status','ground','unique',true,'dropped_after_death',true),
        revision=revision+1,updated_at=clock_timestamp()
    where world_id='main' and entity_id='crown-main';
  end if;
  return true;
end;
$function$;

create or replace function public.ktk_v2_choose_clan(p_color text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_player public.ktk_v2_players;
  v_color text:=lower(trim(coalesce(p_color,'')));
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_color not in ('#d94343','#3d75d6','#4b9f62','#d9ae38','#8b61c2','#e97e28','#45a9a2','#c05a9b') then
    raise exception 'INVALID_CLAN_COLOR';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ktk-v2:main:movement'));
  select * into v_player from public.ktk_v2_players
  where user_id=v_uid and world_id='main' and is_alive for update;
  if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;
  if v_player.clan_color is not null and v_player.clan_color<>v_color then
    raise exception 'CLAN_ALREADY_CHOSEN';
  end if;
  update public.ktk_v2_players
  set clan_color=v_color,revision=revision+1
  where user_id=v_uid and world_id='main'
  returning * into v_player;
  return to_jsonb(v_player);
end;
$function$;

create or replace function public.ktk_v2_item_action(
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_player public.ktk_v2_players;
  v_entity public.ktk_v2_entities;
  v_item_def public.ktk_v2_item_catalog;
  v_tool_def public.ktk_v2_item_catalog;
  v_state jsonb;
  v_inventory jsonb;
  v_wearables jsonb;
  v_item jsonb;
  v_old_item jsonb;
  v_slot integer;
  v_index integer;
  v_free_slot integer:=-1;
  v_wear_slot text;
  v_entity_id text;
  v_quantity integer;
  v_drop_quantity integer;
  v_efficiency numeric:=1;
  v_health numeric;
  v_required_tool text;
  v_drop_item_id text;
  v_drop_quantity_from_resource integer;
  v_stacked boolean:=false;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_action not in ('pickup','drop','equip','unequip','consume','select_slot','harvest') then
    raise exception 'UNKNOWN_ITEM_ACTION';
  end if;

  perform pg_catalog.set_config('lock_timeout','500ms',true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ktk-v2:main:movement'));

  select * into v_player from public.ktk_v2_players
  where user_id=v_uid and world_id='main' and is_alive for update;
  if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;

  v_state:=coalesce(v_player.state,'{}'::jsonb);
  v_inventory:=coalesce(v_state->'inventory','[null,null]'::jsonb);
  v_wearables:=coalesce(v_state->'wearables','{"head":null,"chest":null,"waist":null,"legs":null,"feet":null}'::jsonb);

  if p_action='select_slot' then
    v_slot:=coalesce((p_payload->>'slot')::integer,-1);
    if v_slot not between 0 and jsonb_array_length(v_inventory)-1 then raise exception 'INVALID_SLOT'; end if;
    v_state:=jsonb_set(v_state,'{selected_slot}',to_jsonb(v_slot),true);

  elsif p_action='pickup' then
    v_entity_id:=left(coalesce(p_payload->>'entity_id',''),120);
    select * into v_entity from public.ktk_v2_entities
    where world_id='main' and entity_id=v_entity_id and entity_type='item'
    for update;
    if not found or coalesce(v_entity.state->>'status','ground')<>'ground' then raise exception 'ITEM_NOT_AVAILABLE'; end if;
    if nullif(v_entity.state->>'expires_at','') is not null
       and (v_entity.state->>'expires_at')::timestamptz<=clock_timestamp() then
      raise exception 'ITEM_EXPIRED';
    end if;
    if sqrt(power(v_player.x-v_entity.x,2)+power(v_player.y-v_entity.y,2))>64 then
      raise exception 'ITEM_TOO_FAR';
    end if;
    select * into v_item_def from public.ktk_v2_item_catalog
    where item_id=v_entity.state->>'item_id';
    if not found then raise exception 'UNKNOWN_ITEM'; end if;

    v_item:=jsonb_build_object(
      'item_id',v_item_def.item_id,'displayName',v_item_def.display_name,
      'quantity',greatest(1,coalesce((v_entity.state->>'quantity')::integer,1)),
      'durability',coalesce((v_entity.state->>'durability')::integer,v_item_def.max_durability),
      'maxDurability',v_item_def.max_durability,
      'appearanceLayers',coalesce(v_item_def.metadata->'appearance_layers','[]'::jsonb),
      'itemType',v_item_def.item_type,'wearSlot',v_item_def.wear_slot,
      'attackBonus',v_item_def.attack_bonus,'defenseBonus',v_item_def.defense_bonus,
      'twoHanded',v_item_def.two_handed
    );
    v_wear_slot:=v_item_def.wear_slot;

    if v_item_def.item_type in ('apparel','armor') and v_wear_slot is not null
       and coalesce(v_wearables->v_wear_slot,'null'::jsonb)='null'::jsonb then
      v_wearables:=jsonb_set(v_wearables,array[v_wear_slot],v_item,true);
    else
      v_stacked:=false;
      if coalesce((v_item_def.metadata->>'stackable')::boolean,false) then
        for v_index in 0..jsonb_array_length(v_inventory)-1 loop
          if v_inventory->v_index<>'null'::jsonb
             and v_inventory->v_index->>'item_id'=v_item_def.item_id then
            v_old_item:=v_inventory->v_index;
            if coalesce((v_old_item->>'quantity')::integer,1)
               +coalesce((v_item->>'quantity')::integer,1)>99 then
              raise exception 'STACK_LIMIT';
            end if;
            v_item:=jsonb_set(v_old_item,'{quantity}',
              to_jsonb(coalesce((v_old_item->>'quantity')::integer,1)
                +coalesce((v_item->>'quantity')::integer,1)),true);
            v_inventory:=jsonb_set(v_inventory,array[v_index::text],v_item,true);
            v_stacked:=true;
            exit;
          end if;
        end loop;
      end if;
      if not v_stacked then
        v_free_slot:=-1;
        for v_index in 0..jsonb_array_length(v_inventory)-1 loop
          if v_inventory->v_index='null'::jsonb then v_free_slot:=v_index; exit; end if;
        end loop;
        if v_free_slot<0 then raise exception 'INVENTORY_FULL'; end if;
        v_inventory:=jsonb_set(v_inventory,array[v_free_slot::text],v_item,true);
      end if;
    end if;
    delete from public.ktk_v2_entities
    where world_id='main' and entity_id=v_entity_id;

  elsif p_action='drop' then
    v_slot:=coalesce((p_payload->>'slot')::integer,-1);
    if v_slot<0 or v_slot>=jsonb_array_length(v_inventory) then raise exception 'INVALID_SLOT'; end if;
    v_item:=v_inventory->v_slot;
    if v_item is null or v_item='null'::jsonb then raise exception 'EMPTY_SLOT'; end if;
    v_quantity:=greatest(1,coalesce((v_item->>'quantity')::integer,1));
    v_drop_quantity:=greatest(1,least(v_quantity,coalesce((p_payload->>'quantity')::integer,v_quantity)));
    if v_drop_quantity=v_quantity then
      v_inventory:=jsonb_set(v_inventory,array[v_slot::text],'null'::jsonb,true);
    else
      v_inventory:=jsonb_set(v_inventory,array[v_slot::text],
        jsonb_set(v_item,'{quantity}',to_jsonb(v_quantity-v_drop_quantity),true),true);
    end if;
    insert into public.ktk_v2_entities(
      world_id,entity_id,entity_type,x,y,collision_radius,state,revision
    ) values (
      'main','drop-'||gen_random_uuid()::text,'item',
      v_player.x+24,v_player.y+18,5,
      jsonb_build_object(
        'status','ground','item_id',v_item->>'item_id',
        'display_name',coalesce(v_item->>'displayName','Item'),
        'quantity',v_drop_quantity,
        'durability',coalesce((v_item->>'durability')::integer,0),
        'max_durability',coalesce((v_item->>'maxDurability')::integer,0),
        'expires_at',clock_timestamp()+make_interval(secs=>coalesce((select (settings->>'loot_ttl_seconds')::integer from public.ktk_v2_worlds where id='main'),900))
      ),1
    );

  elsif p_action='equip' then
    v_slot:=coalesce((p_payload->>'slot')::integer,-1);
    if v_slot<0 or v_slot>=jsonb_array_length(v_inventory) then raise exception 'INVALID_SLOT'; end if;
    v_item:=v_inventory->v_slot;
    if v_item is null or v_item='null'::jsonb then raise exception 'EMPTY_SLOT'; end if;
    select * into v_item_def from public.ktk_v2_item_catalog where item_id=v_item->>'item_id';
    if not found or v_item_def.wear_slot is null or v_item_def.item_type not in ('apparel','armor') then
      raise exception 'ITEM_NOT_EQUIPPABLE';
    end if;
    v_wear_slot:=v_item_def.wear_slot;
    v_old_item:=coalesce(v_wearables->v_wear_slot,'null'::jsonb);
    v_wearables:=jsonb_set(v_wearables,array[v_wear_slot],v_item,true);
    v_inventory:=jsonb_set(v_inventory,array[v_slot::text],v_old_item,true);

  elsif p_action='unequip' then
    v_wear_slot:=coalesce(p_payload->>'wear_slot','');
    if v_wear_slot not in ('head','chest','waist','legs','feet') then raise exception 'INVALID_WEAR_SLOT'; end if;
    v_item:=coalesce(v_wearables->v_wear_slot,'null'::jsonb);
    if v_item='null'::jsonb then raise exception 'EMPTY_WEAR_SLOT'; end if;
    v_free_slot:=-1;
    for v_index in 0..jsonb_array_length(v_inventory)-1 loop
      if v_inventory->v_index='null'::jsonb then v_free_slot:=v_index; exit; end if;
    end loop;
    if v_free_slot<0 then raise exception 'INVENTORY_FULL'; end if;
    v_inventory:=jsonb_set(v_inventory,array[v_free_slot::text],v_item,true);
    v_wearables:=jsonb_set(v_wearables,array[v_wear_slot],'null'::jsonb,true);

  elsif p_action='consume' then
    v_slot:=coalesce((p_payload->>'slot')::integer,-1);
    if v_slot<0 or v_slot>=jsonb_array_length(v_inventory) then raise exception 'INVALID_SLOT'; end if;
    v_item:=v_inventory->v_slot;
    select * into v_item_def from public.ktk_v2_item_catalog where item_id=v_item->>'item_id';
    if not found or v_item_def.item_type not in ('food','drink') then raise exception 'NOT_CONSUMABLE'; end if;
    if v_item_def.item_type='food' then
      v_state:=jsonb_set(v_state,'{satiety}',to_jsonb(least(99,coalesce((v_state->>'satiety')::numeric,0)+coalesce((v_item_def.metadata->>'satiety')::numeric,0))),true);
    else
      v_state:=jsonb_set(v_state,'{hydration}',to_jsonb(least(99,coalesce((v_state->>'hydration')::numeric,0)+coalesce((v_item_def.metadata->>'hydration')::numeric,0))),true);
    end if;
    v_quantity:=greatest(1,coalesce((v_item->>'quantity')::integer,1))-1;
    if v_quantity<=0 then
      v_inventory:=jsonb_set(v_inventory,array[v_slot::text],'null'::jsonb,true);
    else
      v_inventory:=jsonb_set(v_inventory,array[v_slot::text],
        jsonb_set(v_item,'{quantity}',to_jsonb(v_quantity),true),true);
    end if;

  elsif p_action='harvest' then
    v_entity_id:=left(coalesce(p_payload->>'entity_id',''),120);
    select * into v_entity from public.ktk_v2_entities
    where world_id='main' and entity_id=v_entity_id and entity_type='resource'
    for update;
    if not found or coalesce(v_entity.state->>'status','ready')<>'ready' then raise exception 'RESOURCE_DEPLETED'; end if;
    if sqrt(power(v_player.x-v_entity.x,2)+power(v_player.y-v_entity.y,2))>80 then raise exception 'RESOURCE_TOO_FAR'; end if;
    v_required_tool:=nullif(v_entity.state->>'required_tool','');
    if v_required_tool is not null then
      v_free_slot:=-1;
      for v_index in 0..jsonb_array_length(v_inventory)-1 loop
        if v_inventory->v_index->>'item_id'=v_required_tool then v_free_slot:=v_index; exit; end if;
      end loop;
      if v_free_slot<0 then raise exception 'REQUIRED_TOOL_MISSING'; end if;
      select * into v_tool_def from public.ktk_v2_item_catalog where item_id=v_required_tool;
      v_efficiency:=greatest(1,coalesce((v_tool_def.metadata->>'work_efficiency')::numeric,1));
      v_item:=v_inventory->v_free_slot;
      v_quantity:=greatest(0,coalesce((v_item->>'durability')::integer,v_tool_def.max_durability)-1);
      if v_quantity<=0 then
        v_inventory:=jsonb_set(v_inventory,array[v_free_slot::text],'null'::jsonb,true);
      else
        v_inventory:=jsonb_set(v_inventory,array[v_free_slot::text],
          jsonb_set(v_item,'{durability}',to_jsonb(v_quantity),true),true);
      end if;
    end if;
    v_health:=greatest(0,coalesce((v_entity.state->>'health')::numeric,1)-v_efficiency);
    v_drop_item_id:=coalesce(v_entity.state->>'drop_item_id','');
    v_drop_quantity_from_resource:=greatest(1,coalesce((v_entity.state->>'drop_quantity')::integer,1));
    if v_health<=0 then
      update public.ktk_v2_entities
      set state=state||jsonb_build_object('status','depleted','health',0,
            'respawn_at',clock_timestamp()+interval '5 minutes'),
          revision=revision+1,updated_at=clock_timestamp()
      where world_id='main' and entity_id=v_entity_id;
      if v_drop_item_id<>'' then
        insert into public.ktk_v2_entities(
          world_id,entity_id,entity_type,x,y,collision_radius,state,revision
        ) values (
          'main','drop-'||gen_random_uuid()::text,'item',
          v_entity.x+18,v_entity.y+12,5,
          jsonb_build_object('status','ground','item_id',v_drop_item_id,
            'display_name',(select display_name from public.ktk_v2_item_catalog where item_id=v_drop_item_id),
            'quantity',v_drop_quantity_from_resource,
            'expires_at',clock_timestamp()+interval '15 minutes'),1
        );
      end if;
    else
      update public.ktk_v2_entities
      set state=state||jsonb_build_object('health',v_health),
          revision=revision+1,updated_at=clock_timestamp()
      where world_id='main' and entity_id=v_entity_id;
    end if;
  end if;

  v_state:=jsonb_set(v_state,'{inventory}',v_inventory,true);
  v_state:=jsonb_set(v_state,'{wearables}',v_wearables,true);
  update public.ktk_v2_players
  set state=v_state,revision=revision+1
  where user_id=v_uid and world_id='main'
  returning * into v_player;
  return jsonb_build_object('ok',true,'player',to_jsonb(v_player));
end;
$function$;

create or replace function public.ktk_v2_attack()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_player public.ktk_v2_players;
  v_target public.ktk_v2_players;
  v_enemy public.ktk_v2_entities;
  v_world public.ktk_v2_worlds;
  v_inventory jsonb;
  v_state jsonb;
  v_target_state jsonb;
  v_item jsonb;
  v_item_def public.ktk_v2_item_catalog;
  v_direction integer;
  v_vx double precision;
  v_vy double precision;
  v_range double precision:=54;
  v_cost numeric:=4;
  v_interval numeric:=0.55;
  v_attack integer:=6;
  v_defense integer:=0;
  v_damage integer:=0;
  v_health integer:=0;
  v_target_id text;
  v_target_type text:='';
  v_blocked boolean:=false;
  v_next_x double precision;
  v_next_y double precision;
  v_distance double precision;
  v_forward double precision;
  v_sideways double precision;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_catalog.set_config('lock_timeout','500ms',true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ktk-v2:main:movement'));

  select * into v_world from public.ktk_v2_worlds where id='main' for update;
  select * into v_player from public.ktk_v2_players
  where user_id=v_uid and world_id='main' and is_alive for update;
  if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;

  v_state:=coalesce(v_player.state,'{}'::jsonb);
  v_inventory:=coalesce(v_state->'inventory','[null,null]'::jsonb);
  v_direction:=v_player.direction;
  v_vx:=case v_direction when 1 then -1 when 3 then 1 else 0 end;
  v_vy:=case v_direction when 0 then -1 when 2 then 1 else 0 end;

  if v_inventory->greatest(0,least(jsonb_array_length(v_inventory)-1,coalesce((v_state->>'selected_slot')::integer,0)))<>'null'::jsonb then
    v_item:=v_inventory->greatest(0,least(jsonb_array_length(v_inventory)-1,coalesce((v_state->>'selected_slot')::integer,0)));
    select * into v_item_def from public.ktk_v2_item_catalog where item_id=v_item->>'item_id';
    if found then
      if v_item_def.item_type in ('ranged','magic') then raise exception 'PROJECTILE_ACTION_REQUIRED'; end if;
      v_attack:=greatest(1,coalesce((v_state->>'attack')::integer,10)+v_item_def.attack_bonus);
      v_range:=greatest(0.75,v_item_def.range_tiles)*72;
      v_cost:=greatest(1,v_item_def.stamina_cost);
      v_interval:=greatest(0.3,v_item_def.attack_interval);
    end if;
  end if;

  if nullif(v_state->>'next_attack_at','') is not null
     and (v_state->>'next_attack_at')::timestamptz>clock_timestamp() then
    raise exception 'ATTACK_COOLDOWN';
  end if;
  if coalesce((v_state->>'stamina')::numeric,100)<v_cost then raise exception 'NOT_ENOUGH_STAMINA'; end if;

  if v_world.king_user_id is not null then
    select * into v_target
    from public.ktk_v2_players p
    where p.world_id='main' and p.is_alive and p.user_id<>v_uid
      and not (
        p.user_id=v_world.king_user_id
        and v_player.clan_color is not null
        and p.clan_color=v_player.clan_color
      )
      and ((p.x-v_player.x)*v_vx+(p.y-v_player.y)*v_vy)>0
      and ((p.x-v_player.x)*v_vx+(p.y-v_player.y)*v_vy)<=v_range+18
      and abs((p.x-v_player.x)*v_vy-(p.y-v_player.y)*v_vx)<=32
    order by sqrt(power(p.x-v_player.x,2)+power(p.y-v_player.y,2))
    limit 1 for update skip locked;
  else
    select * into v_target
    from public.ktk_v2_players p
    where p.world_id='main' and p.is_alive and p.user_id<>v_uid
      and ((p.x-v_player.x)*v_vx+(p.y-v_player.y)*v_vy)>0
      and ((p.x-v_player.x)*v_vx+(p.y-v_player.y)*v_vy)<=v_range+18
      and abs((p.x-v_player.x)*v_vy-(p.y-v_player.y)*v_vx)<=32
    order by sqrt(power(p.x-v_player.x,2)+power(p.y-v_player.y,2))
    limit 1 for update skip locked;
  end if;

  v_state:=jsonb_set(v_state,'{stamina}',to_jsonb(greatest(0,coalesce((v_state->>'stamina')::numeric,100)-v_cost)),true);
  v_state:=jsonb_set(v_state,'{next_attack_at}',to_jsonb(clock_timestamp()+make_interval(secs=>v_interval::double precision)),true);
  v_state:=jsonb_set(v_state,'{last_attack_at}',to_jsonb(clock_timestamp()),true);
  v_state:=jsonb_set(v_state,'{last_attack_direction}',to_jsonb(v_direction),true);
  v_state:=jsonb_set(v_state,'{last_attack_type}',to_jsonb(case when v_item_def.item_id is null then 'punch' else 'slash' end),true);
  update public.ktk_v2_players
  set state=v_state,revision=revision+1
  where user_id=v_uid and world_id='main'
  returning * into v_player;

  if found and v_target.user_id is not null then
    v_target_type:='player';
    v_target_state:=coalesce(v_target.state,'{}'::jsonb);
    select coalesce(sum(c.defense_bonus),0) into v_defense
    from jsonb_each(coalesce(v_target_state->'wearables','{}'::jsonb)) w
    join public.ktk_v2_item_catalog c on c.item_id=w.value->>'item_id';
    v_health:=greatest(0,coalesce((v_target_state->>'health')::integer,100));
    v_damage:=greatest(1,round(v_attack*10.0/(10.0+v_defense))::integer);
    v_health:=greatest(0,v_health-v_damage);
    if v_health<=0 then
      perform ktk_v2_private.kill_player(v_target.user_id,'combat');
      select * into v_target from public.ktk_v2_players where user_id=v_target.user_id and world_id='main';
    else
      v_target_state:=jsonb_set(v_target_state,'{health}',to_jsonb(v_health),true);
      v_target_state:=jsonb_set(v_target_state,'{last_knockback}',jsonb_build_object('x',v_vx,'y',v_vy),true);
      v_target_state:=jsonb_set(v_target_state,'{last_knockback_at}',to_jsonb(clock_timestamp()),true);
      v_next_x:=v_target.x+v_vx*14;
      v_next_y:=v_target.y+v_vy*14;
      select exists(
        select 1 from public.ktk_v2_entities e
        where e.world_id='main' and e.entity_type='obstacle'
          and sqrt(power(v_next_x-e.x,2)+power(v_next_y-e.y,2))<18+e.collision_radius
      ) into v_blocked;
      if not v_blocked then
        v_target_state:=jsonb_set(v_target_state,'{last_knockback_position}',jsonb_build_object('x',v_next_x,'y',v_next_y),true);
      else
        v_next_x:=v_target.x; v_next_y:=v_target.y;
      end if;
      update public.ktk_v2_players
      set x=v_next_x,y=v_next_y,state=v_target_state,
          revision=revision+1,position_updated_at=clock_timestamp(),movement_updated_at=clock_timestamp()
      where user_id=v_target.user_id and world_id='main'
      returning * into v_target;
    end if;
    return jsonb_build_object('ok',true,'hit',true,'target_type',v_target_type,
      'damage',v_damage,'target',to_jsonb(v_target),'attacker',to_jsonb(v_player));
  end if;

  select * into v_enemy
  from public.ktk_v2_entities e
  where e.world_id='main' and e.entity_type='enemy'
    and coalesce((e.state->>'defeated')::boolean,false)=false
    and ((e.x-v_player.x)*v_vx+(e.y-v_player.y)*v_vy)>0
    and ((e.x-v_player.x)*v_vx+(e.y-v_player.y)*v_vy)<=v_range+14
    and abs((e.x-v_player.x)*v_vy-(e.y-v_player.y)*v_vx)<=34
  order by sqrt(power(e.x-v_player.x,2)+power(e.y-v_player.y,2))
  limit 1 for update skip locked;

  if found then
    v_target_type:='enemy';
    v_health:=greatest(0,coalesce((v_enemy.state->>'health')::integer,50));
    v_defense:=greatest(0,coalesce((v_enemy.state->>'defense')::integer,0));
    v_damage:=greatest(1,round(v_attack*10.0/(10.0+v_defense))::integer);
    v_health:=greatest(0,v_health-v_damage);
    update public.ktk_v2_entities
    set x=x+v_vx*10,y=y+v_vy*10,
        state=state||jsonb_build_object('health',v_health,'defeated',v_health<=0,
          'last_hit_by',v_uid::text,'last_hit_at',clock_timestamp()),
        revision=revision+1,updated_at=clock_timestamp()
    where world_id='main' and entity_id=v_enemy.entity_id
    returning * into v_enemy;
    if v_health<=0 then
      insert into public.ktk_v2_entities(
        world_id,entity_id,entity_type,x,y,collision_radius,state,revision
      ) values (
        'main','drop-'||gen_random_uuid()::text,'item',
        v_enemy.x+20,v_enemy.y+12,5,
        jsonb_build_object('status','ground','item_id','resource-bone',
          'display_name','Osso','quantity',2,
          'expires_at',clock_timestamp()+interval '15 minutes'),1
      );
    end if;
    return jsonb_build_object('ok',true,'hit',true,'target_type',v_target_type,
      'damage',v_damage,'target',to_jsonb(v_enemy),'attacker',to_jsonb(v_player));
  end if;

  return jsonb_build_object('ok',true,'hit',false,'reason','NO_TARGET','attacker',to_jsonb(v_player));
end;
$function$;

create or replace function public.ktk_v2_leave_world()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_player public.ktk_v2_players;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  perform pg_catalog.set_config('lock_timeout','500ms',true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('ktk-v2:main:movement'));
  perform 1 from public.ktk_v2_worlds where id='main' for update;

  select * into v_player
  from public.ktk_v2_players
  where user_id=v_uid and world_id='main'
  for update;

  if not found or not v_player.is_alive then
    return jsonb_build_object('ok',true,'already_dead',true);
  end if;

  perform ktk_v2_private.kill_player(v_uid,'exit');
  return jsonb_build_object('ok',true,'dead',true);
end;
$function$;

create or replace function public.ktk_v2_interact()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid:=auth.uid();
  v_player public.ktk_v2_players;
  v_world public.ktk_v2_worlds;
  v_entity public.ktk_v2_entities;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_player from public.ktk_v2_players
  where user_id=v_uid and world_id='main' and is_alive;
  if not found then raise exception 'PLAYER_NOT_ACTIVE'; end if;
  select * into v_world from public.ktk_v2_worlds where id='main';

  select * into v_entity from public.ktk_v2_entities
  where world_id='main' and entity_id='crown-main' and entity_type='crown'
    and coalesce(state->>'status','ground')='ground'
    and sqrt(power(v_player.x-x,2)+power(v_player.y-y,2))<=64
  for update;
  if found and v_world.king_user_id is null then
    return public.ktk_v2_claim_crown();
  end if;

  select * into v_entity from public.ktk_v2_entities
  where world_id='main' and entity_type='item'
    and coalesce(state->>'status','ground')='ground'
    and (nullif(state->>'expires_at','') is null or (state->>'expires_at')::timestamptz>clock_timestamp())
    and sqrt(power(v_player.x-x,2)+power(v_player.y-y,2))<=64
  order by sqrt(power(v_player.x-x,2)+power(v_player.y-y,2))
  limit 1;
  if found then
    return public.ktk_v2_item_action('pickup',jsonb_build_object('entity_id',v_entity.entity_id));
  end if;

  select * into v_entity from public.ktk_v2_entities
  where world_id='main' and entity_type='resource'
    and coalesce(state->>'status','ready')='ready'
    and sqrt(power(v_player.x-x,2)+power(v_player.y-y,2))<=80
  order by sqrt(power(v_player.x-x,2)+power(v_player.y-y,2))
  limit 1;
  if found then
    return public.ktk_v2_item_action('harvest',jsonb_build_object('entity_id',v_entity.entity_id));
  end if;

  return jsonb_build_object('ok',false,'reason','NOTHING_NEARBY');
end;
$function$;

revoke all on function ktk_v2_private.drop_player_items(uuid,double precision,double precision,jsonb) from public,anon,authenticated;
revoke all on function ktk_v2_private.kill_player(uuid,text) from public,anon,authenticated;

revoke all on function public.ktk_v2_choose_clan(text) from public,anon;
revoke all on function public.ktk_v2_item_action(text,jsonb) from public,anon;
revoke all on function public.ktk_v2_attack() from public,anon;
revoke all on function public.ktk_v2_interact() from public,anon;
grant execute on function public.ktk_v2_choose_clan(text) to authenticated;
grant execute on function public.ktk_v2_item_action(text,jsonb) to authenticated;
grant execute on function public.ktk_v2_attack() to authenticated;
grant execute on function public.ktk_v2_interact() to authenticated;

commit;