/* Autenticação, entrada/saída e ciclo de vida da sessão. */
import { state } from "./state.js?v=20261117-remote-snapshot-007";
import {
  supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
} from "./supabase-client.js?v=20261117-remote-snapshot-007";
import { sendPosition } from "./movement.js?v=20261117-movement-reconcile-001";
import { subscribeWorld } from "./realtime.js?v=20261117-remote-snapshot-007";
import { updateRemotes, resetPlayerSyncState } from "./player-sync.js?v=20261117-remote-snapshot-007";
import { syncEquipmentCatalog } from "../equipment/catalog-sync.js?v=20261117-remote-snapshot-007";
import { withTimeout } from "./request-timeout.js?v=20261117-remote-snapshot-007";

export function setStatus(message, connected = false) {
  let el = document.getElementById("ktk-online-status");
  if (!el) {
    el = document.createElement("div");
    el.id = "ktk-online-status";
    el.style.cssText = "position:absolute;top:18px;left:50%;transform:translateX(-50%);z-index:20;padding:8px 13px;border:1px solid rgba(238,247,226,.2);border-radius:999px;background:rgba(17,39,27,.88);color:#e7efdf;font:700 11px system-ui;pointer-events:none;white-space:nowrap";
    document.querySelector(".hud-top")?.appendChild(el);
  }
  el.textContent = message;
  el.style.borderColor = connected ? "rgba(155,215,135,.55)" : "rgba(238,190,120,.45)";
}

function reportEntryProgress(_options, message) {
  // Progresso técnico apenas no console: não polui o criador nem a HUD.
  console.debug("KTK entry:", message);
}

