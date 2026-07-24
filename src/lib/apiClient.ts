export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, init);

  if (response.status === 429) {
    const urlString =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url || "";

    let endpoint = "chat";
    if (
      urlString.includes("/book") ||
      urlString.includes("/confirm") ||
      urlString.includes("/reservations")
    ) {
      endpoint = "book";
    }

    const retryAfterHeader = response.headers.get("Retry-After");
    const resetHeader = response.headers.get("X-RateLimit-Reset");
    let seconds = 60;

    if (retryAfterHeader) {
      seconds = parseInt(retryAfterHeader, 10) || 60;
    } else if (resetHeader) {
      const resetTime = parseInt(resetHeader, 10);
      if (resetTime) {
        seconds = Math.max(1, Math.ceil(resetTime - Date.now() / 1000));
      }
    } else {
      try {
        const clone = response.clone();
        const data = await clone.json();
        if (typeof data.retryAfter === "number") {
          seconds = data.retryAfter;
        } else if (typeof data.retryAfter === "string") {
          seconds = parseInt(data.retryAfter, 10) || 60;
        }
      } catch {
        // ignore
      }
    }

    if (typeof window !== "undefined") {
      const event = new CustomEvent("rate-limit-triggered", {
        detail: { retryAfter: seconds, endpoint },
      });
      window.dispatchEvent(event);
    }
  }

  return response;
}
