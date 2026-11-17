/* Sincroniza o catálogo visual usando o cliente Supabase já criado pela sessão. */
let catalogSyncPromise=null;
export async function syncEquipmentCatalog(supabase){
  const catalog=window.KTKEquipmentCatalog;
  if(!catalog)throw new Error('O catálogo visual de equipamentos não foi inicializado.');
  if(catalog.authoritative)return catalog.authoritySummary;
  if(!catalogSyncPromise){
    catalogSyncPromise=(async()=>{
      const {data,error}=await supabase.rpc('ktk_get_equipment_catalog');
      if(error)throw new Error('Não foi possível sincronizar o catálogo de equipamentos do servidor: '+(error.message||'erro desconhecido'));
      const summary=catalog.applyServerCatalog(data);
      if(!summary?.ok||summary.matched!==catalog.items.length){
        catalog.authoritative=false;throw new Error('O catálogo do servidor não corresponde a todos os itens visuais.');
      }
      return summary;
    })().finally(()=>{catalogSyncPromise=null;});
  }
  return catalogSyncPromise;
}
