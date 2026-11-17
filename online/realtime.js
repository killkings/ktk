/* Canal Broadcast privado e fotografias oficiais do mundo. */
import { state } from "./state.js?v=20261117-movement-reconciliation-005";
import { supabase, TOPIC } from "./supabase-client.js?v=20261117-movement-reconciliation-005";
import {
  acceptDatabaseChange, acceptWorldEntityChange, loadExistingPlayers
} from "./player-sync.js?v=20261117-movement-reconciliation-005";
import { withTimeout } from "./request-timeout.js?v=20261117-movement-reconciliation-005";

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

function makeChannelError(status, err) {
  const detail = err && typeof err === "object"
    ? [err.message, err.cause?.message, err.code, err.hint].filter(Boolean).join(" · ")
    : String(err || "");
  const failure = new Error(
    "Não foi possível entrar no canal multiplayer (" + status + ")" +
    (detail ? ": " + detail : ".")
  );
  if(err && typeof err === "object") {
    if(err.code) failure.code = err.code;
    if(err.hint) failure.hint = err.hint;
    if(err.details) failure.details = err.details;
    failure.cause = err;
  }
  return failure;
}

export async function subscribeWorld(onProgress = () => {}) {
  onProgress("Validando a autorização do Realtime...");
  await withTimeout("A autorização do canal multiplayer", 8000, () => supabase.realtime.setAuth());

  // O mundo usa Broadcasts disparados por gatilhos SQL. Presence é opcional e
  // foi removido deste canal crítico: um limite de Presence pode fechar o
  // canal inteiro, interrompendo também os Broadcasts de movimento e entidades.
  state.channel = supabase.channel(TOPIC, {
    config: {
      private: true,
      broadcast: { self: false, ack: false }
    }
  });
  state.channel
    .on("broadcast", { event: "INSERT" }, ({ payload }) => acceptDatabaseChange(payload))
    .on("broadcast", { event: "UPDATE" }, ({ payload }) => acceptDatabaseChange(payload))
    .on("broadcast", { event: "ENTITY_INSERT" }, ({ payload }) => acceptWorldEntityChange(payload))
    .on("broadcast", { event: "ENTITY_UPDATE" }, ({ payload }) => acceptWorldEntityChange(payload))
    .on("broadcast", { event: "ENTITY_DELETE" }, ({ payload }) => acceptWorldEntityChange(payload,true));

  let settled = false;
  let latestStatus = "";
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Tempo esgotado ao conectar ao mundo online."));
    }, 12000);

    state.channel.subscribe((status, err) => {
      latestStatus = status;

      if(status === "SUBSCRIBED") {
        if(!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve();
        } else if(!state.leaving) {
          // O supabase-js pode restabelecer o canal após uma queda transitória.
          state.online = true;
        }
        return;
      }

      if(status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        console.error("KTK Realtime channel:", status, err || null);
        if(!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(makeChannelError(status, err));
        } else if(!state.leaving) {
          state.online = false;
        }
      }
    });
  });

  if(latestStatus !== "SUBSCRIBED") {
    throw new Error("O canal multiplayer foi fechado antes de ativar a sessão.");
  }
  state.online = true;

  // As fotografias iniciais complementam os Broadcasts, mas não podem bloquear
  // a entrada no mundo. Ambas começam juntas e atualizam o estado ao terminar.
  onProgress("Conexão ativa; sincronizando os dados iniciais em paralelo...");
  const snapshotTasks = [
    {
      label: "jogadores presentes",
      promise: withTimeout("A consulta dos jogadores presentes", 10000,
        signal => loadExistingPlayers(signal))
    },
    {
      label: "estado compartilhado do mundo",
      promise: withTimeout("A consulta do estado compartilhado do mundo", 12000,
        signal => loadWorldState(signal))
    }
  ];
  void Promise.allSettled(snapshotTasks.map(task => task.promise)).then(results => {
    results.forEach((result, index) => {
      if(result.status === "rejected") {
        console.warn("KTK initial snapshot (" + snapshotTasks[index].label + "):", result.reason);
      }
    });
  });
}
