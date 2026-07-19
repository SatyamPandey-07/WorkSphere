export {};

declare global {
  interface CustomJwtSessionClaims {
    metadata: {
      role?: "admin" | "manager" | "employee";
    };
  }
}
