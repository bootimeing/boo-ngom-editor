export type ReloadSender = (targetPath: string, items: readonly string[]) => Promise<string>;

export interface CoalescingReloadQueueOptions {
  settleMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  onCoalesced?: (targetPath: string, requestCount: number, items: readonly string[]) => void;
}

interface ReloadWaiter {
  resolve: (result: string) => void;
  reject: (error: unknown) => void;
}

interface ReloadTargetState {
  targetPath: string;
  running: boolean;
  pendingItems: Set<string>;
  pendingWaiters: ReloadWaiter[];
  lastCompletedAt?: number;
}

export class CoalescingReloadQueue {
  private readonly states = new Map<string, ReloadTargetState>();
  private readonly settleMs: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly sender: ReloadSender,
    private readonly options: CoalescingReloadQueueOptions = {}
  ) {
    this.settleMs = Math.max(0, options.settleMs ?? 0);
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  }

  enqueue(targetPath: string, items: readonly string[]): Promise<string> {
    const key = targetPath.toLowerCase();
    let state = this.states.get(key);
    if (!state) {
      state = {
        targetPath,
        running: false,
        pendingItems: new Set<string>(),
        pendingWaiters: []
      };
      this.states.set(key, state);
    }

    state.targetPath = targetPath;
    for (const item of items) {
      const normalized = item.trim();
      if (normalized) state.pendingItems.add(normalized);
    }

    const result = new Promise<string>((resolve, reject) => {
      state!.pendingWaiters.push({ resolve, reject });
    });

    if (state.pendingWaiters.length > 1) {
      this.options.onCoalesced?.(
        state.targetPath,
        state.pendingWaiters.length,
        [...state.pendingItems]
      );
    }

    if (!state.running) {
      state.running = true;
      queueMicrotask(() => void this.drain(state!));
    }
    return result;
  }

  private async drain(state: ReloadTargetState): Promise<void> {
    while (state.pendingWaiters.length > 0) {
      const items = [...state.pendingItems];
      const waiters = state.pendingWaiters.splice(0);
      state.pendingItems.clear();

      try {
        if (state.lastCompletedAt !== undefined) {
          const remaining = state.lastCompletedAt + this.settleMs - this.now();
          if (remaining > 0) await this.sleep(remaining);
        }
        const result = items.length > 0
          ? await this.sender(state.targetPath, items)
          : 'ERR:无有效重载项';
        this.markCompleted(state);
        for (const waiter of waiters) waiter.resolve(result);
      } catch (error) {
        this.markCompleted(state);
        for (const waiter of waiters) waiter.reject(error);
      }
    }
    state.running = false;
  }

  private markCompleted(state: ReloadTargetState): void {
    state.lastCompletedAt = this.now();
  }
}