export async function enter(options = {}) {
  if (state.connecting) return { ok: false, error: "A conexão já está sendo iniciada." };
  state.connecting = true;
  state.sessionId = window.crypto?.randomUUID?.() || (String(Date.now()) + "-" + Math.random().toString(36).slice(2));
  state.lastPosition = null;
  try {
    const displayName = String(options.displayName || "").trim().slice(0, 24);
    if (displayName.length < 2) throw new Error("Escolha um nome com pelo menos 2 caracteres.");
    state.displayName = displayName;

    let sessionData;
    reportEntryProgress(options, "Autenticando sua conta...");
    if (options.newCharacter) {
      // Morte é permanente: a nova tentativa recebe um auth.uid() totalmente novo.
      // O servidor remove o histórico morto deste nome quando o personagem é recriado.
      if (state.channel) {
        try { await withTimeout("O encerramento do canal anterior", 7000, () => supabase.removeChannel(state.channel)); } catch (cleanupError) {
          console.warn("KTK old session cleanup:", cleanupError);
        }
        state.channel = null;
      }
      const { data: previousSession, error: previousSessionError } = await withTimeout("A leitura da sessão anterior", 10000, () => supabase.auth.getSession());
      if (previousSessionError) throw previousSessionError;
      if (previousSession?.session) {
        const { error: signOutError } = await withTimeout("O encerramento da conta anterior", 10000, () => supabase.auth.signOut({ scope: "local" }));
        const { data: afterSignOut, error: afterSignOutError } = await withTimeout("A confirmação do encerramento anterior", 10000, () => supabase.auth.getSession());
        if (afterSignOutError) throw afterSignOutError;
        if (afterSignOut?.session) {
          throw signOutError || new Error("Não foi possível encerrar a conta anterior para criar outra.");
        }
        if (signOutError) console.warn("KTK old anonymous session was cleared locally:",signOutError.message);
      }
      reportEntryProgress(options, "Criando a conta temporária do jogador...");
      const result = await withTimeout("A criação da conta anônima", 15000, () => supabase.auth.signInAnonymously());
      if (result.error) throw new Error("Não foi possível criar outra conta de jogador. Confira se o login anônimo está ativado no Supabase: " + result.error.message);
      sessionData = { session: result.data.session };
    } else {
      const { data, error } = await withTimeout("A leitura da sessão autenticada", 10000, () => supabase.auth.getSession());
      if (error) throw error;
      sessionData = data;
      if (!sessionData.session) {
        reportEntryProgress(options, "Criando a conta temporária do jogador...");
      const result = await withTimeout("A criação da conta anônima", 15000, () => supabase.auth.signInAnonymously());
        if (result.error) throw new Error("Não foi possível criar sua conta de jogador. Confira se o login anônimo está ativado no Supabase: " + result.error.message);
        sessionData = { session: result.data.session };
      }
    }
    if (!sessionData?.session?.user) throw new Error("O Supabase não devolveu uma sessão autenticada para o jogador.");
    reportEntryProgress(options, "Sincronizando o catálogo de equipamentos...");
    await withTimeout("A sincronização do catálogo de equipamentos", 15000,
      signal => syncEquipmentCatalog(supabase, signal));
    state.user = sessionData.session.user;
    state.accessToken = sessionData.session.access_token || state.accessToken;
    state.leaving = false;

    let player;
    if (options.newCharacter) {
      reportEntryProgress(options, "Criando seu personagem no servidor...");
      const { data, error } = await withTimeout("A criação do personagem no servidor", 15000,
        signal => supabase.rpc("ktk_create_new_character", {
          p_display_name: displayName, p_character: options.character || {}
        }).abortSignal(signal));
      if (error) throw error;
      player = data?.player;
    } else {
      reportEntryProgress(options, "Entrando no mundo...");
      const { data, error } = await withTimeout("A entrada do personagem no servidor", 15000,
        signal => supabase.rpc("ktk_join_world", {
          p_display_name: displayName, p_character: options.character || {}
        }).abortSignal(signal));
      if (error) throw error;
      player = data?.player;
    }
    // ktk_join_world já devolve posição, aparência e player.state na mesma resposta.
    // Evita uma segunda RPC antes da abertura do mundo.
    if (!player?.is_alive) {
      return { ok: false, dead: true, player, error: "Este personagem morreu. Crie outro para voltar ao mundo." };
    }
    // Não reproduz como novo um knockback que já constava do estado inicial.
    // A posição do ingresso não inclui position_updated_at no contrato SQL.
    state.lastLocalKnockbackAt=String(player.state?.last_knockback_at||"");
    reportEntryProgress(options, "Conectando ao canal multiplayer...");
    await subscribeWorld(message => reportEntryProgress(options, message));
    setStatus("● Online · mundo principal", true);
    state.joined = true;
    state.lastInputSignature = "";
    state.lastCheckpoint = 0;
    state.stepInFlight = false;
    state.stepController = null;
    state.activeStepId = 0;
    state.stepSequence++;
    void setPlayerVisibility(document.visibilityState === "visible");
    return { ok: true, player };
  } catch (error) {
    console.error("KTK online:", error);
    if (state.channel) {
      try { await withTimeout("O encerramento do canal anterior", 7000, () => supabase.removeChannel(state.channel)); } catch (cleanupError) {
        console.warn("KTK channel cleanup:", cleanupError);
      }
    }
    state.channel = null;
    state.online = false;
    state.joined = false;
    resetPlayerSyncState();
    state.lastPosition = null;
    state.lastIntentSignature = "";
    state.lastInputSignature = "";
    state.stepController?.abort();
    state.stepController = null;
    state.stepSequence++;
    state.activeStepId = 0;
    state.stepInFlight = false;
    updateRemotes();
    const code = error?.code || error?.error_code || "";
    const message = String(error?.message || "");
    if (message.includes("CHARACTER_DEAD_NEW_ACCOUNT_REQUIRED")) {
      return {
        ok: false, dead: true,
        error: "Este personagem morreu permanentemente. Crie outra conta para começar do zero."
      };
    }
    if (code === "anonymous_provider_disabled" || message.includes("Anonymous sign-ins are disabled")) {
      return {
        ok: false,
        error: "O login de jogadores está desativado no servidor. No Supabase, abra Authentication → Sign In / Providers → Anonymous e ative Anonymous Sign-Ins."
      };
    }
    return { ok: false, error: message || "Falha ao conectar ao servidor." };
  } finally {
    state.connecting = false;
  }
}

export async function getPlayerState(signal) {
  let request = supabase.rpc("ktk_get_player_state");
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  return data;
}

