BEGIN;

DO $validate_loot_catalog$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(expected.item_id ORDER BY expected.item_id)
  INTO v_missing
  FROM (VALUES
    ('equipment-arming-sword'),
    ('equipment-bow-normal'),
    ('equipment-arrow'),
    ('equipment-dagger'),
    ('equipment-spear'),
    ('equipment-mace'),
    ('equipment-waraxe'),
    ('equipment-axe'),
    ('equipment-hammer'),
    ('equipment-pickaxe'),
    ('equipment-shovel'),
    ('equipment-hoe'),
    ('equipment-rod')
  ) AS expected(item_id)
  LEFT JOIN ktk_private.item_catalog catalog USING (item_id)
  WHERE catalog.item_id IS NULL;

  IF coalesce(array_length(v_missing, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Itens ausentes do catálogo: %', array_to_string(v_missing, ', ');
  END IF;
END;
$validate_loot_catalog$;

INSERT INTO public.ktk_world_entities (
  world_id, entity_id, entity_type, x, y, collision_radius, state, revision
) VALUES
  ('main','loot-arming-sword-01','item',-520,-280,0,
   jsonb_build_object('status','ground','item_id','equipment-arming-sword','quantity',1,'durability',150),1),
  ('main','loot-bow-normal-01','item',520,-280,0,
   jsonb_build_object('status','ground','item_id','equipment-bow-normal','quantity',1,'durability',120),1),
  ('main','loot-arrow-01','item',600,-190,0,
   jsonb_build_object('status','ground','item_id','equipment-arrow','quantity',1,'durability',0),1),
  ('main','loot-arrow-02','item',450,-180,0,
   jsonb_build_object('status','ground','item_id','equipment-arrow','quantity',1,'durability',0),1),
  ('main','loot-dagger-01','item',-260,-280,0,
   jsonb_build_object('status','ground','item_id','equipment-dagger','quantity',1,'durability',120),1),
  ('main','loot-spear-01','item',0,-320,0,
   jsonb_build_object('status','ground','item_id','equipment-spear','quantity',1,'durability',140),1),
  ('main','loot-mace-01','item',260,-280,0,
   jsonb_build_object('status','ground','item_id','equipment-mace','quantity',1,'durability',130),1),
  ('main','loot-waraxe-01','item',-540,0,0,
   jsonb_build_object('status','ground','item_id','equipment-waraxe','quantity',1,'durability',140),1),
  ('main','loot-axe-01','item',-300,250,0,
   jsonb_build_object('status','ground','item_id','equipment-axe','quantity',1,'durability',150),1),
  ('main','loot-hammer-01','item',120,340,0,
   jsonb_build_object('status','ground','item_id','equipment-hammer','quantity',1,'durability',140),1),
  ('main','loot-pickaxe-01','item',300,250,0,
   jsonb_build_object('status','ground','item_id','equipment-pickaxe','quantity',1,'durability',150),1),
  ('main','loot-shovel-01','item',540,0,0,
   jsonb_build_object('status','ground','item_id','equipment-shovel','quantity',1,'durability',120),1),
  ('main','loot-hoe-01','item',-270,0,0,
   jsonb_build_object('status','ground','item_id','equipment-hoe','quantity',1,'durability',120),1),
  ('main','loot-fishing-rod-01','item',270,0,0,
   jsonb_build_object('status','ground','item_id','equipment-rod','quantity',1,'durability',100),1)
ON CONFLICT (world_id, entity_id) DO NOTHING;

COMMIT;
