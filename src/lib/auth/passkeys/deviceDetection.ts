/**
 * Passkey Device Detection & Smart Nicknaming Helper
 * 
 * Provides automated platform/authenticator recognition, friendly nickname generation,
 * and preset suggestions for WorkSphere Passkey Management.
 */

export interface DeviceInfo {
  platform: string; // "macOS", "Windows", "iOS", "Android", "Linux", "ChromeOS", "Unknown"
  browser: string; // "Chrome", "Safari", "Edge", "Firefox", "Brave", "Arc", "Browser"
  authenticatorType: "biometric" | "hardware_key" | "hybrid" | "platform" | "unknown";
  authenticatorName: string; // "Touch ID", "Face ID", "Windows Hello", "YubiKey", "Android Biometric", "Passkey"
  iconType: "laptop" | "phone" | "tablet" | "key" | "desktop" | "shield";
  suggestedNickname: string;
}

export const COMMON_AAGUIDS: Record<string, { name: string; type: DeviceInfo["authenticatorType"]; icon: DeviceInfo["iconType"] }> = {
  // Apple iCloud Keychain
  "00000000-0000-0000-0000-000000000000": { name: "iCloud Keychain / Passkey", type: "platform", icon: "shield" },
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": { name: "Apple Touch ID / Face ID", type: "biometric", icon: "shield" },
  
  // Google Password Manager / Chrome
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": { name: "Google Password Manager", type: "platform", icon: "phone" },
  
  // Windows Hello
  "08987058-cadc-4b81-b6e3-ac5823032700": { name: "Windows Hello TPM", type: "biometric", icon: "laptop" },
  "9f76d16d-4b14-411a-ba62-a5d6a89c91d8": { name: "Windows Hello PIN / Biometrics", type: "biometric", icon: "laptop" },

  // Yubico
  "ee882879-721c-4916-1b03-115b6001ee2c": { name: "YubiKey 5 Series NFC", type: "hardware_key", icon: "key" },
  "cb69481e-8ff7-4039-93ec-0a2729a154a8": { name: "YubiKey 5C NFC", type: "hardware_key", icon: "key" },
  "fa2b99dc-9e39-4257-8f92-4a30d23c4118": { name: "YubiKey 5Ci", type: "hardware_key", icon: "key" },
  "2fc0579f-8113-47ea-b116-bb5a8db9202a": { name: "YubiKey Bio", type: "hardware_key", icon: "key" },
  "d8522d9f-575b-4866-88a9-bc99460f2165": { name: "YubiKey 5 Series", type: "hardware_key", icon: "key" },

  // Feitian / Titan
  "149a4d8d-2936-4190-8800-482a0b3884ff": { name: "Google Titan Security Key", type: "hardware_key", icon: "key" },
};

export const DEVICE_NICKNAME_PRESETS = [
  { label: "Work MacBook", icon: "laptop", category: "work" },
  { label: "Personal iPhone", icon: "phone", category: "mobile" },
  { label: "Office Windows PC", icon: "desktop", category: "work" },
  { label: "Backup YubiKey", icon: "key", category: "hardware" },
  { label: "Home iPad / Tablet", icon: "tablet", category: "mobile" },
  { label: "Pixel Phone", icon: "phone", category: "mobile" },
  { label: "Primary Security Key", icon: "key", category: "hardware" },
  { label: "Travel Laptop", icon: "laptop", category: "work" },
];

/**
 * Parses user agent, transports, and AAGUID to synthesize smart device metadata & friendly nicknames.
 */
