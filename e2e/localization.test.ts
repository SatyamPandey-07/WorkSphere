import { test, expect } from "@playwright/test";

test.describe("API Gateway Validation Locale Fencing Checks", () => {
  test("should intercept bad workspace inputs with localized response tokens", async ({ request }) => {
    const response = await request.post("/api/venues/verify", {
      headers: {
        // Enforce the target localization translation file context rules
        "Accept-Language": "hi", 
      },
      data: {
        name: "", // Will trigger blank validation logic rules
        email: "malformed-coordinate-string",
      },
    });

    const body = await response.json();
    
    expect(response.status()).toBe(400);
    // Asserts that the validation runtime returns the target language bundle matches
    expect(body.errors.name).toBe("Workspace moniker cannot be blank."); 
  });
});