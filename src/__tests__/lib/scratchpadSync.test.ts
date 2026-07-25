import * as Y from "yjs";
import { CryptoManager } from "@/lib/e2ee/CryptoManager";

describe("Yjs CRDT Document Reconnection & Delta Sync (#1428)", () => {
  it("reconciles state drift after connection drop using state vectors and Y.applyUpdate", async () => {
    // Initialize Doc A and Doc B
    const docA = new Y.Doc();
    const textA = docA.getText("scratchpad");

    const docB = new Y.Doc();
    const textB = docB.getText("scratchpad");

    // Initial synchronized state
    docA.transact(() => {
      textA.insert(0, "Hello World!");
    });
    const initialUpdate = Y.encodeStateAsUpdate(docA);
    Y.applyUpdate(docB, initialUpdate);

    expect(textA.toString()).toBe("Hello World!");
    expect(textB.toString()).toBe("Hello World!");

    // Simulate sleep mode / network disconnection: both clients make offline edits
    docA.transact(() => {
      textA.insert(12, " Client A edit.");
    });

    docB.transact(() => {
      textB.insert(0, "Header: ");
    });

    // Before sync, docs have drifted
    expect(textA.toString()).toBe("Hello World! Client A edit.");
    expect(textB.toString()).toBe("Header: Hello World!");

    // Reconnection trigger: Device A wakes up and sends its state vector to Device B
    const vectorA = Y.encodeStateVector(docA);

    // Device B receives vectorA and calculates the missing delta for Device A
    const deltaForA = Y.encodeStateAsUpdate(docB, vectorA);

    // Device A applies the delta from Device B
    Y.applyUpdate(docA, deltaForA);

    // Device B sends its state vector to Device A
    const vectorB = Y.encodeStateVector(docB);
    const deltaForB = Y.encodeStateAsUpdate(docA, vectorB);
    Y.applyUpdate(docB, deltaForB);

    // Assert that both CRDT docs converge losslessly to the exact same text
    expect(textA.toString()).toBe(textB.toString());
    expect(textA.toString()).toBe("Header: Hello World! Client A edit.");

    docA.destroy();
    docB.destroy();
  });

  it("encrypts and decrypts state vectors and deltas over simulated E2EE channel", async () => {
    const rawKey = window.crypto.getRandomValues(new Uint8Array(32));
    const cryptoKey = await window.crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );

    const docLocal = new Y.Doc();
    const textLocal = docLocal.getText("scratchpad");
    docLocal.transact(() => {
      textLocal.insert(0, "Encrypted CRDT Sync");
    });

    // Encode and encrypt state vector
    const vector = Y.encodeStateVector(docLocal);
    const encryptedVector = await CryptoManager.encryptPayload(
      cryptoKey,
      vector,
    );

    // Decrypt state vector
    const decryptedVector = await CryptoManager.decryptPayload(
      cryptoKey,
      encryptedVector.ciphertext,
      encryptedVector.iv,
    );

    expect(decryptedVector).toEqual(vector);

    docLocal.destroy();
  });
});