export function detectDeviceDetails(
  userAgent?: string,
  transports: string[] = [],
  aaguid?: string | null,
): DeviceInfo {
  const ua = userAgent || (typeof navigator !== "undefined" ? navigator.userAgent : "");

  // Check AAGUID first for direct hardware/authenticator identification
  if (aaguid && COMMON_AAGUIDS[aaguid.toLowerCase()]) {
    const known = COMMON_AAGUIDS[aaguid.toLowerCase()];
    return {
      platform: "Hardware Authenticator",
      browser: "FIDO2",
      authenticatorType: known.type,
      authenticatorName: known.name,
      iconType: known.icon,
      suggestedNickname: known.name,
    };
  }

  // Detect Platform
  let platform = "Unknown Device";
  let iconType: DeviceInfo["iconType"] = "shield";
  let authenticatorName = "Passkey";
  let authenticatorType: DeviceInfo["authenticatorType"] = "platform";

  if (/iPhone/i.test(ua)) {
    platform = "iPhone";
    iconType = "phone";
    authenticatorName = "Face ID / Touch ID";
    authenticatorType = "biometric";
  } else if (/iPad/i.test(ua)) {
    platform = "iPad";
    iconType = "tablet";
    authenticatorName = "Face ID / Touch ID";
    authenticatorType = "biometric";
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    platform = "MacBook / Mac";
    iconType = "laptop";
    authenticatorName = "Touch ID";
    authenticatorType = "biometric";
  } else if (/Windows/i.test(ua)) {
    platform = "Windows PC";
    iconType = "laptop";
    authenticatorName = "Windows Hello";
    authenticatorType = "biometric";
  } else if (/Android/i.test(ua)) {
    platform = "Android Device";
    iconType = "phone";
    authenticatorName = "Fingerprint / Screen Lock";
    authenticatorType = "biometric";
  } else if (/Linux/i.test(ua)) {
    platform = "Linux System";
    iconType = "desktop";
    authenticatorName = "Security Key / Token";
    authenticatorType = "platform";
  }

  // Detect Browser
  let browser = "Browser";
  if (/Edg/i.test(ua)) {
    browser = "Edge";
  } else if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) {
    browser = "Chrome";
  } else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) {
    browser = "Safari";
  } else if (/Firefox/i.test(ua)) {
    browser = "Firefox";
  } else if (/Brave/i.test(ua)) {
    browser = "Brave";
  }

  // Transports check (USB / NFC / BLE implies hardware key)
  if (transports.includes("usb") || transports.includes("nfc")) {
    authenticatorType = "hardware_key";
    authenticatorName = "Hardware Security Key";
    iconType = "key";
  }

  const suggestedNickname = `${platform} (${authenticatorName})`;

  return {
    platform,
    browser,
    authenticatorType,
    authenticatorName,
    iconType,
    suggestedNickname,
  };
}

/**
 * Infers a friendly, concise device nickname based on User-Agent, transports, and AAGUID.
 * Examples: "MacBook Pro Touch ID", "iPhone Passkey", "Windows Hello Passkey".
 */
export function inferDeviceNickname(
  userAgent?: string,
  transports: string[] = [],
  aaguid?: string | null,
): string {
  const ua = userAgent || (typeof navigator !== "undefined" ? navigator.userAgent : "");

  if (aaguid && COMMON_AAGUIDS[aaguid.toLowerCase()]) {
    return COMMON_AAGUIDS[aaguid.toLowerCase()].name;
  }

  if (transports.includes("usb") || transports.includes("nfc")) {
    return "YubiKey / Security Key";
  }

  if (/iPhone/i.test(ua)) {
    return "iPhone Passkey";
  }
  if (/iPad/i.test(ua)) {
    return "iPad Passkey";
  }
  if (/Macintosh|Mac OS X/i.test(ua)) {
    return /Pro/i.test(ua) ? "MacBook Pro Touch ID" : "MacBook Touch ID";
  }
  if (/Windows/i.test(ua)) {
    return "Windows Hello Passkey";
  }
  if (/Android/i.test(ua)) {
    return "Android Biometric Passkey";
  }
  if (/Linux/i.test(ua)) {
    return "Linux Security Key";
  }

  return "Biometric Passkey";
}
