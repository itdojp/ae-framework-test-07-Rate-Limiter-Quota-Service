export class KeyedMutex {
  private locked = new Set<string>();
  private waiters = new Map<string, Array<() => void>>();

  private async acquire(key: string): Promise<void> {
    if (!this.locked.has(key)) {
      this.locked.add(key);
      return;
    }

    await new Promise<void>((resolve) => {
      const queue = this.waiters.get(key);
      if (queue) {
        queue.push(resolve);
      } else {
        this.waiters.set(key, [resolve]);
      }
    });

    this.locked.add(key);
  }

  private release(key: string): void {
    const queue = this.waiters.get(key);
    if (!queue || queue.length === 0) {
      this.waiters.delete(key);
      this.locked.delete(key);
      return;
    }

    const next = queue.shift();
    if (queue.length === 0) {
      this.waiters.delete(key);
    }

    if (next) {
      next();
    }
  }

  async runExclusive<T>(key: string, task: () => Promise<T> | T): Promise<T> {
    await this.acquire(key);
    try {
      return await task();
    } finally {
      this.release(key);
    }
  }
}
