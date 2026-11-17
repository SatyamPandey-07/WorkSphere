$content = @"
# Multi-Agent Consensus Architecture

The `VibeConsensusEngine` (`src/core/agents/consensus/VibeConsensusEngine.ts`) coordinates specialized autonomous agents to compute a unified, tamper-resistant vibe rating for co-working spaces.

---

## 1. Mathematical Scoring Model (KaTeX)

Each agent \$i\$ outputs an individual vibe score \$s_i \in [0, 10]\$ along with a confidence weight \$w_i \in [0, 1]\$.

### 1.1 Weighted Raw Score
The aggregate weighted raw score \$S_{raw}\$ is computed as:

$$S_{raw} = \frac{\sum_{i=1}^{n} w_i \cdot s_i}{\sum_{i=1}^{n} w_i}$$

### 1.2 Divergence Penalty & Consensus Score
To penalize high variance across specialized evaluators (e.g., noise auditor vs. comfort evaluator), the variance \$\sigma^2\$ is evaluated:

$$\sigma^2 = \frac{\sum_{i=1}^{n} w_i (s_i - S_{raw})^2}{\sum_{i=1}^{n} w_i}$$

The final consensus score \$S_{final}\$ applies a divergence dampening factor \$\alpha = 0.15\$:

$$S_{final} = S_{raw} \cdot \exp\left(-\alpha \cdot \sigma^2\right)$$

If \$S_{final} \ge T_{threshold}\$ (where default \$T_{threshold} = 7.0\$), consensus is achieved and committed to state storage.

---

## 2. System Flowchart

```mermaid
graph TD
    A[Raw Sensor & User Telemetry] --> B[VibeConsensusEngine]
    
    subgraph Agent Evaluation Layer
        B --> C1[Noise Auditor Agent]
        B --> C2[Amenity Verifier Agent]
        B --> C3[Comfort Evaluator Agent]
        
        C1 --> D1[Score s_1, Weight w_1]
        C2 --> D2[Score s_2, Weight w_2]
        C3 --> D3[Score s_3, Weight w_3]
    end
    
    D1 & D2 & D3 --> E[Aggregate & Compute Weighted Mean S_raw]
    E --> F[Calculate Variance & Divergence Penalty]
    F --> G{S_final >= Threshold?}
    
    G -- Yes --> H[Commit Final Vibe Rating]
    G -- No --> I[Trigger Divergence Resolution]
    I --> J[Re-evaluate Outlier Agents]
    J --> B

    sequenceDiagram
    autonumber
    participant Engine as VibeConsensusEngine
    participant NA as NoiseAuditor
    participant AV as AmenityVerifier
    participant CE as ComfortEvaluator
    participant State as ConsensusStateStore

    Engine->>NA: Request Evaluation(telemetry)
    Engine->>AV: Request Evaluation(telemetry)
    Engine->>CE: Request Evaluation(telemetry)
    
    NA-->>Engine: Yield (s_1, w_1)
    AV-->>Engine: Yield (s_2, w_2)
    CE-->>Engine: Yield (s_3, w_3)
    
    Engine->>Engine: Calculate S_raw & Variance penalty
    
    alt Consensus Achieved (S_final >= Threshold)
        Engine->>State: Store Consensus Rating
        Engine-->>Engine: Emit ConsensusResolved Event
    else Divergence Detected
        Engine->>Engine: Identify Outlier Scores (|s_i - S_raw| > delta)
        Engine->>NA: Request Outlier Audit Re-Check
        NA-->>Engine: Return Adjusted Score (s_1_adj, w_1_adj)
        Engine->>State: Store Adjusted Consensus Rating
    end