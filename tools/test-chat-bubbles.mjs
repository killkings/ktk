import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [chatSource, onlineSource, realtimeSource, rendererSource, inputSource, html, css, migration] = await Promise.all([
  read("../chat/chat-ui.js"),
  read("../js/online.js"),
  read("../online/realtime.js"),
  read("../render/world-renderer.js"),
  read("../input/input-controller.js"),
  read("../campo_livre_atualizado.html"),
  read("../css/game.css"),
  read("../supabase/migrations/20261118170000_ephemeral_world_chat.sql")
]);

// The database owns sender identity, validates active characters and throttles messages.
assert.match(migration, /auth\.uid\(\)/);
assert.match(migration, /realtime\.send\(/);
assert.match(migration, /'chat_message'/);
assert.match(migration, /'world:main'/);
assert.match(migration, /CHAT_RATE_LIMIT/);
assert.match(migration, /last_seen_at >= v_now - interval '2 minutes'/);
assert.match(migration, /references public\.ktk_profiles\(id\) on delete cascade/);
assert.match(onlineSource, /rpc\("ktk_send_chat_message"/);
assert.match(realtimeSource, /event: "chat_message"/);

// A small DOM harness verifies local bubbles, remote broadcasts, T focus and Enter send.
const formListeners = new Map();
const windowListeners = new Map();
const sentMessages = [];
const toasts = [];
const submitButton = { disabled:false };
const document = { activeElement:null };
const input = {
  value:"",
  focused:false,
  addEventListener(){},
  focus(){ this.focused=true; document.activeElement=this; },
  blur(){ this.focused=false; document.activeElement=null; },
  closest(selector){ return selector==="#chat-composer"?form:null; }
};
const form = {
  addEventListener(type,callback){formListeners.set(type,callback);},
  querySelector(selector){
    assert.equal(selector,'button[type="submit"]');
    return submitButton;
  },
  contains(target){return target===input||target===submitButton;}
};
const gameUi = {classList:{contains:()=>true}};
const window = {
  KTKOnline:{
    userId:"local-player",
    async sendChat(message){
      sentMessages.push(message);
      return {ok:true,message};
    }
  },
  toast(message){toasts.push(String(message));},
  addEventListener(type,callback){
    const callbacks=windowListeners.get(type)||[];
    callbacks.push(callback);
    windowListeners.set(type,callbacks);
  }
};
Object.assign(document,{
  getElementById(id){
    return id==="chat-composer"?form:id==="chat-message"?input:id==="game-ui"?gameUi:null;
  }
});
vm.runInNewContext(chatSource,{window,document,Date,Math,String,Number,console});

assert.equal(window.KTKChat.showBubble("local-player","Minha fala"),true);
assert.equal(window.KTKChat.getBubble("local-player").text,"Minha fala");
assert.equal(window.KTKChat.receive({
  event_id:"event-local",user_id:"local-player",message:"eco"
}),false,"Broadcast próprio não pode duplicar o balão local.");
assert.equal(window.KTKChat.receive({
  event_id:"event-remote",user_id:"remote-player",message:"Olá, mundo!"
}),true);
assert.equal(window.KTKChat.getBubble("remote-player").text,"Olá, mundo!");
assert.equal(window.KTKChat.receive({
  event_id:"event-remote",user_id:"remote-player",message:"Olá, mundo!"
}),false,"Uma repetição do mesmo evento não deve recriar a fala.");

let prevented=false;
const keydown=(windowListeners.get("keydown")||[])[0];
keydown({
  key:"t",repeat:false,target:{closest:()=>null},
  preventDefault(){prevented=true;}
});
assert.equal(prevented,true);
assert.equal(input.focused,true,"T deve focar o campo de conversa.");

input.value="Vamos explorar!";
await formListeners.get("submit")({preventDefault(){}});
assert.deepEqual(sentMessages,["Vamos explorar!"]);
assert.equal(input.value,"","Mensagem enviada deve limpar o campo.");
assert.equal(submitButton.disabled,false);

document.activeElement=input;
let escapePrevented=false;
keydown({
  key:"Escape",target:input,
  preventDefault(){escapePrevented=true;}
});
assert.equal(escapePrevented,true);
assert.equal(document.activeElement,null,"Escape fecha o foco do chat sem sair do jogo.");

assert.match(inputSource,/closest\?\.\('#chat-composer'\)/);
assert.match(rendererSource,/function drawChatBubble\(/);
assert.match(rendererSource,/window\.KTKChat\?\.getBubble/);
assert.match(html,/id="chat-composer"/);
const sidebarStart=html.indexOf('class="player-sidebar"');
const statusEnd=html.indexOf('</aside>',sidebarStart);
const chatStart=html.indexOf('id="chat-composer"',sidebarStart);
const coordsStart=html.indexOf('<div class="coords"',chatStart);
const sidebarTail=html.slice(chatStart,coordsStart);
assert.ok(sidebarStart>=0&&statusEnd>sidebarStart&&chatStart>statusEnd&&coordsStart>chatStart&&sidebarTail.includes("</form>")&&sidebarTail.trimEnd().endsWith("</div>"),
  "O campo de conversa deve ficar dentro da barra lateral, depois do status do jogador.");
assert.match(html,/chat\/chat-ui\.js\?v=20261118-world-chat-v1/);
assert.match(css,/#game-ui \.player-sidebar > \.chat-composer\s*\{[\s\S]*?position:relative/);
assert.match(css,/pointer-events:auto/);

console.log("World chat, authenticated Broadcast, speech bubbles and keyboard isolation passed.");
