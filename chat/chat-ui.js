/* Composição do chat efêmero e balões temporários dos jogadores. */
(() => {
  'use strict';

  const BUBBLE_DURATION_MS = 5200;
  const MAX_MESSAGE_LENGTH = 120;
  const bubbles = new Map();
  const seenEvents = new Set();

  function showBubble(userId, message) {
    const id = String(userId || '');
    const text = String(message || '').trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!id || !text) return false;
    bubbles.set(id, {
      text,
      expiresAt: Date.now() + BUBBLE_DURATION_MS
    });
    return true;
  }

  function receive(payload) {
    const userId = String(payload?.user_id || '');
    const message = String(payload?.message || '').trim();
    const eventId = String(payload?.event_id || '');
    if (!userId || !message || message.length > MAX_MESSAGE_LENGTH) return false;
    if (userId === String(window.KTKOnline?.userId || '')) return false;
    if (eventId && seenEvents.has(eventId)) return false;
    if (eventId) {
      seenEvents.add(eventId);
      if (seenEvents.size > 128) {
        const oldest = seenEvents.values().next().value;
        if (oldest) seenEvents.delete(oldest);
      }
    }
    return showBubble(userId, message);
  }

  function getBubble(userId) {
    const id = String(userId || '');
    const bubble = bubbles.get(id);
    if (!bubble) return null;
    const remaining = bubble.expiresAt - Date.now();
    if (remaining <= 0) {
      bubbles.delete(id);
      return null;
    }
    return {
      text: bubble.text,
      opacity: Math.min(1, remaining / 650)
    };
  }

  window.KTKChat = {
    showBubble,
    receive,
    getBubble,
    clear() {
      bubbles.clear();
      seenEvents.clear();
    }
  };

  const form = document.getElementById('chat-composer');
  const input = document.getElementById('chat-message');
  const submitButton = form?.querySelector('button[type="submit"]');

  if (!form || !input) return;

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const message = String(input.value || '').trim();
    if (!message) return;
    if (message.length > MAX_MESSAGE_LENGTH) {
      window.toast?.('A mensagem pode ter no máximo 120 caracteres.');
      return;
    }

    if (submitButton) submitButton.disabled = true;
    try {
      const sender = window.KTKOnline?.sendChat;
      if (typeof sender !== 'function') throw new Error('O chat ainda não está conectado.');
      await sender(message);
      input.value = '';
    } catch (error) {
      const detail = String(error?.message || '');
      if (detail.includes('CHAT_RATE_LIMIT')) {
        window.toast?.('Espere um instante antes de enviar outra mensagem.');
      } else if (detail.includes('PLAYER_NOT_ACTIVE')) {
        window.toast?.('Você não está conectado ao mundo.');
      } else {
        window.toast?.(detail || 'Não foi possível enviar a mensagem.');
      }
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  window.addEventListener('keydown', event => {
    const target = event.target;
    const key = String(event.key || '').toLowerCase();
    if (!key) return;
    const insideChat = Boolean(target?.closest?.('#chat-composer'));
    if (key === 'escape' && insideChat) {
      event.preventDefault();
      input.blur();
      return;
    }
    const gameUi = document.getElementById('game-ui');
    if (key === 't' && !event.repeat && !insideChat &&
        gameUi?.classList.contains('active')) {
      event.preventDefault();
      input.focus();
    }
  });
})();
