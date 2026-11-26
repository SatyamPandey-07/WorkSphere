import {
  HashedTimingWheel,
  seatHoldTimingWheel,
  resetMemorySeatLocks,
} from "@/lib/locks/seatHoldLock";

describe("HashedTimingWheel - Slot Wrap-Around Fix (#10455)", () => {
  let wheel: HashedTimingWheel;

  beforeEach(() => {
    // 10 slots with 100ms tick duration -> 1 full wheel revolution = 1000ms (10 ticks)
    wheel = new HashedTimingWheel({
      wheelSize: 10,
      tickDurationMs: 100,
    });
  });

  afterEach(() => {
    wheel.reset();
  });

  describe("1. Delays Below, Equal To, and Above Wheel Size", () => {
    it("executes tasks with delay below wheel size after the exact number of ticks", () => {
      const cb = jest.fn();
      // 3 ticks (300ms) < 1000ms wheelSize
      const task = wheel.schedule("task-short", 300, cb);
      expect(task.slotIndex).toBe(3);
      expect(task.remainingRotations).toBe(0);

      // Advance 2 ticks -> not executed yet
      wheel.advanceTick();
      wheel.advanceTick();
      expect(cb).not.toHaveBeenCalled();

      // Advance 3rd tick -> executes
      const executed = wheel.advanceTick();
      expect(cb).toHaveBeenCalledTimes(1);
      expect(executed).toHaveLength(1);
      expect(executed[0].id).toBe("task-short");
    });

    it("executes tasks with delay equal to wheel size on the second pass over the slot", () => {
      const cb = jest.fn();
      // 10 ticks (1000ms) = exactly 1 wheel size
      // At tick 0, currentSlot is 0. Target tick is 10.
      // slotIndex = 10 % 10 = 0.
      // remainingRotations should be 0 because it fires the very next time slot 0 is reached (at tick 10)
      const task = wheel.schedule("task-equal-wheel", 1000, cb);
      expect(task.slotIndex).toBe(0);
      expect(task.remainingRotations).toBe(0);

      // Advance 9 ticks (slots 1 to 9) -> cb not called
      for (let i = 0; i < 9; i++) {
        wheel.advanceTick();
      }
      expect(cb).not.toHaveBeenCalled();

      // 10th tick -> arrives back at slot 0 and fires!
      wheel.advanceTick();
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("does NOT prematurely execute tasks with delay above wheel size during earlier revolutions", () => {
      const cb = jest.fn();
      // 13 ticks (1300ms) -> 1 full revolution (10 ticks) + 3 ticks
      // Target slot is (0 + 13) % 10 = 3.
      // At tick 3, slot 3 is visited, but only 3 ticks elapsed (not 13).
      // Task must NOT execute on tick 3! It should execute on tick 13.
      const task = wheel.schedule("task-long", 1300, cb);
      expect(task.slotIndex).toBe(3);
      expect(task.remainingRotations).toBe(1);

      // Advance to tick 3 (first pass over slot 3)
      for (let i = 0; i < 3; i++) {
        wheel.advanceTick();
      }
      expect(wheel.getCurrentSlot()).toBe(3);
      expect(wheel.getCurrentTick()).toBe(3);
      // Must NOT execute on first revolution pass
      expect(cb).not.toHaveBeenCalled();
      // remainingRotations should have decremented from 1 to 0
      expect(task.remainingRotations).toBe(0);

      // Advance through remainder of revolution 1 and into revolution 2 (ticks 4 to 12)
      for (let i = 4; i <= 12; i++) {
        wheel.advanceTick();
      }
      expect(cb).not.toHaveBeenCalled();

      // Tick 13 arrives at slot 3 again -> now fires!
      const executed = wheel.advanceTick();
      expect(cb).toHaveBeenCalledTimes(1);
      expect(executed).toHaveLength(1);
      expect(executed[0].id).toBe("task-long");
    });
  });

  describe("2. Multiple Complete Wheel Revolutions", () => {
    it("handles delays spanning multiple complete wheel revolutions", () => {
      const cb = jest.fn();
      // 35 ticks (3500ms) with wheelSize 10 -> 3 full revolutions + 5 ticks
      // Target tick = 35, slotIndex = 5, remainingRotations = 3
      const task = wheel.schedule("task-multi-rev", 3500, cb);
      expect(task.slotIndex).toBe(5);
      expect(task.remainingRotations).toBe(3);

      // Run 34 ticks
      for (let t = 1; t <= 34; t++) {
        wheel.advanceTick();
        expect(cb).not.toHaveBeenCalled();
      }

      // Tick 35 -> executes
      wheel.advanceTick();
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("prevents duplicate execution when slot is revisited after task completion", () => {
      const cb = jest.fn();
      wheel.schedule("task-no-dupe", 200, cb); // 2 ticks

      wheel.advanceTick();
      wheel.advanceTick();
      expect(cb).toHaveBeenCalledTimes(1);

      // Continue running for another 20 ticks (2 full revolutions)
      for (let t = 0; t < 20; t++) {
        wheel.advanceTick();
      }

      // Must remain called exactly once
      expect(cb).toHaveBeenCalledTimes(1);
      expect(wheel.getTask("task-no-dupe")).toBeUndefined();
    });
  });

  describe("3. Coalesced Tick Advancement (#10441)", () => {
    it("fires simultaneous expirations once in insertion order", () => {
      const order: string[] = [];
      const first = jest.fn(() => order.push("first"));
      const second = jest.fn(() => order.push("second"));
      const third = jest.fn(() => order.push("third"));

      wheel.schedule("same-tick-1", 300, first);
      wheel.schedule("same-tick-2", 300, second);
      wheel.schedule("same-tick-3", 300, third);

      const fired = wheel.advanceTicks(3);

      expect(fired.map((task) => task.id)).toEqual([
        "same-tick-1",
        "same-tick-2",
        "same-tick-3",
      ]);
      expect(order).toEqual(["first", "second", "third"]);
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
      expect(third).toHaveBeenCalledTimes(1);
    });

    it("coalesces a burst across consecutive ticks in deadline order", () => {
      const order: string[] = [];
      const late = jest.fn(() => order.push("late"));
      const early = jest.fn(() => order.push("early"));
      const middle = jest.fn(() => order.push("middle"));

      wheel.schedule("late", 300, late);
      wheel.schedule("early", 100, early);
      wheel.schedule("middle", 200, middle);

      const fired = wheel.advanceTicks(3);

      expect(fired.map((task) => task.id)).toEqual(["early", "middle", "late"]);
      expect(order).toEqual(["early", "middle", "late"]);
      expect(wheel.getCurrentTick()).toBe(3);
    });

    it("catches up delayed timer ticks with one batch and does not repeat expirations", () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date(0));
      const intervalSpy = jest.spyOn(global, "setInterval");
      const callbacks = [jest.fn(), jest.fn(), jest.fn()];
      wheel.schedule("delayed-1", 100, callbacks[0]);
      wheel.schedule("delayed-2", 200, callbacks[1]);
      wheel.schedule("delayed-3", 300, callbacks[2]);
      wheel.start();

      const timerCallback = intervalSpy.mock.calls[0]?.[0];
      expect(typeof timerCallback).toBe("function");
      const advanceTicksSpy = jest.spyOn(wheel, "advanceTicks");

      try {
        jest.setSystemTime(new Date(350));
        if (typeof timerCallback === "function") timerCallback();

        expect(advanceTicksSpy).toHaveBeenCalledTimes(1);
        expect(advanceTicksSpy).toHaveBeenCalledWith(3);
        expect(wheel.getCurrentTick()).toBe(3);
        callbacks.forEach((callback) =>
          expect(callback).toHaveBeenCalledTimes(1),
        );

        if (typeof timerCallback === "function") timerCallback();
        expect(wheel.getCurrentTick()).toBe(3);
        callbacks.forEach((callback) =>
          expect(callback).toHaveBeenCalledTimes(1),
        );
      } finally {
        wheel.reset();
        intervalSpy.mockRestore();
        jest.useRealTimers();
      }
    });

    it("handles empty and invalid batches without skipping future expirations", () => {
      const callback = jest.fn();
      wheel.schedule("future", 1300, callback);

      expect(wheel.advanceTicks(0)).toEqual([]);
      expect(wheel.advanceTicks(Number.NaN)).toEqual([]);
      expect(wheel.getCurrentTick()).toBe(0);

      expect(wheel.advanceTicks(3)).toEqual([]);
      expect(wheel.getCurrentTick()).toBe(3);
      expect(wheel.getTask("future")?.remainingRotations).toBe(0);

      expect(wheel.advanceTicks(10)).toHaveLength(1);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(wheel.advanceTicks(20)).toEqual([]);
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe("4. Cancellation, Rescheduling, and Zero-Delay", () => {
    it("executes zero-delay tasks immediately without waiting for a tick", () => {
      const cb = jest.fn();
      const task = wheel.schedule("task-zero", 0, cb);

      expect(cb).toHaveBeenCalledTimes(1);
      expect(task.executed).toBe(true);

      // Advancing ticks doesn't re-execute
      wheel.advanceTick();
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it("cancels a scheduled task before its execution tick", () => {
      const cb = jest.fn();
      wheel.schedule("task-cancel", 500, cb); // 5 ticks

      wheel.advanceTick();
      wheel.advanceTick();

      const cancelled = wheel.cancel("task-cancel");
      expect(cancelled).toBe(true);
      expect(wheel.getTask("task-cancel")).toBeUndefined();

      // Advance through remainder of delay and beyond
      for (let i = 0; i < 10; i++) {
        wheel.advanceTick();
      }
      expect(cb).not.toHaveBeenCalled();
    });

    it("reschedules a task with an updated delay", () => {
      const cb1 = jest.fn();
      const cb2 = jest.fn();

      wheel.schedule("task-resched", 200, cb1); // 2 ticks
      wheel.reschedule("task-resched", 500, cb2); // updated to 5 ticks

      wheel.advanceTick();
      wheel.advanceTick();
      // Original 2-tick callback must not have fired
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).not.toHaveBeenCalled();

      // Advance 3 more ticks (total 5)
      wheel.advanceTick();
      wheel.advanceTick();
      wheel.advanceTick();

      expect(cb2).toHaveBeenCalledTimes(1);
      expect(cb1).not.toHaveBeenCalled();
    });
  });

  describe("5. Singleton and Reset Isolation", () => {
    it("exports singleton seatHoldTimingWheel instance", () => {
      expect(seatHoldTimingWheel).toBeInstanceOf(HashedTimingWheel);
      expect(seatHoldTimingWheel.wheelSize).toBe(60);
      expect(seatHoldTimingWheel.tickDurationMs).toBe(1000);
    });

    it("clears timing wheel tasks when resetMemorySeatLocks is invoked", () => {
      const cb = jest.fn();
      seatHoldTimingWheel.schedule("lock-1", 5000, cb);
      expect(seatHoldTimingWheel.getTaskCount()).toBe(1);

      resetMemorySeatLocks();
      expect(seatHoldTimingWheel.getTaskCount()).toBe(0);
      expect(seatHoldTimingWheel.getCurrentSlot()).toBe(0);
    });
  });
});
