-- Keep privileged Realtime publishing in a non-exposed schema.
-- The public RPC remains SECURITY INVOKER and derives identity from auth.uid().

begin;

create or replace function ktk_private.send_world_chat_message(p_message text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_message text;
  v_display_name text;
  v_x double precision;
  v_y double precision;
  v_rate_time timestamptz;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  v_message := regexp_replace(btrim(coalesce(p_message, '')), '[[:cntrl:]]+', ' ', 'g');
  if v_message = '' then
    raise exception 'CHAT_MESSAGE_EMPTY';
  end if;
  if char_length(v_message) > 120 then
    raise exception 'CHAT_MESSAGE_TOO_LONG';
  end if;

  select coalesce(nullif(btrim(p.display_name), ''), 'Aventureiro'), w.x, w.y
  into v_display_name, v_x, v_y
  from public.ktk_world_players w
  join public.ktk_profiles p on p.id = w.user_id
  where w.user_id = v_uid
    and w.world_id = 'main'
    and w.is_alive is true
    and w.last_seen_at >= v_now - interval '2 minutes'
  for update of w;

  if not found then
    raise exception 'PLAYER_NOT_ACTIVE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ktk:chat:' || v_uid::text, 0)
  );

  insert into ktk_private.player_chat_rate_limits(user_id, last_sent_at)
  values (v_uid, v_now)
  on conflict (user_id) do update
    set last_sent_at = excluded.last_sent_at
    where ktk_private.player_chat_rate_limits.last_sent_at <= v_now - interval '900 milliseconds'
  returning last_sent_at into v_rate_time;

  if not found then
    raise exception 'CHAT_RATE_LIMIT';
  end if;

  perform realtime.send(
    jsonb_build_object(
      'event_id', pg_catalog.gen_random_uuid()::text,
      'user_id', v_uid::text,
      'display_name', v_display_name,
      'message', v_message,
      'x', v_x,
      'y', v_y,
      'sent_at', v_now
    ),
    'chat_message',
    'world:main',
    true
  );

  return jsonb_build_object(
    'ok', true,
    'user_id', v_uid,
    'display_name', v_display_name,
    'message', v_message,
    'sent_at', v_now
  );
end;
$function$;

-- Authenticated clients can call this helper only through the public wrapper.
-- Other private helpers keep their owner-only permissions.
grant usage on schema ktk_private to authenticated;
revoke all on function ktk_private.initial_player_state() from public, anon, authenticated;
revoke all on function ktk_private.send_world_chat_message(text) from public, anon, authenticated;
grant execute on function ktk_private.send_world_chat_message(text) to authenticated;

create or replace function public.ktk_send_chat_message(p_message text)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  return ktk_private.send_world_chat_message(p_message);
end;
$function$;

revoke all on function public.ktk_send_chat_message(text) from public, anon;
grant execute on function public.ktk_send_chat_message(text) to authenticated;

commit;
