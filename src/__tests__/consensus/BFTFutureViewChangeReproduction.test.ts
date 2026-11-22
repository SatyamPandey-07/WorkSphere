import {
  BFTConsensusCoordinator,
  ViewChangeMessage,
} from "../../core/consensus/BFTConsensusCoordinator";

const validators = ["node-0", "node-1", "node-2", "node-3"];

function vcMsg(from: string, newView: number): ViewChangeMessage {
  return { fromNodeId: from, newView, signature: "sig", timestamp: Date.now() };
}

describe("Issue #8905 - Future View-Change Message Buffering & Out-of-Order Livelock Prevention", () => {
  it("1. Original livelock reproduction: future-view messages arrive before preceding-view quorum and auto-transition upon eligibility", () => {
    const c = new BFTConsensusCoordinator({ nodeId: "node-0", validators });
    expect(c.getCurrentView()).toBe(0);

    // Node is at view 0.
    // Future-view messages for View 2 arrive from node-1, node-2, node-3 (quorum = 3)
    expect(c.handleViewChange(vcMsg("node-1", 2))).toBeNull();
    expect(c.handleViewChange(vcMsg("node-2", 2))).toBeNull();
    expect(c.handleViewChange(vcMsg("node-3", 2))).toBeNull();

    // Still at view 0 because view 2 is not yet eligible (view 1 must be active first)
    expect(c.getCurrentView()).toBe(0);

    // Preceding-view messages for View 1 arrive:
    expect(c.handleViewChange(vcMsg("node-1", 1))).toBeNull();
    expect(c.handleViewChange(vcMsg("node-2", 1))).toBeNull();

    // When 3rd message for View 1 arrives:
    // View 1 reaches quorum, transitions to View 1.
    // Upon advancing to View 1, the buffered View 2 messages become eligible and are automatically drained!
    // Coordinator transitions to View 2 without any extra network packets!
    const transition = c.handleViewChange(vcMsg("node-3", 1));
    expect(transition).toEqual({
      newLeader: "node-2",
      view: 2,
    });
    expect(c.getCurrentView()).toBe(2);
    expect(c.getCurrentLeader()).toBe("node-2");
  });

  it("2. Future-view retention: valid future-view messages are retained in buffer instead of being dropped", () => {
    const c = new BFTConsensusCoordinator({ nodeId: "node-0", validators });
    expect(c.handleViewChange(vcMsg("node-1", 3))).toBeNull();
    expect(c.handleViewChange(vcMsg("node-2", 3))).toBeNull();

    // Buffer retains them: when views 1 and 2 advance, view 3 is preserved
    c.handleViewChange(vcMsg("node-1", 1));
    c.handleViewChange(vcMsg("node-2", 1));
    c.handleViewChange(vcMsg("node-3", 1));
    expect(c.getCurrentView()).toBe(1);

    c.handleViewChange(vcMsg("node-1", 2));
    c.handleViewChange(vcMsg("node-2", 2));
    c.handleViewChange(vcMsg("node-3", 2));
    expect(c.getCurrentView()).toBe(2);

    // 3rd message for view 3 arrives now that view 2 is active
    const t3 = c.handleViewChange(vcMsg("node-3", 3));
    expect(t3?.view).toBe(3);
    expect(c.getCurrentView()).toBe(3);
  });

  it("3. Multiple future views: messages for views 3, 2, and 1 arrive in completely reversed order", () => {
    const c = new BFTConsensusCoordinator({ nodeId: "node-0", validators });

    // Deliver View 3 quorum
    c.handleViewChange(vcMsg("node-1", 3));
    c.handleViewChange(vcMsg("node-2", 3));
    c.handleViewChange(vcMsg("node-3", 3));
    expect(c.getCurrentView()).toBe(0);

    // Deliver View 2 quorum
    c.handleViewChange(vcMsg("node-1", 2));
    c.handleViewChange(vcMsg("node-2", 2));
    c.handleViewChange(vcMsg("node-3", 2));
    expect(c.getCurrentView()).toBe(0);

    // Deliver View 1 quorum -> cascades from 0 to 1, then to 2, then to 3!
    c.handleViewChange(vcMsg("node-1", 1));
    c.handleViewChange(vcMsg("node-2", 1));
    const cascaded = c.handleViewChange(vcMsg("node-3", 1));

    expect(cascaded?.view).toBe(3);
    expect(c.getCurrentView()).toBe(3);
    expect(c.getCurrentLeader()).toBe("node-3");
  });

  it("4. Duplicate messages: repeated messages from one validator never inflate quorum", () => {
    const c = new BFTConsensusCoordinator({ nodeId: "node-0", validators });

    // Send 5 messages for view 2 from the same validator node-1
    for (let i = 0; i < 5; i++) {
      expect(c.handleViewChange(vcMsg("node-1", 2))).toBeNull();
    }

    // Deliver view 1 quorum
    c.handleViewChange(vcMsg("node-1", 1));
    c.handleViewChange(vcMsg("node-2", 1));
    const t1 = c.handleViewChange(vcMsg("node-3", 1));

    // Advanced to 1, but View 2 only has 1 unique validator (node-1), so it CANNOT advance to 2!
    expect(t1?.view).toBe(1);
    expect(c.getCurrentView()).toBe(1);
  });

  it("5. Unauthorized validators: invalid validator identities cannot enter the buffer or trigger transitions", () => {
    const c = new BFTConsensusCoordinator({ nodeId: "node-0", validators });

    expect(c.handleViewChange(vcMsg("malicious-attacker", 2))).toBeNull();
    expect(c.handleViewChange(vcMsg("unknown-node", 1))).toBeNull();

    // Deliver valid view 1 messages
    c.handleViewChange(vcMsg("node-1", 1));
    c.handleViewChange(vcMsg("node-2", 1));
    const t1 = c.handleViewChange(vcMsg("node-3", 1));
    expect(t1?.view).toBe(1);
    expect(c.getCurrentView()).toBe(1);
  });

  it("6. Stale messages: old messages cannot regress coordinator state", () => {
    const c = new BFTConsensusCoordinator({ nodeId: "node-0", validators });

    // Advance to view 1
    c.handleViewChange(vcMsg("node-1", 1));
    c.handleViewChange(vcMsg("node-2", 1));
    c.handleViewChange(vcMsg("node-3", 1));
    expect(c.getCurrentView()).toBe(1);

    // Stale messages for view 0 or 1
    expect(c.handleViewChange(vcMsg("node-1", 0))).toBeNull();
    expect(c.handleViewChange(vcMsg("node-1", 1))).toBeNull();
    expect(c.getCurrentView()).toBe(1);
  });

  it("7. Buffer limits: excessive future views beyond maxFutureViewWindow are discarded", () => {
    const c = new BFTConsensusCoordinator({
      nodeId: "node-0",
      validators,
      maxFutureViewWindow: 3,
    });
    expect(c.maxFutureViewWindow).toBe(3);

    // Messages for view 5 (> 0 + 3) are rejected
    expect(c.handleViewChange(vcMsg("node-1", 5))).toBeNull();
    expect(c.handleViewChange(vcMsg("node-2", 5))).toBeNull();
    expect(c.handleViewChange(vcMsg("node-3", 5))).toBeNull();

    // Advance through views 1, 2, 3, 4
    for (let v = 1; v <= 4; v++) {
      c.handleViewChange(vcMsg("node-1", v));
      c.handleViewChange(vcMsg("node-2", v));
      c.handleViewChange(vcMsg("node-3", v));
    }
    expect(c.getCurrentView()).toBe(4);

    // View 5 should not auto-advance because it was discarded when beyond window
    // Still at view 4
    expect(c.getCurrentView()).toBe(4);
  });

  it("8. Partial quorum: insufficient messages cannot cause advancement", () => {
    const c = new BFTConsensusCoordinator({ nodeId: "node-0", validators });

    // 2 of 3 messages for view 2 (partial quorum)
    c.handleViewChange(vcMsg("node-1", 2));
    c.handleViewChange(vcMsg("node-2", 2));

    // Advance to view 1
    c.handleViewChange(vcMsg("node-1", 1));
    c.handleViewChange(vcMsg("node-2", 1));
    const t1 = c.handleViewChange(vcMsg("node-3", 1));

    expect(t1?.view).toBe(1);
    expect(c.getCurrentView()).toBe(1);

    // View 2 did not have quorum (2 < 3), so remains at 1
    // Now deliver 3rd message for view 2:
    const t2 = c.handleViewChange(vcMsg("node-3", 2));
    expect(t2?.view).toBe(2);
    expect(c.getCurrentView()).toBe(2);
  });

  it("9. Cleanup: stale entries are pruned on view transition", () => {
    const c = new BFTConsensusCoordinator({ nodeId: "node-0", validators });

    // Store messages for view 1 and view 2
    c.handleViewChange(vcMsg("node-1", 1));
    c.handleViewChange(vcMsg("node-1", 2));

    // Transition to view 1
    c.handleViewChange(vcMsg("node-2", 1));
    c.handleViewChange(vcMsg("node-3", 1));
    expect(c.getCurrentView()).toBe(1);

    // Transition to view 2
    c.handleViewChange(vcMsg("node-2", 2));
    c.handleViewChange(vcMsg("node-3", 2));
    expect(c.getCurrentView()).toBe(2);

    // Stale messages for view 1 and 2 are cleaned up
    expect(c.handleViewChange(vcMsg("node-1", 1))).toBeNull();
    expect(c.handleViewChange(vcMsg("node-2", 2))).toBeNull();
  });

  it("10. Re-entrancy protection: draining buffer cannot trigger infinite loop or duplicate transitions", () => {
    const c = new BFTConsensusCoordinator({ nodeId: "node-0", validators });

    // Setup cascading transitions 1 -> 2 -> 3
    for (let v = 3; v >= 1; v--) {
      c.handleViewChange(vcMsg("node-1", v));
      c.handleViewChange(vcMsg("node-2", v));
      if (v > 1) {
        c.handleViewChange(vcMsg("node-3", v));
      }
    }

    const t = c.handleViewChange(vcMsg("node-3", 1));
    expect(t?.view).toBe(3);
    expect(c.getCurrentView()).toBe(3);
  });
});
