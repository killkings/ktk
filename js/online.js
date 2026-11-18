/* Ponto de composição do multiplayer V1: expõe somente a API pública do jogo. */
import {
  enter, markDead, leaveWorld, getPlayerState, startHeartbeat
} from "../online/session.js?v=20261117-walk-v1";
import { gameAction, claimKingCrown, dropKingCrown } from "../online/actions.js?v=20261117-combat-v1";
import { state } from "../online/state.js?v=20261117-walk-v1";
import { sendPosition } from "../online/movement.js?v=20261117-combat-v1";

window.KTKOnline = {
  enter, markDead, leaveWorld, claimKingCrown, dropKingCrown, getPlayerState, gameAction, sendPosition,
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
