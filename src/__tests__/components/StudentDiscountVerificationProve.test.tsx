/**
 * StudentDiscountVerification must send zkpWorker a `type: "prove"` message
 * (the worker ignores anything else), and should reuse a cached proof (#3358).
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import React from "react";
import { jest } from "@jest/globals";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { StudentDiscountVerification } from "@/components/student/StudentDiscountVerification";
import { computeMembershipCommit } from "@/lib/zkp/commitment";
import { storeProof, _resetProofCacheForTesting } from "@/lib/zkp/proofCache";

const posted: Array<Record<string, unknown>> = [];
const workers: FakeWorker[] = [];

let terminatedCount = 0;

class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    workers.push(this);
  }
  postMessage(msg: Record<string, unknown>) {
    posted.push(msg);
  }
  emit(data: Record<string, unknown>) {
    this.onmessage?.({ data });
  }
  terminate() {
    terminatedCount++;
  }
}

jest.mock("@/components/student/createZkpWorker", () => ({
  createZkpWorker: () =>
    new (globalThis as unknown as { Worker: new () => Worker }).Worker(),
}));

const fetchMock = jest.fn(async (url: string) =>
  url === "/zkp/verification_key.json"
    ? new Response('{"protocol":"groth16"}', { status: 200 })
    : new Response(JSON.stringify({ verified: true }), { status: 200 }),
);

beforeEach(async () => {
  posted.length = 0;
  workers.length = 0;
  terminatedCount = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) =>
    url === "/zkp/verification_key.json"
      ? new Response('{"protocol":"groth16"}', { status: 200 })
      : new Response(JSON.stringify({ verified: true }), { status: 200 }),
  );
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

function currentWorker() {
  const worker = workers[workers.length - 1];
  if (!worker) throw new Error("Expected a worker instance");
  return worker;
}

it("asks the worker to prove with type 'prove'", async () => {
  submit("12345678");
  await waitFor(() => expect(posted.some((message) => message.type === "prove")).toBe(true));
  expect(posted.find((message) => message.type === "prove")).toMatchObject({
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
  expect(posted.some((message) => message.type === "prove")).toBe(false);
  await screen.findByText(/student discount unlocked/i);
});

it("aborts and terminates worker upon component unmount (#3938)", async () => {
  const { unmount } = render(<StudentDiscountVerification />);
  fireEvent.change(screen.getByLabelText(/numeric student id/i), { target: { value: "87654321" } });
  fireEvent.click(screen.getByRole("button", { name: /verify/i }));

  await waitFor(() => expect(posted.some((p) => p.type === "prove")).toBe(true));

  unmount();

  // Worker should receive abort/terminate message and terminate() should be called
  expect(posted.some((p) => p.type === "abort" || p.type === "terminate")).toBe(true);
  expect(terminatedCount).toBeGreaterThanOrEqual(1);
  expect(currentWorker().onmessage).toBeNull();
  expect(currentWorker().onerror).toBeNull();
});

it("renders accessible monotonic progress updates and phase labels from the worker", async () => {
  submit("12345678");
  await waitFor(() => expect(posted.some((message) => message.type === "prove")).toBe(true));

  const worker = currentWorker();
  act(() => worker.emit({ type: "progress", stage: "generating", phase: "witness", percent: 0 }));
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  expect(screen.getByText("Calculating witness constraints...")).toBeInTheDocument();

  act(() => worker.emit({ type: "progress", stage: "generating", phase: "proving", percent: 50 }));
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  expect(screen.getByText("Synthesizing cryptographic proof...")).toBeInTheDocument();

  act(() => worker.emit({ type: "progress", stage: "generating", phase: "finalizing", percent: 90 }));
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "90");
  expect(screen.getByText("Finalizing verification...")).toBeInTheDocument();

  act(() => worker.emit({ type: "progress", stage: "generating", phase: "witness", percent: 40 }));
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "90");
  expect(screen.getByText("Finalizing verification...")).toBeInTheDocument();
  expect(screen.getAllByRole("progressbar")).toHaveLength(1);
});

it("sets progress to 100 only after worker proof and server verification succeed", async () => {
  submit("12345678");
  await waitFor(() => expect(posted.some((message) => message.type === "prove")).toBe(true));

  const worker = currentWorker();
  act(() => worker.emit({ type: "progress", stage: "generating", phase: "finalizing", percent: 90 }));
  act(() =>
    worker.emit({
      type: "success",
      proof: { pi_a: ["1"] },
      publicSignals: ["123"],
    }),
  );
  act(() =>
    worker.emit({
      type: "success",
      proof: { pi_a: ["1"] },
      publicSignals: ["123"],
    }),
  );

  await screen.findByTestId("student-verification-success-card");
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  expect(screen.getByText("100%")).toBeInTheDocument();
  expect(
    fetchMock.mock.calls.filter(([url]) => url === "/api/user/verify-student"),
  ).toHaveLength(1);
});

it("clears progress when the server rejects the generated proof", async () => {
  fetchMock.mockImplementation(
    async (url: string) =>
      url === "/api/user/verify-student"
        ? new Response(JSON.stringify({ error: "Proof rejected" }), { status: 400 })
        : new Response('{"protocol":"groth16"}', { status: 200 }),
  );
  submit("12345678");
  await waitFor(() => expect(posted.some((message) => message.type === "prove")).toBe(true));

  const worker = currentWorker();
  act(() => worker.emit({ type: "progress", stage: "generating", phase: "finalizing", percent: 90 }));
  act(() =>
    worker.emit({
      type: "success",
      proof: { pi_a: ["1"] },
      publicSignals: ["123"],
    }),
  );

  expect(await screen.findByText("Proof rejected")).toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.queryByTestId("student-verification-success-card")).not.toBeInTheDocument();
});

it("clears progress on worker error and resets it for a new attempt", async () => {
  submit("12345678");
  await waitFor(() => expect(posted.some((message) => message.type === "prove")).toBe(true));

  act(() =>
    currentWorker().emit({
      type: "progress",
      stage: "generating",
      phase: "proving",
      percent: 50,
    }),
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");

  act(() => currentWorker().emit({ type: "error", error: "Proof generation failed" }));
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.getByText("Proof generation failed")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /verify/i }));
  await waitFor(() => expect(workers.length).toBeGreaterThan(1));
  await waitFor(() =>
    expect(posted.filter((message) => message.type === "prove")).toHaveLength(2),
  );

  act(() =>
    currentWorker().emit({
      type: "progress",
      stage: "generating",
      phase: "witness",
      percent: 0,
    }),
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
});

it("renders a cancel button during witness generation, terminates the worker, and allows retrying", async () => {
  render(<StudentDiscountVerification />);

  // Cancel button is not rendered while idle
  expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText(/numeric student id/i), {
    target: { value: "12345678" },
  });
  fireEvent.click(screen.getByRole("button", { name: /verify/i }));

  // Cancel button appears while proving is active
  const cancelButton = await screen.findByRole("button", { name: /cancel/i });
  expect(cancelButton).toBeInTheDocument();

  await waitFor(() =>
    expect(posted.some((message) => message.type === "prove")).toBe(true),
  );

  const firstWorker = currentWorker();
  act(() =>
    firstWorker.emit({
      type: "progress",
      stage: "generating",
      phase: "witness",
      percent: 25,
    }),
  );
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");

  fireEvent.click(cancelButton);

  expect(posted.some((message) => message.type === "abort")).toBe(true);
  expect(terminatedCount).toBeGreaterThanOrEqual(1);
  expect(firstWorker.onmessage).toBeNull();
  expect(firstWorker.onerror).toBeNull();
  expect(screen.queryByRole("button", { name: /cancel/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.getByTestId("student-verification-error")).toHaveTextContent(
    /cancelled/i,
  );

  // Late messages from the cancelled worker are ignored
  act(() =>
    firstWorker.emit({
      type: "success",
      proof: { pi_a: ["1"] },
      publicSignals: ["123"],
    }),
  );
  expect(screen.queryByTestId("student-verification-success-card")).not.toBeInTheDocument();

  // User can immediately start a new verification attempt
  const verifyButton = screen.getByRole("button", { name: /verify/i });
  expect(verifyButton).toBeEnabled();
  fireEvent.click(verifyButton);

  await waitFor(() => expect(workers.length).toBe(2));
  await waitFor(() =>
    expect(posted.filter((message) => message.type === "prove")).toHaveLength(2),
  );

  act(() =>
    currentWorker().emit({
      type: "success",
      proof: { pi_a: ["1"] },
      publicSignals: ["123"],
    }),
  );

  await screen.findByTestId("student-verification-success-card");
});

it("aborts in-flight server verification when cancel is clicked", async () => {
  let capturedSignal: AbortSignal | undefined;
  let resolveFetch: ((value: Response) => void) | undefined;

  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url === "/zkp/verification_key.json") {
      return Promise.resolve(
        new Response('{"protocol":"groth16"}', { status: 200 }),
      );
    }
    return new Promise<Response>((resolve) => {
      capturedSignal = init?.signal ?? undefined;
      resolveFetch = resolve;
    });
  });

  const onVerified = jest.fn();
  render(<StudentDiscountVerification onVerified={onVerified} />);
  fireEvent.change(screen.getByLabelText(/numeric student id/i), {
    target: { value: "12345678" },
  });
  fireEvent.click(screen.getByRole("button", { name: /verify/i }));

  await waitFor(() =>
    expect(posted.some((message) => message.type === "prove")).toBe(true),
  );

  act(() =>
    currentWorker().emit({
      type: "success",
      proof: { pi_a: ["1"] },
      publicSignals: ["123"],
    }),
  );

  await waitFor(() => expect(capturedSignal).toBeDefined());
  expect(capturedSignal?.aborted).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
  expect(capturedSignal?.aborted).toBe(true);

  await act(async () => {
    resolveFetch?.(
      new Response(JSON.stringify({ verified: true }), { status: 200 }),
    );
  });

  expect(onVerified).not.toHaveBeenCalled();
  expect(
    screen.queryByTestId("student-verification-success-card"),
  ).not.toBeInTheDocument();
  expect(screen.getByTestId("student-verification-error")).toHaveTextContent(
    /cancelled/i,
  );
});
