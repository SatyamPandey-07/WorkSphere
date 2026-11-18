import { MeshConnection } from "@/lib/webrtc/meshConnection";

describe("ICE Candidate Buffer Test", () => {
  let meshConn: MeshConnection;

  beforeEach(() => {
    meshConn = new MeshConnection();
  });

  afterEach(() => {
    meshConn.peerConnection.close();
  });

  it("queues candidates when remoteDescription is null", async () => {
    const candidate: RTCIceCandidateInit = {
      candidate: "candidate:1 1 UDP 2013266431 192.168.1.1 54321 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
    };

    await meshConn.addIceCandidate(candidate);
    expect(meshConn.getPendingCandidatesCount()).toBe(1);
  });

  it("flushes queued candidates sequentially when setRemoteDescription resolves", async () => {
    const candidate1: RTCIceCandidateInit = {
      candidate: "candidate:1 1 UDP 2013266431 192.168.1.1 54321 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
    };
    const candidate2: RTCIceCandidateInit = {
      candidate: "candidate:2 1 UDP 2013266431 192.168.1.2 54322 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
    };

    // Buffer incoming candidates before remote description is set
    await meshConn.addIceCandidate(candidate1);
    await meshConn.addIceCandidate(candidate2);
    expect(meshConn.getPendingCandidatesCount()).toBe(2);

    // Mock setRemoteDescription and addIceCandidate behavior on RTCPeerConnection
    const mockOffer: RTCSessionDescriptionInit = {
      type: "offer",
      sdp: "v=0...",
    };
    jest
      .spyOn(meshConn.peerConnection, "setRemoteDescription")
      .mockResolvedValue(undefined);
    jest
      .spyOn(meshConn.peerConnection, "addIceCandidate")
      .mockResolvedValue(undefined);

    // Act
    await meshConn.setRemoteDescription(mockOffer);

    // Assert
    expect(meshConn.getPendingCandidatesCount()).toBe(0);
    expect(meshConn.peerConnection.addIceCandidate).toHaveBeenCalledTimes(2);
  });
});
