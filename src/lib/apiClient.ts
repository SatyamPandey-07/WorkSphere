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
      const parsedInt = parseInt(retryAfterHeader, 10);
      if (!isNaN(parsedInt)) {
        seconds = Math.max(1, parsedInt);
      } else {
        const dateMs = Date.parse(retryAfterHeader);
        if (!isNaN(dateMs)) {
          seconds = Math.max(1, Math.ceil((dateMs - Date.now()) / 1000));
        } else {
          seconds = 60;
        }
      }
    } else if (resetHeader) {
      const resetTime = parseInt(resetHeader, 10);
      if (!isNaN(resetTime) && resetTime > 0) {
        if (resetTime > 1e9) {
          seconds = Math.max(1, Math.ceil(resetTime - Date.now() / 1000));
        } else {
          seconds = Math.max(1, resetTime);
        }
      }
    } else {
      try {
        const clone = response.clone();
        const data = await clone.json();
        const val = data.retryAfter ?? data.retry_after ?? data.resetIn;
        if (typeof val === "number") {
          seconds = Math.max(1, Math.ceil(val));
        } else if (typeof val === "string") {
          seconds = Math.max(1, parseInt(val, 10) || 60);
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