export async function clearLocalSession(statusMessage) {
  state.leaving = true;
  state.worldStateRequestId++;
  state.intentInFlight = false;
  state.connecting = false;
  state.stepSequence++;
  state.activeStepId = 0;
  state.stepInFlight = false;
  state.stepController?.abort();
  state.stepController = null;

  const channel = state.channel;
  state.channel = null;
  if (channel) {
    try { await supabase.removeChannel(channel); }
    catch (error) { console.warn("KTK channel cleanup:", error?.message || error); }
  }

  state.online = false;
  state.joined = false;
  state.user = null;
  state.accessToken = "";
  state.displayName = "";
  const nameInput = document.getElementById("ktk-display-name");
  if (nameInput) nameInput.value = "";
  state.lastPosition = null;
  state.lastIntentSignature = "";
  state.lastInputSignature = "";
  state.lastCheckpoint = 0;
  state.lastDbHeartbeat = 0;
  state.lastTrack = 0;
  resetPlayerSyncState();
  state.sessionId = "";

  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) console.warn("KTK in-memory sign-out:", error.message);
  } catch (error) {
    console.warn("KTK in-memory sign-out:", error?.message || error);
  }

  state.leaving = false;
  updateRemotes();
  setStatus(statusMessage || "○ Sessão encerrada · fora do mundo", false);
}

export async function markDead() {
  if (!state.user) return;
  const { error } = await supabase.rpc("ktk_mark_dead");
  if (error) {
    const { data, error: stateError } = await supabase.rpc("ktk_get_player_state");
    if (stateError || data?.is_alive !== false) throw error;
  }
  await clearLocalSession("○ Personagem morto · sessão apagada");
}

// Saída voluntária encerra a vida no banco antes de desligar a sessão multiplayer.
// A identidade Auth só é trocada quando o jogador escolhe criar o próximo personagem.

export async function leaveWorld() {
  if (state.leaving) return { ok: false, error: "A saída do mundo já está sendo processada." };
  if (!state.user) return { ok: false, error: "Não há uma sessão de jogador ativa para encerrar." };

  state.leaving = true;
  state.stepSequence++;
  state.activeStepId = 0;
  state.stepInFlight = false;
  state.stepController?.abort();
  state.stepController = null;
  try {
    const { data, error } = await supabase.rpc("ktk_leave_world");
    if (error) throw error;
    if (data && data.ok === false) throw new Error("O servidor não confirmou a morte do personagem.");

    await clearLocalSession("○ Personagem morto ao sair · sessão apagada");
    return { ok: true, data };
  } catch (error) {
    state.leaving = false;
    console.error("KTK voluntary exit:", error);
    return {
      ok: false,
      error: error?.message || "Não foi possível encerrar o personagem no servidor."
    };
  }
}

async function setPlayerVisibility(visible) {
  if (state.leaving || !state.online || !state.joined || !state.user) return;
  try {
    const { error } = await supabase.rpc("ktk_set_player_visibility", {
      p_visible: Boolean(visible)
    });
    if (error) console.warn("KTK player visibility:", error.message);
  } catch (error) {
    console.warn("KTK player visibility:", error?.message || error);
  }
}

export function startHeartbeat() {
  document.addEventListener("visibilitychange", () => {
    if (!state.online || !state.joined || state.leaving) return;
    void setPlayerVisibility(document.visibilityState === "visible");
  });
  window.addEventListener("pagehide", () => {
    // Mesmo se uma saída pelo Esc já começou, pagehide envia uma segunda
    // solicitação idempotente keepalive como proteção contra fechamento da página.
    if (!state.online || !state.joined || !state.accessToken) return;
    state.leaving = true;
    const token = state.accessToken;
    const endpoint = SUPABASE_URL + "/rest/v1/rpc/ktk_leave_world";
    // keepalive permite que a requisição continue mesmo quando a página fecha.
    void fetch(endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      keepalive: true,
      headers: {
        "apikey": SUPABASE_PUBLISHABLE_KEY,
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: "{}"
    }).catch(error=>console.warn("KTK exit death:",error));
    state.joined = false;
    state.online = false;
    if (state.channel) void supabase.removeChannel(state.channel);
    state.channel = null;
    state.user = null;
    state.accessToken = "";
    state.displayName = "";
    const nameInput = document.getElementById("ktk-display-name");
    if (nameInput) nameInput.value = "";
    resetPlayerSyncState();
    state.sessionId = "";
    state.worldStateRequestId++;
    void supabase.auth.signOut({ scope: "local" }).catch(error => {
      console.warn("KTK pagehide session cleanup:", error?.message || error);
    });
  }, {capture:true});
  window.addEventListener("pageshow", event => {
    if (event.persisted) window.location.reload();
  });
}
