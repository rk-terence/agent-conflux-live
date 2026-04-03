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
    // Deep-copy agents so normalization doesn't mutate caller's input
    agents: input.agents.map((a) => ({ ...a })),
  };
  normalizeConfig(config);
  validateConfig(config);
  return config;
}

/** Trim string fields in-place. Only called on owned copies (buildConfig). */
function normalizeConfig(config: SessionConfig): void {
  config.topic = config.topic?.trim();
  for (const agent of config.agents ?? []) {
    agent.name = agent.name?.trim();
    agent.provider = agent.provider?.trim();
    agent.model = agent.model?.trim();
  }
}

export function validateConfig(config: SessionConfig): void {
  if (!config.topic?.trim() || config.topic.trim().length === 0) {
    throw new Error("SessionConfig: topic is required");
  }
  if (!config.agents || config.agents.length < 2) {
    throw new Error("SessionConfig: at least 2 agents required");
  }
  const names = new Set<string>();
  for (const agent of config.agents) {
    if (!agent.name?.trim() || agent.name.trim().length === 0) {
      throw new Error("AgentConfig: name is required");
    }
    if (!agent.provider?.trim() || agent.provider.trim().length === 0) {
      throw new Error(`AgentConfig(${agent.name}): provider is required`);
    }
    if (!agent.model?.trim() || agent.model.trim().length === 0) {
      throw new Error(`AgentConfig(${agent.name}): model is required`);
    }
    const trimmedName = agent.name.trim();
    if (names.has(trimmedName)) {
      throw new Error(`AgentConfig: duplicate agent name "${trimmedName}"`);
    }
    names.add(trimmedName);
  }
  if (!Number.isFinite(config.recentTierSize) || config.recentTierSize < 1 || !Number.isInteger(config.recentTierSize)) {
    throw new Error("SessionConfig: recentTierSize must be an integer >= 1");
  }
  if (!Number.isFinite(config.mediumTierEnd) || config.mediumTierEnd < config.recentTierSize || !Number.isInteger(config.mediumTierEnd)) {
    throw new Error("SessionConfig: mediumTierEnd must be an integer >= recentTierSize");
  }
  if (!Number.isFinite(config.silenceTimeout) || config.silenceTimeout <= 0) {
    throw new Error("SessionConfig: silenceTimeout must be a finite number > 0");
  }
  if (!Number.isFinite(config.silenceBackoffCap) || config.silenceBackoffCap <= 0) {
    throw new Error("SessionConfig: silenceBackoffCap must be a finite number > 0");
  }
  if (!Number.isFinite(config.tokenTimeCost) || config.tokenTimeCost <= 0) {
    throw new Error("SessionConfig: tokenTimeCost must be a finite number > 0");
  }
  if (!Number.isFinite(config.collisionTimeCost) || config.collisionTimeCost <= 0) {
    throw new Error("SessionConfig: collisionTimeCost must be a finite number > 0");
  }
  if (!Number.isFinite(config.interruptionThreshold) || config.interruptionThreshold <= 0) {
    throw new Error("SessionConfig: interruptionThreshold must be a finite number > 0");
  }
  if (!Number.isFinite(config.maxNegotiationRounds) || config.maxNegotiationRounds < 1 || !Number.isInteger(config.maxNegotiationRounds)) {
    throw new Error("SessionConfig: maxNegotiationRounds must be an integer >= 1");
  }
  if (!Number.isFinite(config.apiRetries) || config.apiRetries < 0 || !Number.isInteger(config.apiRetries)) {
    throw new Error("SessionConfig: apiRetries must be an integer >= 0");
  }
}
