// Clock-in outcomes distinguish a confirmed database write from a pending
// offline upload. HTTP failures are permissions/validation problems and
// must never be disguised as "success".
export async function saveCheckinOrQueue(row, post, enqueue) {
  try {
    await post("field_checkins", row);
    return "saved";
  } catch (error) {
    if (error?.status) throw error;
    enqueue({ table: "field_checkins", payload: row });
    return "queued";
  }
}

export function checkinSaveMessage(error, lang = "en") {
  const permission = [401, 403].includes(error?.status);
  if (lang === "es") return permission
    ? "Entrada rechazada por permisos de la cuenta. Pide a la oficina que revise tu acceso; NO se registró la entrada."
    : "La entrada no se guardó. Revisa tu conexión y avisa a la oficina si continúa.";
  return permission
    ? "Check-in blocked by account permissions. Ask the office to verify your access. You are NOT checked in."
    : "Check-in did not save. Please try again or ask the office for help.";
}
