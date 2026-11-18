CREATE OR REPLACE FUNCTION public.ktk_swap_inventory_item(
  p_entity_id text,
  p_slot integer,
  p_direction integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_player public.ktk_world_players;
  v_ground public.ktk_world_entities;
  v_old_item jsonb;
  v_new_item jsonb;
  v_inventory jsonb;
  v_state jsonb;
  v_old_def ktk_private.item_catalog%rowtype;
  v_new_def ktk_private.item_catalog%rowtype;
  v_new_item_id text;
  v_direction integer;
  v_dx double precision;
  v_dy double precision;
  v_drop_x double precision;
  v_drop_y double precision;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  -- Mantém a mesma ordem de bloqueio das demais ações do mundo.
  PERFORM 1
  FROM public.ktk_worlds
  WHERE id = 'main'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORLD_NOT_FOUND';
  END IF;

  SELECT *
  INTO v_player
  FROM public.ktk_world_players
  WHERE user_id = v_uid
    AND world_id = 'main'
    AND is_alive = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PLAYER_NOT_ACTIVE';
  END IF;

  v_state := coalesce(v_player.state, '{}'::jsonb);
  v_inventory := coalesce(v_state->'inventory', '[null,null]'::jsonb);

  IF jsonb_typeof(v_inventory) <> 'array'
     OR p_slot IS NULL
     OR p_slot < 0
     OR p_slot >= jsonb_array_length(v_inventory) THEN
    RAISE EXCEPTION 'INVALID_SLOT';
  END IF;

  v_old_item := v_inventory->p_slot;
  IF v_old_item IS NULL OR v_old_item = 'null'::jsonb
     OR nullif(v_old_item->>'item_id', '') IS NULL THEN
    RAISE EXCEPTION 'EMPTY_SLOT';
  END IF;

  SELECT *
  INTO v_old_def
  FROM ktk_private.item_catalog
  WHERE item_id = v_old_item->>'item_id';

  IF NOT FOUND OR v_old_def.wear_slot IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_INVENTORY_ITEM';
  END IF;

  SELECT *
  INTO v_ground
  FROM public.ktk_world_entities
  WHERE world_id = 'main'
    AND entity_id = left(coalesce(p_entity_id, ''), 120)
    AND entity_type = 'item'
  FOR UPDATE;

  IF NOT FOUND OR coalesce(v_ground.state->>'status', 'ground') <> 'ground' THEN
    RAISE EXCEPTION 'ITEM_NOT_AVAILABLE';
  END IF;

  IF sqrt(power(v_player.x-v_ground.x, 2) + power(v_player.y-v_ground.y, 2)) > 64 THEN
    RAISE EXCEPTION 'ITEM_TOO_FAR';
  END IF;

  v_new_item_id := nullif(v_ground.state->>'item_id', '');
  SELECT *
  INTO v_new_def
  FROM ktk_private.item_catalog
  WHERE item_id = v_new_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'UNKNOWN_ITEM';
  END IF;

  -- Vestimentas seguem o fluxo de equipar ao coletar, nunca o da mochila.
  IF v_new_def.wear_slot IS NOT NULL THEN
    RAISE EXCEPTION 'WEARABLE_REQUIRES_PICKUP';
  END IF;

  -- Pilhas existentes devem passar pelo pickup normal para serem somadas.
  IF coalesce((v_new_def.metadata->>'stackable')::boolean, false)
     AND EXISTS (
       SELECT 1
       FROM jsonb_array_elements(v_inventory) AS entry
       WHERE entry->>'item_id' = v_new_item_id
     ) THEN
    RAISE EXCEPTION 'STACK_ALREADY_OWNED_USE_PICKUP';
  END IF;

  v_new_item := jsonb_build_object(
    'item_id', v_new_item_id,
    'display_name', v_new_def.display_name,
    'durability', coalesce((v_ground.state->>'durability')::integer, v_new_def.max_durability),
    'max_durability', v_new_def.max_durability,
    'quantity', greatest(1, coalesce((v_ground.state->>'quantity')::integer, 1))
  );

  v_direction := coalesce(p_direction, v_player.direction, 2);
  IF v_direction NOT BETWEEN 0 AND 3 THEN
    RAISE EXCEPTION 'INVALID_DIRECTION';
  END IF;

  v_dx := CASE v_direction WHEN 1 THEN -1 WHEN 3 THEN 1 ELSE 0 END;
  v_dy := CASE v_direction WHEN 0 THEN -1 WHEN 2 THEN 1 ELSE 0 END;
  v_drop_x := v_player.x + v_dx * 48;
  v_drop_y := v_player.y + v_dy * 48;

  -- O item retirado do espaço selecionado vai para o mapa sem perder pilha
  -- ou durabilidade; o item encontrado ocupa exatamente o mesmo espaço.
  INSERT INTO public.ktk_world_entities (
    world_id, entity_id, entity_type, x, y, collision_radius, state, revision
  ) VALUES (
    'main',
    'drop-' || gen_random_uuid()::text,
    'item',
    v_drop_x,
    v_drop_y,
    0,
    v_old_item || jsonb_build_object('status', 'ground'),
    1
  );

  DELETE FROM public.ktk_world_entities
  WHERE world_id = 'main'
    AND entity_id = v_ground.entity_id;

  v_inventory := jsonb_set(v_inventory, ARRAY[p_slot::text], v_new_item, true);
  v_state := jsonb_set(v_state, '{inventory}', v_inventory, true);

  UPDATE public.ktk_world_players
  SET state = v_state
  WHERE user_id = v_uid
    AND world_id = 'main';

  RETURN jsonb_build_object(
    'ok', true,
    'state', v_state,
    'collected', v_new_item_id,
    'dropped', v_old_item->>'item_id'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ktk_swap_inventory_item(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ktk_swap_inventory_item(text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.ktk_swap_inventory_item(text, integer, integer) TO authenticated;
