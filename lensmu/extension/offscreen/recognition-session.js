// Idle cleanup belongs to the offscreen document, which can outlive the MV3
// worker. Tasks and teardown share one queue, including accepted queued work.
export function createRecognitionSession({ recognize, terminate, notifyIdle, idleMs = 60000,
  schedule = setTimeout, unschedule = clearTimeout }) {
  let chain = Promise.resolve(), pending = 0, idle = false, timer;
  const serialize = work => { const result = chain.then(work); chain = result.catch(() => undefined); return result; };
  const armIdle = () => {
    unschedule(timer);
    if (pending) return;
    timer = schedule(() => {
      void serialize(async () => {
        if (pending) return;
        await terminate();
        if (!pending) {
          idle = true;
          // The worker's close queue may already await a new recognition.
          // Release this queue before awaiting that other owner; it rechecks
          // idle status before closing the document.
          void Promise.resolve().then(notifyIdle).catch(() => undefined);
        }
      }).catch(() => undefined);
    }, idleMs);
  };
  armIdle();
  return {
    recognize(image, language) {
      pending++; idle = false; unschedule(timer);
      return serialize(() => recognize(image, language)).finally(() => { pending--; armIdle(); });
    },
    status: () => ({ pending, idle })
  };
}
