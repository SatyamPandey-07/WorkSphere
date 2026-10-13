#include <emscripten.h>
#include <stdlib.h>
#include <string.h>

#define MAX_PEERS 50
#define UNCHOKE_SLOTS 4

typedef struct {
    char peer_id[64];
    int is_choking;
    int is_interested;
    long download_rate; // bytes/sec
    long last_unchoked;
} PeerState;

PeerState peers[MAX_PEERS];
int peer_count = 0;

EMSCRIPTEN_KEEPALIVE
void init_choke_manager() {
    peer_count = 0;
    memset(peers, 0, sizeof(peers));
}

EMSCRIPTEN_KEEPALIVE
int add_peer(const char* peer_id) {
    if (peer_count >= MAX_PEERS) return -1;
    
    strncpy(peers[peer_count].peer_id, peer_id, 63);
    peers[peer_count].peer_id[63] = '\0';
    peers[peer_count].is_choking = 1; // Start choked
    peers[peer_count].is_interested = 0;
    peers[peer_count].download_rate = 0;
    peers[peer_count].last_unchoked = 0;
    
    peer_count++;
    return peer_count - 1;
}

EMSCRIPTEN_KEEPALIVE
void update_peer_rate(int index, long rate) {
    if (index >= 0 && index < peer_count) {
        peers[index].download_rate = rate;
    }
}

EMSCRIPTEN_KEEPALIVE
void set_peer_interested(int index, int interested) {
    if (index >= 0 && index < peer_count) {
        peers[index].is_interested = interested;
    }
}

// Simple comparison function for qsort
int compare_peers(const void* a, const void* b) {
    PeerState* pa = (PeerState*)a;
    PeerState* pb = (PeerState*)b;
    return (pb->download_rate - pa->download_rate); // Descending order
}

EMSCRIPTEN_KEEPALIVE
int calculate_unchokes(long current_time) {
    // Sort peers by download rate (Tit-for-Tat)
    qsort(peers, peer_count, sizeof(PeerState), compare_peers);
    
    int unchoked_count = 0;
    int optimistic_index = -1;
    
    // Find a random choked peer for optimistic unchoking
    for (int i = 0; i < peer_count; i++) {
        if (peers[i].is_choking && peers[i].is_interested) {
            if (rand() % 10 < 2) { // 20% chance to select for optimistic unchoke
                optimistic_index = i;
                break;
            }
        }
    }

    for (int i = 0; i < peer_count; i++) {
        if (!peers[i].is_interested) {
            peers[i].is_choking = 1; // Always choke uninterested peers
            continue;
        }

        if (unchoked_count < UNCHOKE_SLOTS || i == optimistic_index) {
            peers[i].is_choking = 0; // Unchoke
            peers[i].last_unchoked = current_time;
            unchoked_count++;
        } else {
            peers[i].is_choking = 1; // Choke
        }
    }
    
    return unchoked_count;
}

EMSCRIPTEN_KEEPALIVE
int is_choking(int index) {
    if (index >= 0 && index < peer_count) {
        return peers[index].is_choking;
    }
    return 1; // Default to choking if invalid
}
