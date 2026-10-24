/** One unacknowledged frame per map. It is removed only after acknowledgement or explicit discard. */
export interface StoredFrame {
  mapId: string;
  captureId: string;
  index: number;
  file: File;
}
const DATABASE = "ttkmap-capture-frames";
async function access<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  if (typeof indexedDB === "undefined")
    throw new Error("Persistent browser storage is unavailable");
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("pending", { keyPath: "mapId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Capture storage is blocked"));
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("pending", mode);
      const request = action(transaction.objectStore("pending"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
export async function storePendingFrame(frame: StoredFrame) {
  try {
    await access("readwrite", (store) => store.put(frame));
    return true;
  } catch {
    return false;
  }
}
export async function loadPendingFrame(
  mapId: string,
): Promise<StoredFrame | null> {
  try {
    return (await access("readonly", (store) => store.get(mapId))) ?? null;
  } catch {
    return null;
  }
}
export async function clearPendingFrame(mapId: string) {
  try {
    await access("readwrite", (store) => store.delete(mapId));
  } catch {
    /* An acknowledged slot is safe to retry after recovery. */
  }
}
