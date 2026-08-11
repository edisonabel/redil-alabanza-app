export type LatestWinsAsyncQueue<T> = {
  clearPending: () => void;
  request: (value: T) => Promise<void>;
};

type LatestWinsAsyncQueueOptions<T> = {
  isEquivalent?: (left: T, right: T) => boolean;
};

export const createLatestWinsAsyncQueue = <T>(
  worker: (value: T) => Promise<void>,
  options: LatestWinsAsyncQueueOptions<T> = {},
): LatestWinsAsyncQueue<T> => {
  let runningPromise: Promise<void> | null = null;
  let pendingValue: T | undefined;
  let hasPendingValue = false;

  const isEquivalent = options.isEquivalent || Object.is;

  const drain = async (initialValue: T) => {
    let activeValue = initialValue;

    while (true) {
      let activeWorkerFailed = false;
      try {
        await worker(activeValue);
      } catch (error) {
        if (!hasPendingValue) {
          throw error;
        }
        activeWorkerFailed = true;
      }

      if (!hasPendingValue) {
        return;
      }

      const nextValue = pendingValue as T;
      pendingValue = undefined;
      hasPendingValue = false;

      if (!activeWorkerFailed && isEquivalent(activeValue, nextValue)) {
        return;
      }

      activeValue = nextValue;
    }
  };

  return {
    clearPending() {
      pendingValue = undefined;
      hasPendingValue = false;
    },
    request(value) {
      if (runningPromise) {
        pendingValue = value;
        hasPendingValue = true;
        return runningPromise;
      }

      const task = drain(value);
      runningPromise = task.finally(() => {
        pendingValue = undefined;
        hasPendingValue = false;
        runningPromise = null;
      });
      return runningPromise;
    },
  };
};
