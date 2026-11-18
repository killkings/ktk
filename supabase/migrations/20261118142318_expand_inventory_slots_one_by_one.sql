CREATE OR REPLACE FUNCTION public.ktk_expand_inventory_slot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_player public.ktk_world_players;
  v_state jsonb;
  v_inventory jsonb;
  v_slot_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  -- Preserve the world -> player lock order used by authoritative actions.
  PERFORM 1 FROM public.ktk_worlds WHERE id='main' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WORLD_NOT_FOUND'; END IF;

  SELECT * INTO v_player
  FROM public.ktk_world_players
  WHERE user_id=v_uid AND world_id='main' AND is_alive=true
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAYER_NOT_ACTIVE'; END IF;

  v_state:=coalesce(v_player.state,'{}'::jsonb);
  v_inventory:=coalesce(v_state->'inventory','[null,null]'::jsonb);
  IF jsonb_typeof(v_inventory) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_INVENTORY';
  END IF;

  v_slot_count:=jsonb_array_length(v_inventory);
  IF v_slot_count>=10 THEN
    RETURN jsonb_build_object('ok',false,'error','INVENTORY_FULL','state',v_state,'slot_count',v_slot_count);
  END IF;
  IF v_slot_count<2 THEN RAISE EXCEPTION 'INVALID_INVENTORY'; END IF;

  -- Each successful press appends exactly one server-authorized empty slot.
  v_inventory:=v_inventory || jsonb_build_array(NULL);
  v_state:=jsonb_set(v_state,'{inventory}',v_inventory,true);
  UPDATE public.ktk_world_players
  SET state=v_state
  WHERE user_id=v_uid AND world_id='main';

  RETURN jsonb_build_object(
    'ok',true,'state',v_state,'slot',v_slot_count,'slot_count',v_slot_count+1
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ktk_expand_inventory_slot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ktk_expand_inventory_slot() FROM anon;
GRANT EXECUTE ON FUNCTION public.ktk_expand_inventory_slot() TO authenticated;
