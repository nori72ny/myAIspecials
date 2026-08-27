export type LocalNote = {
  id: string;
  path: string;
  name: string;
  content: string;
  updatedAt: number;
  size: number;
};

export type EncryptedLocalIndex = {
  version: 1;
  updatedAt: number;
  notes: Array<Pick<LocalNote, 'id' | 'path' | 'name' | 'updatedAt' | 'size'>>;
};

type MemoryGuardLike = {
  encrypt?: (plaintext: string) => Promise<string>;
};

const DB_NAME = 'origin-universal-master-v1';
const STORE_NAME = 'encrypted-index';
const INDEX_KEY = 'notes';
const WATCH_INTERVAL_MS = 2500;

function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

async function digestId(path: string): Promise<string> {
  const bytes = new TextEncoder().encode(path);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map((value) => value.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb-open-failed'));
  });
}

async function saveEncryptedIndex(payload: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(payload, INDEX_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error ?? new Error('indexeddb-write-failed')); };
  });
}

async function encryptAesGcm256(value: string, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, new TextEncoder().encode(value));
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export class LocalFirstSyncEngine {
  private directory: FileSystemDirectoryHandle | null = null;
  private watcher: number | null = null;
  private keyPromise: Promise<CryptoKey> | null = null;
  private memoryGuard: MemoryGuardLike | null;
  private notes = new Map<string, LocalNote>();
  private listeners = new Set<(notes: LocalNote[]) => void>();

  constructor(memoryGuard?: MemoryGuardLike) {
    this.memoryGuard = memoryGuard ?? null;
  }

  isSupported(): boolean { return supportsFileSystemAccess(); }

  onChange(listener: (notes: LocalNote[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async getKey(): Promise<CryptoKey> {
    if (!this.keyPromise) {
      this.keyPromise = crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    }
    return this.keyPromise;
  }

  private emit(): void { const snapshot = [...this.notes.values()].sort((a, b) => a.path.localeCompare(b.path)); this.listeners.forEach((listener) => listener(snapshot)); }

  async chooseDirectory(): Promise<void> {
    if (!supportsFileSystemAccess()) throw new Error('file-system-access-unsupported');
    const picker = (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (!picker) throw new Error('file-system-access-unsupported');
    this.directory = await picker();
    await this.syncNow();
    this.startWatching();
  }

  async readMarkdownFiles(): Promise<LocalNote[]> {
    if (!this.directory) throw new Error('directory-not-selected');
    const next = new Map<string, LocalNote>();
    const walk = async (handle: FileSystemDirectoryHandle, prefix = ''): Promise<void> => {
      for await (const entry of handle.values()) {
        if (entry.kind === 'directory') {
          await walk(entry, prefix ? `${prefix}/${entry.name}` : entry.name);
        } else if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md')) {
          const file = await entry.getFile();
          const path = prefix ? `${prefix}/${entry.name}` : entry.name;
          const id = await digestId(path);
          next.set(id, { id, path, name: entry.name, content: await file.text(), updatedAt: file.lastModified, size: file.size });
        }
      }
    };
    await walk(this.directory);
    this.notes = next;
    await this.updateEncryptedIndex();
    this.emit();
    return [...next.values()];
  }

  async writeMarkdown(path: string, content: string): Promise<void> {
    if (!this.directory || !path.toLowerCase().endsWith('.md') || path.startsWith('/') || path.includes('..')) throw new Error('invalid-markdown-path');
    const segments = path.split('/').filter(Boolean);
    const filename = segments.pop();
    if (!filename) throw new Error('invalid-markdown-path');
    let directory = this.directory;
    for (const segment of segments) directory = await directory.getDirectoryHandle(segment, { create: true });
    const handle = await directory.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    try { await writable.write(content); } finally { await writable.close(); }
    await this.syncNow();
  }

  async syncNow(): Promise<LocalNote[]> { return this.readMarkdownFiles(); }

  private async updateEncryptedIndex(): Promise<void> {
    const index: EncryptedLocalIndex = { version: 1, updatedAt: Date.now(), notes: [...this.notes.values()].map(({ id, path, name, updatedAt, size }) => ({ id, path, name, updatedAt, size })) };
    const plaintext = JSON.stringify(index);
    const encrypted = this.memoryGuard?.encrypt ? await this.memoryGuard.encrypt(plaintext) : await encryptAesGcm256(plaintext, await this.getKey());
    await saveEncryptedIndex(encrypted);
  }

  startWatching(): void {
    this.stopWatching();
    this.watcher = window.setInterval(() => { void this.syncNow().catch(() => undefined); }, WATCH_INTERVAL_MS);
  }

  stopWatching(): void { if (this.watcher !== null) window.clearInterval(this.watcher); this.watcher = null; }

  dispose(): void { this.stopWatching(); this.listeners.clear(); this.directory = null; }
}

export const localFirstSyncEngine = new LocalFirstSyncEngine();
