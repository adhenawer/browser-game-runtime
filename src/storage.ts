// SPDX-License-Identifier: GPL-2.0-or-later
/** A local key/value store. Select a stable namespace; changing it does not migrate saves. */
export interface StoreOptions {
  database: string;
  store?: string;
  version?: number;
  factory?: IDBFactory;
}

export function createStore(options: StoreOptions) {
  const { database: name, store = 'data', version = 1 } = options;
  if (!name || !store || !Number.isSafeInteger(version) || version < 1) {
    throw new TypeError('A database name, store name and positive integer version are required.');
  }
  let database: Promise<IDBDatabase> | undefined;
  function open(): Promise<IDBDatabase> {
    if (database) return database;
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const request = (options.factory ?? indexedDB).open(name, version);
      let failed = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
      };
      request.onerror = () => { failed = true; reject(request.error); };
      request.onblocked = () => {
        failed = true;
        reject(new Error('Storage upgrade is blocked. Close other tabs using this database and retry.'));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (failed) { db.close(); return; }
        db.onversionchange = () => {
          db.close();
          if (database === pending) database = undefined;
        };
        resolve(db);
      };
    });
    database = pending;
    void pending.catch(() => { if (database === pending) database = undefined; });
    return pending;
  }
  async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = operation(tx.objectStore(store));
      // Request success alone does not prove that a write committed.
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? request.error ?? new Error('Storage transaction failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('Storage transaction was aborted.'));
    });
  }
  return {
    read<T>(key: IDBValidKey): Promise<T | undefined> {
      return transaction('readonly', store => store.get(key));
    },
    async write(key: IDBValidKey, value: unknown): Promise<void> {
      await transaction('readwrite', store => store.put(value, key));
    },
    async remove(key: IDBValidKey): Promise<void> {
      await transaction('readwrite', store => store.delete(key));
    },
    async close(): Promise<void> {
      const pending = database;
      database = undefined;
      if (pending) (await pending).close();
    }
  };
}
