import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 任务上下文：把「当前任务的中止信号」隐式传给深处的大模型调用，
 * 这样 pipeline 里几十处 chat/chatJSON 不用逐层加参数也能被取消。
 * 用 AsyncLocalStorage 保证并发任务（如并行生成讲义）互不串信号。
 */

export const jobStorage = new AsyncLocalStorage();

export class CancelledError extends Error {
  constructor(message = '已取消生成') {
    super(message);
    this.name = 'CancelledError';
    this.cancelled = true;
  }
}

/** 当前任务的中止信号；不在任务上下文里时为 undefined */
export function currentSignal() {
  return jobStorage.getStore()?.signal;
}

/** 已被取消则立刻抛出，用于非模型步骤（拼装、落库前）的检查点 */
export function throwIfCancelled() {
  if (jobStorage.getStore()?.signal?.aborted) throw new CancelledError();
}

export function isCancelled(err) {
  return Boolean(err?.cancelled) || err?.name === 'CancelledError';
}
