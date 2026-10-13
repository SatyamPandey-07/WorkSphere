/**
 * Semantic Match Worker
 * Batches and processes large sets of user embeddings to find optimal matches off-thread.
 */

import { TopicSimilarityEngine, UserContext } from '@/core/matchmaking/TopicSimilarityEngine';
import { StudyGroupGraph } from '@/core/matchmaking/StudyGroupGraph';

const engine = new TopicSimilarityEngine(768);
const graph = new StudyGroupGraph();

self.addEventListener('message', (event: MessageEvent) => {
    const { action, payload } = event.data;

    if (action === 'PROCESS_BATCH') {
        const { users, threshold } = payload;

        // Build graph
        for (const user of users as UserContext[]) {
            graph.addUser(user.userId, user.activeTasks);
        }

        // Calculate edges
        for (let i = 0; i < users.length; i++) {
            const matches = engine.findMatches(users[i], users, threshold);
            for (const match of matches) {
                graph.addEdge(users[i].userId, match.userId, match.score);
            }
        }

        const groups = graph.detectGroups(2);

        self.postMessage({
            action: 'MATCH_COMPLETE',
            groups,
            stats: graph.getGraphStats()
        });
    }

    if (action === 'CONFIRM_OPT_IN') {
        graph.confirmOptIn(payload.userIdA, payload.userIdB);
    }
});

export { };
