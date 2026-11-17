begin;

-- Persistent world population: every client receives the same resource and
-- obstacle rows from the authoritative world snapshot.
insert into public.ktk_v2_entities(
  world_id,entity_id,entity_type,x,y,collision_radius,state,revision
)
select
  'main',
  'resource-tree-'||lpad(n::text,3,'0'),
  'resource',
  1480+((n-1)%8)*190,
  760+((n-1)/8)*260,
  15,
  jsonb_build_object(
    'status','ready','resource_kind','tree','display_name','Árvore',
    'health',3,'max_health',3,'drop_item_id','resource-wood',
    'drop_quantity',2,'required_tool','equipment-axe'
  ),
  1
from generate_series(2,25) n
on conflict (world_id,entity_id) do nothing;

insert into public.ktk_v2_entities(
  world_id,entity_id,entity_type,x,y,collision_radius,state,revision
)
select
  'main',
  'resource-rock-'||lpad(n::text,3,'0'),
  'resource',
  3260+((n-1)%6)*210,
  780+((n-1)/6)*270,
  14,
  jsonb_build_object(
    'status','ready','resource_kind','rock','display_name','Rocha',
    'health',4,'max_health',4,'drop_item_id','resource-stone',
    'drop_quantity',3,'required_tool','equipment-pickaxe'
  ),
  1
from generate_series(2,19) n
on conflict (world_id,entity_id) do nothing;

insert into public.ktk_v2_entities(
  world_id,entity_id,entity_type,x,y,collision_radius,state,revision
)
select
  'main',
  'resource-berries-'||lpad(n::text,3,'0'),
  'resource',
  1500+((n-1)%6)*185,
  1830+((n-1)/6)*175,
  12,
  jsonb_build_object(
    'status','ready','resource_kind','berries','display_name','Arbusto de frutas',
    'health',2,'max_health',2,'drop_item_id','resource-berries',
    'drop_quantity',2
  ),
  1
from generate_series(2,15) n
on conflict (world_id,entity_id) do nothing;

-- Static obstacles are world entities too. Their positions are generated once
-- here (not independently in browsers), and the server movement RPC collides.
insert into public.ktk_v2_entities(
  world_id,entity_id,entity_type,x,y,collision_radius,state,revision
)
select
  'main',
  'obstacle-tree-'||lpad(n::text,3,'0'),
  'obstacle',
  4700+mod(n*173,2100),
  360+mod(n*233,1900),
  22,
  jsonb_build_object('kind','tree','display_name','Árvore antiga','solid',true),
  1
from generate_series(1,46) n
where not exists (
  select 1 from public.ktk_v2_entities e
  where e.world_id='main'
    and sqrt(power(e.x-(4700+mod(n*173,2100)),2)+power(e.y-(360+mod(n*233,1900)),2))<58
)
on conflict (world_id,entity_id) do nothing;

insert into public.ktk_v2_entities(
  world_id,entity_id,entity_type,x,y,collision_radius,state,revision
)
select
  'main',
  'obstacle-rock-'||lpad(n::text,3,'0'),
  'obstacle',
  7000+mod(n*197,1650),
  420+mod(n*307,1850),
  19,
  jsonb_build_object('kind','boulder','display_name','Pedregulho','solid',true),
  1
from generate_series(1,32) n
where not exists (
  select 1 from public.ktk_v2_entities e
  where e.world_id='main'
    and sqrt(power(e.x-(7000+mod(n*197,1650)),2)+power(e.y-(420+mod(n*307,1850)),2))<54
)
on conflict (world_id,entity_id) do nothing;

-- Additional enemies are persistent server entities; the V2 simulation
-- migration expands the AI loop to process every living enemy, not only id 1.
insert into public.ktk_v2_entities(
  world_id,entity_id,entity_type,x,y,collision_radius,state,revision
)
select
  'main',
  'skeleton-'||n::text,
  'enemy',
  3850+((n-2)%4)*170,
  1050+((n-2)/4)*210,
  14,
  jsonb_build_object(
    'kind','skeleton','display_name','Esqueleto',
    'health',70,'max_health',70,'attack',7,'defense',4,
    'defeated',false,'attack_ready_at',null,'attack_started_at',null
  ),
  1
from generate_series(2,7) n
on conflict (world_id,entity_id) do nothing;

commit;
