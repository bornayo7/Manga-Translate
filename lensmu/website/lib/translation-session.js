// Owns one visible demo request and its result URL. Obsolete asynchronous work
// may finish, but it cannot publish progress or allocate an orphaned URL.
export function createTranslationSession({ translate, publish, createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL }) {
  let revision = 0;
  let disposed = false;
  let controller = null;
  let resultUrl = null;
  const release = () => { if (resultUrl) revokeUrl(resultUrl); resultUrl = null; };
  return {
    async run(input) {
      if (disposed) return null;
      controller?.abort();
      release();
      const ownRevision = ++revision;
      const ownController = new AbortController();
      controller = ownController;
      const current = () => !disposed && revision === ownRevision && !ownController.signal.aborted;
      publish({ phase: 'uploading', detail: 'Reading your image', error: '', result: null });
      try {
        const result = await translate({ ...input, signal: ownController.signal, onProgress: (phase, detail = '') => {
          if (current() && phase !== 'done') publish({ phase, detail, error: '', result: null });
        } });
        if (!current()) return null;
        resultUrl = createUrl(result.blob);
        const ready = { ...result, url: resultUrl };
        publish({ phase: 'done', detail: `${result.rendered} of ${result.blocks.length} regions translated`, error: '', result: ready });
        return ready;
      } catch (error) {
        if (current()) publish({ phase: 'error', detail: '', error: error instanceof Error ? error.message : String(error), result: null });
        return null;
      } finally { if (revision === ownRevision) controller = null; }
    },
    cancel() {
      if (disposed) return;
      revision += 1;
      controller?.abort(); controller = null;
      release();
      publish({ phase: 'idle', detail: 'Translation cancelled.', error: '', result: null });
    },
    dispose() { disposed = true; revision += 1; controller?.abort(); controller = null; release(); },
  };
}
