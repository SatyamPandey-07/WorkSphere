# BFT Peer Discovery, GossipSub Scoring & Subnet Diversity

## 1. Peer Reputation Score Function
For each connected peer $p$ on topic set $\mathcal{T}$:

$$S(p) = w_1 P_1(p) + w_2 P_2(p) - w_4 P_4(p)$$

- **Time in mesh ($P_1$):** $P_1(p) = \min(P_{1,\max}, \Delta t_{\text{mesh}}(p) / \tau_{\text{mesh}})$ with $\tau_{\text{mesh}} = 300\text{ s}$ and $P_{1,\max} = 10$.
- **First message deliveries ($P_2$):** $P_2(p) = \min(P_{2,\max}, \sum_{t \in \mathcal{T}} \alpha_t \cdot d_{\text{first}}(p, t))$ with decay $\gamma = 0.98/\text{s}$ and $P_{2,\max} = 25$.
- **Invalid signatures ($P_4$):** $P_4(p) = \beta_{\text{sig}} \cdot n_{\text{bad\_sig}}(p) + \beta_{\text{mal}} \cdot n_{\text{malformed}}(p)$ with $\beta_{\text{sig}} = 50$ and $\beta_{\text{mal}} = 20$.

## 2. Pruning & Replacement Policy
- Target mesh degree $D = 6$, low watermark $D_{\text{low}} = 4$, high watermark $D_{\text{high}} = 12$.
- Prune peers below $S_{\text{prune}} = -10$ or above $D_{\text{high}}$, prioritizing lowest score, highest subnet count, and shortest tenure, with a $60\text{ s}$ reconnect backoff.

## 3. IP Subnet Colocation Restrictions
- Limit active mesh peers to $K_{\text{mesh}} = 2$ per IPv4 `/24` (or IPv6 `/48`) and total room peers to $K_{\text{total}} = 4$ per prefix.

## 4. Attack Models & Simulation Parameters
- **Eclipse & Sybil mitigation:** Evaluated across $M = 100$ nodes, $20\%$ adversarial peers, $60\text{ s}$ partition recovery, $5\text{ msg/s}$ rate, and $100\text{ ms}$ heartbeat.
- See [GossipSub Sybil Mitigation](./GOSSIPSUB_SYBIL_MITIGATION.md) and `src/lib/p2p/meshCollabEngine.ts`.