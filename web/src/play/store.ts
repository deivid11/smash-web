/** Cached immutable snapshots for React; simulation objects never enter this store. */
export class Store<T> {
  private listeners = new Set<() => void>();
  constructor(private value: T) {}
  getSnapshot = (): T => this.value;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  set(value: T): void { this.value = value; for (const listener of this.listeners) listener(); }
  update(patch: Partial<T>): void { this.set({ ...this.value, ...patch }); }
  clear(): void { this.listeners.clear(); }
}
