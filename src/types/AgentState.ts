export interface AgentState {
  orchestrator?: {
    agentsToUse: string[];
    reasoning: string;
  };
  context?: {
    intent: string;
    parameters: any;
    required_data: string[];
    reasoning: string;
  };
  data?: any;
  reasoning?: any;
  action?: any;
}
