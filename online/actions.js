/* Ações validadas pelo servidor: combate, inventário, interação e coroa. */
import { state } from "./state.js?v=20261117-walk-v1";
import { supabase } from "./supabase-client.js?v=20261117-walk-v1";
import { loadWorldState } from "./realtime.js?v=20261117-walk-v1";
import { syncPositionForAction } from "./movement.js?v=20261117-combat-v1";

const POSITION_SENSITIVE_ACTIONS = new Set(["attack", "launch_projectile"]);

export async function gameAction(action, payload = {}) {
  const actionName = String(action);
  const sessionId=state.sessionId;
  const userId=state.user?.id;
  if(!userId||!state.online||!state.joined||state.leaving) {
    throw new Error("A sessão do personagem não está ativa.");
  }

  // A caminhada é local e o checkpoint periódico é deliberadamente econômico.
  // Antes de ataques e disparos, sincronizamos o ponto exato do atacante para
  // que o servidor não escolha alvos a partir de uma coordenada antiga.
  if (POSITION_SENSITIVE_ACTIONS.has(actionName)) {
    await syncPositionForAction();
    if(sessionId!==state.sessionId||userId!==state.user?.id||!state.joined||state.leaving) {
      return {ok:false,error:"A sessão do personagem foi encerrada."};
    }
  }

  const { data, error } = await supabase.rpc("ktk_game_action", {
    p_action: actionName,
    p_payload: payload || {}
  });
  if (error) throw error;
  if(sessionId!==state.sessionId||userId!==state.user?.id||!state.joined) {
    return {ok:false,error:"A sessão do personagem foi encerrada."};
  }
  if (data?.state) window.KTKWorldEntities?.applyServerState?.(data.state);

  if (POSITION_SENSITIVE_ACTIONS.has(actionName)) {
    // Resultado do RPC e Broadcast dos gatilhos são aplicados sem esperar uma
    // fotografia completa do mundo; isso evita que a animação do projétil fique
    // parada aguardando uma segunda consulta de rede.
    void loadWorldState().catch(snapshotError => {
      console.warn("KTK combat snapshot:", snapshotError);
    });
    return data;
  }

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
