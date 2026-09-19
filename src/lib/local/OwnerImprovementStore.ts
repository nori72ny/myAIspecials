export type OwnerImprovementCategory =
  | "product"
  | "security"
  | "design"
  | "ai"
  | "reliability"
  | "performance"
  | "external"
  | "other";

export type OwnerImprovementState =
  | "received"
  | "researching"
  | "decision-ready"
  | "building"
  | "verifying"
  | "owner-approval-required"
  | "ready-to-release"
  | "released"
  | "rejected-or-deferred";

export type OwnerImprovementSource = "owner-inbox" | "chat-routing";

export interface OwnerImprovementItem {
  id: string;
  title: string;
  body: string;
  category: OwnerImprovementCategory;
  state: OwnerImprovementState;
  source: OwnerImprovementSource;
  createdAt: number;
  updatedAt: number;
  localOnly: true;
}

const DB_NAME = "origin-owner-improvements";
const DB_VERSION = 1;
const STORE_NAME = "items";
const MAX_ITEMS = 200;
const MAX_BODY_LENGTH = 20_000;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("OWNER_IMPROVEMENT_DB_OPEN_FAILED"));
    request.onblocked = () => reject(new Error("OWNER_IMPROVEMENT_DB_BLOCKED"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("OWNER_IMPROVEMENT_DB_ABORTED"));
    transaction.onerror = () => reject(transaction.error ?? new Error("OWNER_IMPROVEMENT_DB_FAILED"));
  });
}

function normalizeTitle(body: string): string {
  const firstLine = body.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  return (firstLine || "ORIGIN improvement request").slice(0, 120);
}

function createId(now: number): string {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `owner-improvement-${now}-${random}`;
}

export async function listOwnerImprovements(): Promise<OwnerImprovementItem[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    const items = await new Promise<OwnerImprovementItem[]>((resolve, reject) => {
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result as OwnerImprovementItem[] : []);
      request.onerror = () => reject(request.error ?? new Error("OWNER_IMPROVEMENT_DB_READ_FAILED"));
    });
    await transactionDone(transaction);
    return items
      .filter((item) => item && typeof item.id === "string" && typeof item.body === "string")
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_ITEMS);
  } finally {
    database.close();
  }
}

export async function addOwnerImprovement(input: {
  body: string;
  category: OwnerImprovementCategory;
  source: OwnerImprovementSource;
  now?: number;
}): Promise<OwnerImprovementItem> {
  const body = input.body.trim().slice(0, MAX_BODY_LENGTH);
  if (!body) throw new Error("OWNER_IMPROVEMENT_EMPTY");
  const now = input.now ?? Date.now();
  const item: OwnerImprovementItem = {
    id: createId(now),
    title: normalizeTitle(body),
    body,
    category: input.category,
    state: "received",
    source: input.source,
    createdAt: now,
    updatedAt: now,
    localOnly: true,
  };

  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(item);
    await transactionDone(transaction);
    return item;
  } finally {
    database.close();
  }
}

export async function updateOwnerImprovementState(
  id: string,
  state: OwnerImprovementState,
  now = Date.now(),
): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);
    const existing = await new Promise<OwnerImprovementItem | null>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error("OWNER_IMPROVEMENT_DB_READ_FAILED"));
    });
    if (!existing) throw new Error("OWNER_IMPROVEMENT_NOT_FOUND");
    store.put({ ...existing, state, updatedAt: now });
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
