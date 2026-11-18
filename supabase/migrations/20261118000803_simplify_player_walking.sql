begin;

-- O navegador passa a calcular a caminhada e as colisões locais.
-- O banco apenas registra a posição atual para os demais jogadores, reentrada
-- e operações de combate que consultam a última coordenada persistida.
create or replace function public.ktk_checkpoint_position(
  p_x double precision,
  p_y double precision,
  p_direction smallint,
  p_moving boolean default false,
  p_running boolean default false,
  p_guarding boolean default false,
  p_input_x smallint default 0,
  p_input_y smallint default 0
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;

  if p_x is null
     or p_y is null
     or abs(p_x) > 100000
     or abs(p_y) > 100000
     or p_direction is null
     or p_direction not between 0 and 3
     or coalesce(p_input_x, 0) not between -1 and 1
     or coalesce(p_input_y, 0) not between -1 and 1
     or (coalesce(p_running, false) and not coalesce(p_moving, false))
     or (coalesce(p_moving, false) and coalesce(p_input_x, 0) = 0 and coalesce(p_input_y, 0) = 0)
  then
    raise exception using errcode = '22023', message = 'INVALID_POSITION_CHECKPOINT';
  end if;

  update public.ktk_world_players as player
  set x = p_x,
      y = p_y,
      direction = p_direction,
      state = coalesce(player.state, '{}'::jsonb) || jsonb_build_object(
        'moving', coalesce(p_moving, false),
        'running', coalesce(p_running, false),
        'guarding', coalesce(p_guarding, false),
        'movement_input_x', coalesce(p_input_x, 0),
        'movement_input_y', coalesce(p_input_y, 0),
        'movement_running', coalesce(p_running, false),
        'movement_guarding', coalesce(p_guarding, false)
      ),
      last_seen_at = v_now,
      position_updated_at = v_now,
      movement_updated_at = v_now
  where player.user_id = v_uid
    and player.world_id = 'main'
    and player.is_alive = true;

  if not found then
    raise exception using errcode = 'P0002', message = 'PLAYER_NOT_ACTIVE';
  end if;

  return true;
end;
$function$;

revoke all on function public.ktk_checkpoint_position(
  double precision, double precision, smallint, boolean, boolean, boolean, smallint, smallint
) from public, anon;
grant execute on function public.ktk_checkpoint_position(
  double precision, double precision, smallint, boolean, boolean, boolean, smallint, smallint
) to authenticated;

comment on function public.ktk_checkpoint_position(
  double precision, double precision, smallint, boolean, boolean, boolean, smallint, smallint
) is 'Stores a browser-simulated player position. It never advances or corrects movement.';

-- Elimina a antiga cadeia de passos/reconciliação do servidor sem CASCADE.
drop function if exists public.ktk_step_player(smallint, smallint, boolean, boolean, integer);
drop function if exists ktk_private.step_player_unlocked_v2(smallint, smallint, boolean, boolean, integer);
drop function if exists ktk_private.step_player_unlocked(smallint, smallint, boolean, boolean);
drop function if exists ktk_private.apply_player_movement_segment(
  uuid, double precision, double precision, smallint, smallint, double precision, double precision
);
drop function if exists public.ktk_sync_live_positions(jsonb);

commit;
