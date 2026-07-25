import { XMLParser } from "fast-xml-parser";

export interface IDPMetadata {
  entityId: string;
  ssoUrl: string;
  x509Certificates: string[];
}

/**
 * Resolves SAML 2.0 Identity Provider metadata from a given XML URL.
 *
 * @param metadataUrl - The URL hosting the IDP's SAML metadata XML
 * @returns Parsed metadata containing the entityId, ssoUrl (HTTP-Redirect), and signing certificates
 */
export async function resolveIdpMetadata(metadataUrl: string): Promise<IDPMetadata> {
  try {
    const response = await fetch(metadataUrl, {
      method: "GET",
      headers: {
        Accept: "application/xml, text/xml",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch metadata. Status: ${response.status}`);
    }

    const xmlData = await response.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true, // Strips namespace prefixes like md: or ds: for easier traversal
    });

    const parsed = parser.parse(xmlData);
    
    // EntityDescriptor is the root element
    const entityDescriptor = parsed.EntityDescriptor;
    if (!entityDescriptor) {
      throw new Error("Invalid SAML Metadata: Missing EntityDescriptor");
    }

    const entityId = entityDescriptor["@_entityID"];
    const idpSsoDescriptor = entityDescriptor.IDPSSODescriptor;

    if (!idpSsoDescriptor) {
      throw new Error("Invalid SAML Metadata: Missing IDPSSODescriptor");
    }

    // Extract SingleSignOnService URL (Prefer HTTP-Redirect)
    let ssoUrl = "";
    const ssoServices = Array.isArray(idpSsoDescriptor.SingleSignOnService)
      ? idpSsoDescriptor.SingleSignOnService
      : [idpSsoDescriptor.SingleSignOnService];

    for (const service of ssoServices) {
      if (service && service["@_Binding"] === "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect") {
        ssoUrl = service["@_Location"];
        break;
      }
    }

    // Fallback to the first one if HTTP-Redirect is not found
    if (!ssoUrl && ssoServices[0]) {
      ssoUrl = ssoServices[0]["@_Location"];
    }

    if (!ssoUrl) {
      throw new Error("No SingleSignOnService found in metadata");
    }

    // Extract x509 Certificates
    const x509Certificates: string[] = [];
    const keyDescriptors = Array.isArray(idpSsoDescriptor.KeyDescriptor)
      ? idpSsoDescriptor.KeyDescriptor
      : [idpSsoDescriptor.KeyDescriptor];

    for (const kd of keyDescriptors) {
      if (!kd) continue;
      // Usually we want 'signing' keys, or keys with no specific 'use' attribute
      const use = kd["@_use"];
      if (!use || use === "signing") {
        const x509Cert = kd.KeyInfo?.X509Data?.X509Certificate;
        if (x509Cert) {
          x509Certificates.push(x509Cert.trim());
        }
      }
    }

    return {
      entityId,
      ssoUrl,
      x509Certificates,
    };
  } catch (error) {
    console.error("Error resolving IDP metadata:", error);
    throw new Error("Could not resolve IDP Metadata");
  }
}
