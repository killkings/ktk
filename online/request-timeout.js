/* Limite comum para operações de rede da entrada online. */
export async function withTimeout(label, timeoutMs, operation) {
  const duration = Math.max(1, Number(timeoutMs) || 1);
  const controller = new AbortController();
  let timer = null;
  let timedOut = false;
  try {
    const task = Promise.resolve().then(() => (
      typeof operation === "function" ? operation(controller.signal) : operation
    ));
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error(
          String(label || "A operação") + " não respondeu em " +
          Math.ceil(duration / 1000) + " segundos."
        ));
      }, duration);
    });
    return await Promise.race([task, deadline]);
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (!timedOut) controller.abort();
  }
}
