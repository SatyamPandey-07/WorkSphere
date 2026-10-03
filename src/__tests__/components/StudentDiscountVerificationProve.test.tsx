/**
 * StudentDiscountVerification must send zkpWorker a `type: "prove"` message
 * (the worker ignores anything else), and should reuse a cached proof (#3358).
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { StudentDiscountVerification } from "@/components/student/StudentDiscountVerification";
import { computeMembershipCommit } from "@/lib/zkp/commitment";
import { storeProof, _resetProofCacheForTesting } from "@/lib/zkp/proofCache";

const posted: Array<Record<string, unknown>> = [];

class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage(msg: Record<string, unknown>) {
    posted.push(msg);
  }
  terminate() {}
}

const fetchMock = jest.fn(async (url: string) =>
  url === "/zkp/verification_key.json"
    ? new Response('{"protocol":"groth16"}', { status: 200 })
    : new Response(JSON.stringify({ verified: true }), { status: 200 }),
);

beforeEach(async () => {
  posted.length = 0;
  fetchMock.mockClear();
  localStorage.clear();
  await _resetProofCacheForTesting();
  globalThis.indexedDB = new IDBFactory();
  (globalThis as unknown as { Worker: unknown }).Worker = FakeWorker;
  global.fetch = fetchMock as unknown as typeof fetch;
});

function submit(studentId: string) {
  render(<StudentDiscountVerification />);
  fireEvent.change(screen.getByLabelText(/numeric student id/i), { target: { value: studentId } });
  fireEvent.click(screen.getByRole("button", { name: /verify/i }));
}

it("asks the worker to prove with type 'prove'", async () => {
  submit("12345678");
  await waitFor(() => expect(posted).toHaveLength(1));
  expect(posted[0]).toMatchObject({
    type: "prove",
    identityToken: "12345678",
    expectedCommit: computeMembershipCommit(BigInt(12345678)),
  });
});

it("re-submits a cached proof instead of proving again", async () => {
  const commit = computeMembershipCommit(BigInt(12345678));
  await storeProof("student-discount", commit, {
    proof: { pi_a: ["1"], pi_b: [["1"]], pi_c: ["1"] },
    publicSignals: [commit],
  });

  submit("12345678");
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith("/api/user/verify-student", expect.anything()),
  );
  expect(posted).toHaveLength(0);
  await screen.findByText(/student status verified/i);
});
