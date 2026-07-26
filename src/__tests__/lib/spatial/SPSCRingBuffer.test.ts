/**
 * @jest-environment node
 */
import { SPSCRingBuffer } from "@/lib/spatial/SPSCRingBuffer";

describe("SPSCRingBuffer", () => {
  it("requires capacity to be a power of 2", () => {
    expect(() => new SPSCRingBuffer(100)).toThrow(/power of 2/);
    expect(() => new SPSCRingBuffer(1024)).not.toThrow();
  });

  it("handles push and pop operations correctly", () => {
    const buffer = new SPSCRingBuffer(1024);
    expect(buffer.availableRead()).toBe(0);
    expect(buffer.availableWrite()).toBe(1024);
    expect(buffer.fillLevel()).toBe(0);

    const dataToPush = new Float32Array([1.0, 2.0, 3.0, 4.0]);
    const pushed = buffer.push(dataToPush);
    expect(pushed).toBe(4);
    expect(buffer.availableRead()).toBe(4);
    expect(buffer.availableWrite()).toBe(1020);
    expect(buffer.fillLevel()).toBe(4 / 1024);

    const output = new Float32Array(4);
    const popped = buffer.pop(output);
    expect(popped).toBe(4);
    expect(output).toEqual(new Float32Array([1.0, 2.0, 3.0, 4.0]));
    expect(buffer.availableRead()).toBe(0);
  });

  it("handles buffer wrap-around properly", () => {
    const buffer = new SPSCRingBuffer(4);
    // Fill buffer
    buffer.push(new Float32Array([1, 2, 3]));
    buffer.pop(new Float32Array(3));
    // Now write index is 3, read index is 3.

    // Push 3 more. Should wrap around.
    const pushed = buffer.push(new Float32Array([4, 5, 6]));
    expect(pushed).toBe(3);

    const output = new Float32Array(3);
    const popped = buffer.pop(output);
    expect(popped).toBe(3);
    expect(output).toEqual(new Float32Array([4, 5, 6]));
  });

  it("handles heavy simulated audio load", () => {
    const buffer = new SPSCRingBuffer(2048);
    const pushSize = 128;
    const popSize = 128;
    const iterations = 1000;

    const testData = new Float32Array(pushSize);
    for (let i = 0; i < pushSize; i++) {
      testData[i] = Math.random();
    }

    const output = new Float32Array(popSize);
    let totalPushed = 0;
    let totalPopped = 0;

    for (let i = 0; i < iterations; i++) {
      // Simulate pushing data
      totalPushed += buffer.push(testData);

      // Simulate popping data
      const popped = buffer.pop(output);
      totalPopped += popped;
      if (popped > 0) {
        expect(output).toEqual(testData);
      }
    }

    expect(totalPushed).toBe(iterations * pushSize);
    expect(totalPopped).toBe(iterations * popSize);
    expect(buffer.availableRead()).toBe(0);
  });

  it("respects capacity limits", () => {
    const buffer = new SPSCRingBuffer(8);
    const pushed = buffer.push(
      new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
    );
    expect(pushed).toBe(8); // Can only write up to capacity
    expect(buffer.availableWrite()).toBe(0);
  });

  it("peeks without consuming data", () => {
    const buffer = new SPSCRingBuffer(16);
    buffer.push(new Float32Array([10, 20, 30]));

    const peeked = buffer.peek(2);
    expect(peeked).toEqual(new Float32Array([10, 20]));
    expect(buffer.availableRead()).toBe(3); // Still 3 available

    const nullPeek = buffer.peek(4);
    expect(nullPeek).toBeNull(); // Not enough data
  });
});
