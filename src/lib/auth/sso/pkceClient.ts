/**
 * Client helper for initiating PKCE-protected auth requests.
 * It interacts with the Next.js API route to generate and store
 * the PKCE code challenge and verifier in HTTP-only cookies.
 */

export async function initiatePkceFlow(): Promise<{
  verifier: string;
  challenge: string;
} | null> {
  try {
    const response = await fetch("/api/auth/sso/pkce", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "generate" }),
    });

    if (!response.ok) {
      console.error("Failed to initialize PKCE flow");
      return null;
    }

    const data = await response.json();
    return data.success
      ? { verifier: data.verifier, challenge: data.challenge }
      : null;
  } catch (error) {
    console.error("Error initiating PKCE:", error);
    return null;
  }
}

export async function validatePkceFlow(
  verifier?: string,
  challenge?: string,
): Promise<boolean> {
  try {
    const response = await fetch("/api/auth/sso/pkce", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "validate", verifier, challenge }),
    });

    if (!response.ok) {
      console.error("Failed to validate PKCE");
      return false;
    }

    const data = await response.json();
    return !!data.isValid;
  } catch (error) {
    console.error("Error validating PKCE:", error);
    return false;
  }
}
