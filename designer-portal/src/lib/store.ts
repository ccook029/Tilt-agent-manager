// ---------------------------------------------------------------------------
// store.ts — conversation persistence in IndexedDB (client only).
//
// localStorage's ~5MB quota dies fast when every message can carry multi-MB
// base64 images, so conversations live in IndexedDB instead. Two stores:
// "meta" (id/title/updatedAt — cheap to list for the sidebar) and "bodies"
// (the message arrays with their images, loaded one conversation at a time).
// ---------------------------------------------------------------------------

import type { ChatMessage } from "@/lib/gemini";

export type ConversationMeta = {
  id: string;
  title: string;
  updatedAt: number;
};

const DB_NAME = "tilt-design-portal";
const META = "meta";
const BODIES = "bodies";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
      if (!db.objectStoreNames.contains(BODIES)) db.createObjectStore(BODIES, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function listConversations(): Promise<ConversationMeta[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(META, "readonly");
    const req = tx.objectStore(META).getAll();
    await txDone(tx);
    const all = (req.result as ConversationMeta[]) ?? [];
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

export async function loadMessages(id: string): Promise<ChatMessage[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(BODIES, "readonly");
    const req = tx.objectStore(BODIES).get(id);
    await txDone(tx);
    return (req.result as { messages?: ChatMessage[] } | undefined)?.messages ?? [];
  } finally {
    db.close();
  }
}

export async function saveConversation(
  meta: ConversationMeta,
  messages: ChatMessage[]
): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction([META, BODIES], "readwrite");
    tx.objectStore(META).put(meta);
    tx.objectStore(BODIES).put({ id: meta.id, messages });
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction([META, BODIES], "readwrite");
    tx.objectStore(META).delete(id);
    tx.objectStore(BODIES).delete(id);
    await txDone(tx);
  } finally {
    db.close();
  }
}
