/* Canal Realtime, Presence e fotografias oficiais do mundo. */
import { state } from "./state.js?v=20261117-online-separation-001";
import { supabase, WORLD_ID, TOPIC } from "./supabase-client.js?v=20261117-online-separation-001";
import {
  acceptDatabaseChange, acceptWorldEntityChange, rebuildPresence, loadExistingPlayers
} from "./player-sync.js?v=20261117-entry-timeouts-001";
import { withTimeout } from "./request-timeout.js?v=20261117-entry-timeouts-001";

export async function loadWorldState(signal) {
  if(!state.user||state.leaving) return null;
  const requestId=++state.worldStateRequestId;
  let request=supabase.rpc("ktk_get_world_state");
  if(signal) request=request.abortSignal(signal);
  const {data,error}=await request;
  if(error) throw error;
  if(!state.user||state.leaving) return null;
  // Se duas fotografias se cruzarem na rede, só aplica a última solicitada.
  if(requestId===state.worldStateRequestId) {
    window.KTKWorldEntities?.applyWorldState?.(data);
  }
  return data;
}

export async function subscribeWorld(onProgress = () => {}) {
  onProgress("Validando a autorização do Realtime...");
  await withTimeout("A autorização do canal multiplayer", 8000, () => supabase.realtime.setAuth());
  state.channel = supabase.channel(TOPIC, {
    config: {
      private: true,
      broadcast: { self: false, ack: false },
      presence: { key: state.user.id }
    }
  });
  state.channel
    .on("broadcast", { event: "INSERT" }, ({ payload }) => acceptDatabaseChange(payload))
    .on("broadcast", { event: "UPDATE" }, ({ payload }) => acceptDatabaseChange(payload))
    .on("broadcast", { event: "ENTITY_INSERT" }, ({ payload }) => acceptWorldEntityChange(payload))
    .on("broadcast", { event: "ENTITY_UPDATE" }, ({ payload }) => acceptWorldEntityChange(payload))
    .on("broadcast", { event: "ENTITY_DELETE" }, ({ payload }) => acceptWorldEntityChange(payload,true))
    .on("presence", { event: "sync" }, rebuildPresence)
    .on("presence", { event: "join" }, rebuildPresence)
    .on("presence", { event: "leave" }, ({key}) => {
      rebuildPresence();
      const id=String(key||"");
      setTimeout(()=>{
        if(!id || state.channel?.presenceState()?.[id]?.length) return;
        state.remote.delete(id);
        updateRemotes();
      },15000);
    });

  await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Tempo esgotado ao conectar ao mundo online."));
    }, 12000);
    state.channel.subscribe(status => {
      if (status === "SUBSCRIBED" && !settled) {
        settled = true; clearTimeout(timeout); resolve();
      } else if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !settled) {
        settled = true; clearTimeout(timeout);
        reject(new Error("Não foi possível entrar no canal multiplayer (" + status + ")."));
      }
    });
  });
  state.online = true;
  onProgress("Buscando os jogadores que já estão no mundo...");
  await withTimeout("A consulta dos jogadores presentes", 10000,
    signal => loadExistingPlayers(signal));
  onProgress("Carregando o estado compartilhado do mundo...");
  await withTimeout("A consulta do estado compartilhado do mundo", 12000,
    signal => loadWorldState(signal));
  setStatus("● Online · mundo principal", true);
}

export async function trackPresence() {
  if (state.leaving || !state.channel || !state.online || !state.joined || !state.user) return;
  const { error } = await state.channel.track({
    user_id: state.user.id,
    session_id: state.sessionId
  });
  if (error) console.warn("KTK presence:", error.message);
  state.lastTrack = Date.now();
}
