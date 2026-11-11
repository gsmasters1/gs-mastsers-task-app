// Pending checkout notes live on the device until Supabase confirms checkout.
function openOutbox() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("gsm-field-checkouts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("checkouts", { keyPath: "shift.id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function transact(mode, operation) {
  const db = await openOutbox();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("checkouts", mode);
      const request = operation(tx.objectStore("checkouts"));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error || new Error("checkout_storage_failed"));
    });
  } finally { db.close(); }
}
export async function pendingCheckouts(crewId) {
  const rows = await transact("readonly", store => store.getAll());
  return rows.filter(row => row.shift.crewId === crewId);
}
export function queueCheckout(row) {
  return transact("readwrite", store => store.put(row));
}
export function removeCheckout(id) {
  return transact("readwrite", store => store.delete(id));
}
