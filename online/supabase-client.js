/* Cliente único do Supabase para todos os módulos online. */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm";
import { state } from "./state.js?v=20261117-walk-v1";

export const SUPABASE_URL = "https://mtddtvqtljtgzggpdogl.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_U5CdIRdPg0Brfn7x2Bj2hQ_VCXjwRQH";
export const WORLD_ID = "main";
export const TOPIC = "world:main";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: true,
    detectSessionInUrl: false
  },
  realtime: { params: { eventsPerSecond: 20 } }
});

/* Um único listener mantém o token na mesma sessão compartilhada. */
supabase.auth.onAuthStateChange((_event, session) => {
  state.accessToken = session?.access_token || "";
});
