/**
 * Receipt Download Web Worker
 *
 * Offloads PDF receipt fetching to a background thread so the main UI
 * thread stays responsive during large downloads.
 *
 * Message protocol:
 *   IN  → { url: string, filename: string }
 *   OUT → { type: "done", blobUrl: string, filename: string }
 *        | { type: "error", error: string }
 *
 * The caller is responsible for revoking the blobUrl after use
 * (URL.revokeObjectURL) to free the in-memory Blob.
 */
self.onmessage = async (event: MessageEvent) => {
  const { url, filename } = event.data;

  try {
    // Fetch the PDF from the server-side receipt generation endpoint
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }

    // Read the full response body into an ArrayBuffer (binary PDF data)
    const arrayBuffer = await response.arrayBuffer();

    // Wrap the binary data in a typed Blob so the browser can treat it as
    // a downloadable PDF file
    const blob = new Blob([arrayBuffer], { type: "application/pdf" });

    // Create a temporary object URL that the main thread can assign to an
    // anchor element's href to trigger the download
    const blobUrl = URL.createObjectURL(blob);

    // Return the download-ready URL and the suggested filename back to
    // the main thread
    self.postMessage({ type: "done", blobUrl, filename });
  } catch (err) {
    // Surface a clean error string — the main thread shows this in a toast
    self.postMessage({
      type: "error",
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
};
