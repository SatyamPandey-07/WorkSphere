/**
 * LanguageExchangeGraph
 * Evaluates user profiles to find complementary language-learning pairs.
 * Implements a directed bipartite graph traversal for optimal matching.
 */

export interface UserLanguageProfile {
  userId: string;
  nativeLanguages: string[];
  learningLanguages: string[];
  proficiencyLevels: Record<string, number>; // 1-10 scale
  interests: string[];
  locationHash: string; // Anonymized BLE zone hash
  lastActive: number;
}

export interface MatchEdge {
  userA: string;
  userB: string;
  compatibilityScore: number;
  sharedLanguageA: string; // A's native, B's learning
  sharedLanguageB: string; // B's native, A's learning
  commonInterests: string[];
}

export class LanguageExchangeGraph {
  private nodes: Map<string, UserLanguageProfile> = new Map();
  private edges: Map<string, MatchEdge[]> = new Map();
  private readonly MAX_GRAPH_AGE_MS = 15 * 60 * 1000; // 15 minutes

  public addUser(profile: UserLanguageProfile): void {
    this.nodes.set(profile.userId, profile);
    this.cleanupStaleNodes();
    this.recalculateEdges(profile.userId);
  }

  public removeUser(userId: string): void {
    this.nodes.delete(userId);
    this.edges.delete(userId);
    
    // Clean up incoming edges
    this.edges.forEach((edgeList, key) => {
      this.edges.set(key, edgeList.filter(e => e.userA !== userId && e.userB !== userId));
    });
  }

  private cleanupStaleNodes(): void {
    const now = Date.now();
    for (const [userId, profile] of this.nodes.entries()) {
      if (now - profile.lastActive > this.MAX_GRAPH_AGE_MS) {
        this.removeUser(userId);
      }
    }
  }

  private recalculateEdges(userId: string): void {
    const user = this.nodes.get(userId);
    if (!user) return;

    const newEdges: MatchEdge[] = [];

    for (const [otherId, otherProfile] of this.nodes.entries()) {
      if (otherId === userId) continue;
      if (user.locationHash !== otherProfile.locationHash) continue; // Must be in same BLE zone

      const match = this.evaluateCompatibility(user, otherProfile);
      if (match) {
        newEdges.push(match);
      }
    }

    this.edges.set(userId, newEdges);
  }

  private evaluateCompatibility(a: UserLanguageProfile, b: UserLanguageProfile): MatchEdge | null {
    // Find languages A speaks natively that B is learning
    const aNative_bLearning = a.nativeLanguages.filter(lang => b.learningLanguages.includes(lang));
    // Find languages B speaks natively that A is learning
    const bNative_aLearning = b.nativeLanguages.filter(lang => a.learningLanguages.includes(lang));

    // Strict requirement: Must be a complementary pair
    if (aNative_bLearning.length === 0 || bNative_aLearning.length === 0) {
      return null;
    }

    const commonInterests = a.interests.filter(i => b.interests.includes(i));
    
    // Calculate compatibility score (0.0 to 1.0)
    let score = 0.5; // Base score for perfect language match
    
    // Bonus for common interests
    score += Math.min(commonInterests.length * 0.1, 0.3);
    
    // Bonus for similar proficiency levels in target languages
    const profDiff = Math.abs(
      (a.proficiencyLevels[bNative_aLearning[0]] || 5) - 
      (b.proficiencyLevels[aNative_bLearning[0]] || 5)
    );
    score += (10 - profDiff) * 0.02;

    return {
      userA: a.userId,
      userB: b.userId,
      compatibilityScore: Math.min(score, 1.0),
      sharedLanguageA: aNative_bLearning[0],
      sharedLanguageB: bNative_aLearning[0],
      commonInterests
    };
  }

  public findBestMatch(userId: string): MatchEdge | null {
    const userEdges = this.edges.get(userId) || [];
    if (userEdges.length === 0) return null;

    // Sort by compatibility score descending
    const sorted = [...userEdges].sort((a, b) => b.compatibilityScore - a.compatibilityScore);
    return sorted[0];
  }

  public getProfile(userId: string): UserLanguageProfile | undefined {
    return this.nodes.get(userId);
  }
}
