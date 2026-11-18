/* Ponto de composição do multiplayer V1: expõe somente a API pública do jogo. */
import {
  enter, markDead, leaveWorld, getPlayerState, startHeartbeat
} from "../online/session.js?v=20261118-room-grid-v1";
import { gameAction, claimKingCrown, dropKingCrown, swapInventoryItem, expandInventorySlot } from "../online/actions.js?v=20261118-room-grid-v1";
import { state } from "../online/state.js?v=20261117-walk-v1";
import { supabase } from "../online/supabase-client.js?v=20261117-walk-v1";

async function sendChat(message) {
  const text = String(message || "").trim();
  if (!text) throw new Error("Digite uma mensagem antes de enviar.");
  if (text.length > 120) throw new Error("A mensagem pode ter no máximo 120 caracteres.");
  if (!state.user || !state.online || !state.joined || state.leaving) {
    throw new Error("Você não está conectado ao mundo.");
  }
  const { data, error } = await supabase.rpc("ktk_send_chat_message", {
    p_message: text
  });
  if (error) throw error;
  if (!data?.ok) throw new Error("O servidor não confirmou a mensagem.");
  window.KTKChat?.showBubble(state.user.id, data.message || text);
  return data;
}
import { sendPosition } from "../online/movement.js?v=20261118-room-grid-v1";

window.KTKOnline = {
  enter, markDead, leaveWorld, claimKingCrown, dropKingCrown, getPlayerState, gameAction, swapInventoryItem, expandInventorySlot, sendPosition, sendChat,
  get userId() { return state.user?.id || null; },
  get connected() { return state.online; }
};
window.dispatchEvent(new Event("ktk-online-ready"));

document.addEventListener("DOMContentLoaded", () => {
  // Apaga chaves gravadas por versões antigas. A sessão atual existe só em memória.
  try {
    localStorage.removeItem("ktk-display-name");
    localStorage.removeItem("sb-mtddtvqtljtgzggpdogl-auth-token");
  } catch (_) {}
  const input = document.getElementById("ktk-display-name");
  if (input) input.value = "";
  startHeartbeat();
});
