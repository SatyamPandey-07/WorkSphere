import {
  GossipSubPeerScore,
  type PeerDisposition,
  type PeerScoreConfig,
} from './GossipSubPeerScore';

export interface GossipMessage {
  id: string;
  topic: string;
  fromPeerId: string;
  payload: unknown;
  valid?: boolean;
}

export interface RoutedMessageResult {
  accepted: boolean;
  disposition: PeerDisposition;
  score: number;
  priority: 'HIGH' | 'LOW' | 'DROPPED';
}

export class GossipSubRouter {
  public readonly peerScore: GossipSubPeerScore;
  private readonly lowPriorityQueue: GossipMessage[] = [];
  private readonly highPriorityQueue: GossipMessage[] = [];

  constructor(scoreConfig: PeerScoreConfig = {}) {
    this.peerScore = new GossipSubPeerScore(scoreConfig);
  }

  onPeerConnect(peerId: string, ip?: string): void {
    this.peerScore.registerPeer(peerId, ip);
  }

  onPeerDisconnect(peerId: string): void {
    this.peerScore.removePeer(peerId);
  }

  handleIncomingMessage(msg: GossipMessage): RoutedMessageResult {
    if (msg.valid === false) {
      this.peerScore.recordInvalidMessage(msg.fromPeerId);
    } else {
      this.peerScore.recordValidMessage(msg.fromPeerId);
    }

    const snapshot = this.peerScore.getScore(msg.fromPeerId);

    if (snapshot.disposition === 'PRUNED') {
      return {
        accepted: false,
        disposition: snapshot.disposition,
        score: snapshot.totalScore,
        priority: 'DROPPED',
      };
    }

    if (snapshot.disposition === 'DEPRIORITIZED') {
      this.lowPriorityQueue.push(msg);
      return {
        accepted: true,
        disposition: snapshot.disposition,
        score: snapshot.totalScore,
        priority: 'LOW',
      };
    }

    this.highPriorityQueue.push(msg);
    return {
      accepted: true,
      disposition: snapshot.disposition,
      score: snapshot.totalScore,
      priority: 'HIGH',
    };
  }

  drainNextMessage(): GossipMessage | undefined {
    if (this.highPriorityQueue.length > 0) {
      return this.highPriorityQueue.shift();
    }
    return this.lowPriorityQueue.shift();
  }
}