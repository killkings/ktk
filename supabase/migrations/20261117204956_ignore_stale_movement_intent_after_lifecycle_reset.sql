do $patch$
declare
 v_definition text;
 v_old text := $old$  v_previous_moving := v_previous_input_x <> 0 or v_previous_input_y <> 0;$old$;
 v_new text := $new$  v_previous_moving := coalesce((v_state->>'moving')::boolean, false)
    and (v_previous_input_x <> 0 or v_previous_input_y <> 0);$new$;
begin
 select pg_get_functiondef(
  'ktk_private.step_player_unlocked_v2(smallint,smallint,boolean,boolean,integer)'::regprocedure
 ) into v_definition;
 if position(v_old in v_definition)=0 then
  raise exception 'Could not locate previous movement intent initialization.';
 end if;
 v_definition:=replace(v_definition,v_old,v_new);
 execute v_definition;
end
$patch$;