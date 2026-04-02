import type { SessionConfig, AgentConfig } from "./types.js";

export const DEFAULT_CONFIG: Omit<SessionConfig, "topic" | "agents"> = {
  recentTierSize: 3,
  mediumTierEnd: 8,
  silenceTimeout: 60,
  silenceBackoffCap: 16,
  maxDuration: null,
  interruptionThreshold: 80,
  tokenTimeCost: 0.1,
  collisionTimeCost: 0.5,
  maxNegotiationRounds: 3,
  apiRetries: 3,
};

export type SessionConfigInput = {
  topic: string;
  agents: AgentConfig[];
} & Partial<Omit<SessionConfig, "topic" | "agents">>;

export function buildConfig(input: SessionConfigInput): SessionConfig {
  const config: SessionConfig = {
    ...DEFAULT_CONFIG,
    ...input,
  };
  validateConfig(config);
  return config;
}

function validateConfig(config: SessionConfig): void {
  if (!config.topic || config.topic.trim().length === 0) {
    throw new Error("SessionConfig: topic is required");
  }
  if (!config.agents || config.agents.length < 2) {
    throw new Error("SessionConfig: at least 2 agents required");
  }
  const names = new Set<string>();
  for (const agent of config.agents) {
    if (!agent.name || agent.name.trim().length === 0) {
      throw new Error("AgentConfig: name is required");
    }
    if (!agent.provider || agent.provider.trim().length === 0) {
      throw new Error(`AgentConfig(${agent.name}): provider is required`);
    }
    if (!agent.model || agent.model.trim().length === 0) {
      throw new Error(`AgentConfig(${agent.name}): model is required`);
    }
    if (names.has(agent.name)) {
      throw new Error(`AgentConfig: duplicate agent name "${agent.name}"`);
    }
    names.add(agent.name);
  }
  if (config.recentTierSize < 1) {
    throw new Error("SessionConfig: recentTierSize must be >= 1");
  }
  if (config.mediumTierEnd < config.recentTierSize) {
    throw new Error("SessionConfig: mediumTierEnd must be >= recentTierSize");
  }
  if (config.silenceTimeout <= 0) {
    throw new Error("SessionConfig: silenceTimeout must be > 0");
  }
  if (config.silenceBackoffCap <= 0) {
    throw new Error("SessionConfig: silenceBackoffCap must be > 0");
  }
  if (config.tokenTimeCost <= 0) {
    throw new Error("SessionConfig: tokenTimeCost must be > 0");
  }
  if (config.collisionTimeCost <= 0) {
    throw new Error("SessionConfig: collisionTimeCost must be > 0");
  }
  if (config.interruptionThreshold <= 0) {
    throw new Error("SessionConfig: interruptionThreshold must be > 0");
  }
  if (config.maxNegotiationRounds < 1) {
    throw new Error("SessionConfig: maxNegotiationRounds must be >= 1");
  }
  if (config.apiRetries < 0) {
    throw new Error("SessionConfig: apiRetries must be >= 0");
  }
}
