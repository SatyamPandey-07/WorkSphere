import * as readline from "readline";

async function verifyBiometricCommit(): Promise<boolean> {
  console.log("?? [WorkSphere Security] Biometric verification required for commit...");

  try {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const confirmed = await new Promise<boolean>((resolve) => {
      rl.question("?? Scan fingerprint or press Enter to authorize biometric commit signature: ", () => {
        rl.close();
        resolve(true);
      });
    });

    if (confirmed) {
      console.log("? Biometric signature verified successfully.");
      return true;
    }
    return false;
  } catch (error) {
    console.error("? Biometric authentication failed or was cancelled:", error);
    return false;
  }
}

(async () => {
  const authorized = await verifyBiometricCommit();
  if (!authorized) {
    console.error("?? Commit aborted: Biometric verification failed.");
    process.exit(1);
  }
  process.exit(0);
})();
