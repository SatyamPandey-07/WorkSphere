interface PdfVerifyModule {
  verifyPdfSignature: (
    pdfBytes: Uint8Array,
    cmsBlob: Uint8Array,
    offset1: number,
    length1: number,
    offset2: number,
    length2: number,
    caRootsPem: string,
  ) => {
    valid: boolean;
    signerName: string;
    signingTime: string;
    algorithm: string;
    error: string;
  };
}

let cachedModule: PdfVerifyModule | null = null;
let loadingPromise: Promise<PdfVerifyModule> | null = null;

export async function loadPdfVerifyModule(): Promise<PdfVerifyModule> {
  if (cachedModule) return cachedModule;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const factoryModule = await import(
        /* webpackIgnore: true */ "/pdf-verify.js" as any
      );
      const factory = factoryModule.default || factoryModule;

      const pdfVerify = await factory({
        locateFile: (path: string) => {
          if (path.endsWith(".wasm")) {
            return "/pdf-verify.wasm";
          }
          return path;
        },
        print: (text: string) => console.log("[pdf-verify]", text),
        printErr: (text: string) => console.error("[pdf-verify]", text),
      });

      cachedModule = pdfVerify;
      return pdfVerify;
    } catch (err) {
      loadingPromise = null;
      throw new Error(
        `Failed to load PDF verification WASM module: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  })();

  return loadingPromise;
}

export function resetModuleCache(): void {
  cachedModule = null;
  loadingPromise = null;
}
