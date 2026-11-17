create or replace function public.ktk_get_equipment_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_catalog jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;
  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'item_id',c.item_id,'display_name',c.display_name,'item_type',c.item_type,'wear_slot',c.wear_slot,
      'attack_bonus',c.attack_bonus,'defense_bonus',c.defense_bonus,'range_tiles',c.range_tiles,
      'stamina_cost',c.stamina_cost,'attack_interval',c.attack_interval,'max_durability',c.max_durability,
      'durability_unit',c.durability_unit,'two_handed',c.two_handed,'metadata',coalesce(c.metadata,'{}'::jsonb)
    ) order by c.item_id),'[]'::jsonb)
  into v_catalog from ktk_private.item_catalog as c;
  return v_catalog;
end;
$$;
revoke all on function public.ktk_get_equipment_catalog() from public;
revoke all on function public.ktk_get_equipment_catalog() from anon;
grant execute on function public.ktk_get_equipment_catalog() to authenticated;
