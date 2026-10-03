import { NextResponse } from "next/server";
import { validateSamlAssertion } from "@/lib/auth/sso/samlValidator";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const samlResponseBase64 = formData.get("SAMLResponse");

    if (!samlResponseBase64 || typeof samlResponseBase64 !== "string") {
      return NextResponse.json(
        { error: "Missing SAMLResponse" },
        { status: 400 },
      );
    }

    // SAML Responses are usually base64 encoded.
    const samlXml = Buffer.from(samlResponseBase64, "base64").toString("utf-8");

    // The IdP certificate must come from trusted configuration.
    const expectedCert = process.env.SAML_IDP_CERT;

    if (!expectedCert) {
      console.error("SAML_IDP_CERT is not configured");

      return NextResponse.json(
        { error: "SAML authentication is not configured" },
        { status: 500 },
      );
    }

    const expectedAudience = process.env.SAML_SP_ENTITY_ID;
    const expectedRecipient =
      process.env.SAML_ACS_URL ||
      new URL("/api/auth/sso/saml", request.url).toString();

    try {
      const { nameId, attributes } = validateSamlAssertion(
        samlXml,
        expectedCert,
        expectedAudience,
        expectedRecipient,
      );

      if (!nameId || typeof nameId !== "string") {
        return NextResponse.json(
          { error: "SAML assertion does not contain a valid NameID" },
          { status: 401 },
        );
      }

      const email =
        attributes.email ||
        attributes.emailAddress ||
        attributes[
          "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"
        ] ||
        nameId;

      if (!email || !email.includes("@")) {
        return NextResponse.json(
          { error: "SAML assertion does not contain a valid email address" },
          { status: 401 },
        );
      }

      const firstName =
        attributes.firstName ||
        attributes.givenName ||
        attributes[
          "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"
        ] ||
        null;

      const lastName =
        attributes.lastName ||
        attributes.surname ||
        attributes[
          "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname"
        ] ||
        null;

      // Provision the verified SAML user in the database.
      let user;

      try {
        user = await prisma.user.upsert({
          where: { email },
          update: {
            firstName,
            lastName,
          },
          create: {
            id: `saml_${crypto.randomUUID()}`,
            email,
            firstName,
            lastName,
          },
        });
      } catch (error) {
        console.error("Failed to provision SAML user:", error);

        return NextResponse.json(
          { error: "Failed to provision SAML user" },
          { status: 500 },
        );
      }

      return NextResponse.json({
        success: true,
        message: "SAML assertion validated successfully",
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        },
      });
    } catch (validationError: unknown) {
      const message =
        validationError instanceof Error
          ? validationError.message
          : "Invalid SAML assertion";

      return NextResponse.json({ error: message }, { status: 401 });
    }
  } catch (error) {
    console.error("Error processing SAML callback:", error);

    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
