// Bound only login requests: crew check-in writes use their own offline queue
// and must never be retried automatically after an ambiguous network timeout.
export const LOGIN_TIMEOUT_MS = 12000;

export function withLoginTimeout(operation, timeoutMs = LOGIN_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error("login_timeout"), { code: "login_timeout" }));
      controller.abort();
    }, timeoutMs);
  });

  return Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout])
    .finally(() => clearTimeout(timer));
}

export function loginErrorMessage(error, lang = "en", pinOnly = false) {
  const es = lang === "es";
  if (error?.message === "auth_failed") {
    return pinOnly
      ? (es ? "PIN incorrecto. Intenta de nuevo." : "Wrong PIN. Try again.")
      : (es ? "Credenciales inválidas." : "Invalid credentials.");
  }
  if (error?.status === 401 || error?.status === 403) {
    return es
      ? "Acceso al directorio denegado. Pide a la oficina que revise los permisos."
      : "Staff directory access denied. Ask the office to check permissions.";
  }
  if (error?.code === "login_timeout" || error?.name === "AbortError" || error?.status >= 500) {
    return es
      ? "Servicio de campo no disponible. No se verificó tu PIN. Intenta de nuevo más tarde."
      : "Field service unavailable. Your PIN was not verified. Please try again later.";
  }
  return es ? "Error de conexión. Intenta de nuevo." : "Connection error. Try again.";
}
