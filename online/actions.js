/* Ações validadas pelo servidor: combate, inventário, interação e coroa. */
import { state } from "./state.js?v=20261117-remote-motion-006";
import { supabase } from "./supabase-client.js?v=20261117-remote-motion-006";
import { loadWorldState } from "./realtime.js?v=20261117-remote-motion-006";

export async function gameAction(action, payload = {}) {
  const sessionId=state.sessionId;
  const userId=state.user?.id;
  if(!userId||!state.online||!state.joined||state.leaving) {
    throw new Error("A sessão do personagem não está ativa.");
  }
  const { data, error } = await supabase.rpc("ktk_game_action", {
    p_action: String(action),
    p_payload: payload || {}
  });
  if (error) throw error;
  if(sessionId!==state.sessionId||userId!==state.user?.id||!state.joined) {
    return {ok:false,error:"A sessão do personagem foi encerrada."};
  }
  if (data?.state) window.KTKWorldEntities?.applyServerState?.(data.state);
  try {
    await loadWorldState();
  } catch (snapshotError) {
    // Ação confirmada pelo RPC não deve parecer rejeitada só porque a
    // fotografia complementar do mundo falhou na rede.
    console.warn("KTK world snapshot after action:",snapshotError);
  }
  return data;
}

export async function claimKingCrown() {
  const sessionId=state.sessionId;
  const userId=state.user?.id;
  if(!userId||!state.online||!state.joined||state.leaving) {
    return {ok:false,error:"A sessão do personagem não está ativa."};
  }
  const {data,error}=await supabase.rpc("ktk_claim_king_crown");
  if(error) return {ok:false,error:error.message||"Não foi possível reivindicar a coroa."};
  if(sessionId!==state.sessionId||userId!==state.user?.id||!state.joined) {
    return {ok:false,error:"A sessão do personagem foi encerrada."};
  }
  if(data?.state) window.KTKWorldEntities?.applyServerState?.(data.state);
  try { await loadWorldState(); }
  catch(snapshotError) { console.warn("KTK crown snapshot:",snapshotError); }
  return {ok:true,data};
}

export async function dropKingCrown(x,y) {
  const sessionId=state.sessionId;
  const userId=state.user?.id;
  if(!userId||!state.online||!state.joined||state.leaving) {
    return {ok:false,error:"A sessão do personagem não está ativa."};
  }
  const {data,error}=await supabase.rpc("ktk_drop_king_crown",{p_x:Number(x),p_y:Number(y)});
  if(error) return {ok:false,error:error.message||"Não foi possível soltar a coroa."};
  if(sessionId!==state.sessionId||userId!==state.user?.id||!state.joined) {
    return {ok:false,error:"A sessão do personagem foi encerrada."};
  }
  try { await loadWorldState(); }
  catch(snapshotError) { console.warn("KTK crown snapshot:",snapshotError); }
  return {ok:true,data};
}
