self.onmessage = async (event: MessageEvent) => {
  const { url, filename } = event.data;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();

    const blob = new Blob([arrayBuffer], { type: "application/pdf" });
    const blobUrl = URL.createObjectURL(blob);

    self.postMessage({ type: "done", blobUrl, filename });
  } catch (err) {
    self.postMessage({
      type: "error",
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
};
