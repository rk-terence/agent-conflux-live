import type {
  AgentState,
  SessionState,
  NegotiationContext,
  JudgeContext,
  DefenseContext,
  PromptSet,
} from "../types.js";
import {
  buildReactionSystemPrompt,
  buildNegotiationSystemPrompt,
  buildVotingSystemPrompt,
  buildJudgeSystemPrompt,
  buildDefenseSystemPrompt,
} from "./system-prompts.js";
import {
  buildReactionDirective,
  buildNegotiationDirective,
  buildVotingDirective,
  buildJudgeDirective,
  buildDefenseDirective,
} from "./turn-directive.js";
import { projectHistory } from "./history-projector.js";
import { formatNameList } from "../util/name-list.js";

function assembleUserPrompt(history: string, directive: string): string {
  if (history.length === 0) return directive;
  return history + "\n\n" + directive;
}

export function buildReactionPrompt(agent: AgentState, session: SessionState): PromptSet {
  const otherNames = session.agents
    .filter((a) => a.name !== agent.name)
    .map((a) => a.name);

  const systemPrompt = buildReactionSystemPrompt(
    agent.name,
    formatNameList(otherNames),
    session.config.topic,
  );
  const history = projectHistory(session, agent.name);
  const directive = buildReactionDirective(agent, session);

  return {
    systemPrompt,
    userPrompt: assembleUserPrompt(history, directive),
    maxTokens: 150,
    history,
    directive,
    historyChars: history.length,
    directiveChars: directive.length,
  };
}

export function buildNegotiationPrompt(
  agent: AgentState,
  session: SessionState,
  ctx: NegotiationContext,
): PromptSet {
  const systemPrompt = buildNegotiationSystemPrompt(agent.name, session.config.topic);
  const history = projectHistory(session, agent.name);
  const directive = buildNegotiationDirective(agent, session, ctx);

  return {
    systemPrompt,
    userPrompt: assembleUserPrompt(history, directive),
    maxTokens: 50,
    history,
    directive,
    historyChars: history.length,
    directiveChars: directive.length,
  };
}

export function buildVotingPrompt(
  agent: AgentState,
  session: SessionState,
  candidates: string[],
): PromptSet {
  const systemPrompt = buildVotingSystemPrompt(agent.name, session.config.topic);
  const history = projectHistory(session, agent.name);
  const directive = buildVotingDirective(agent, session, candidates);

  return {
    systemPrompt,
    userPrompt: assembleUserPrompt(history, directive),
    maxTokens: 50,
    history,
    directive,
    historyChars: history.length,
    directiveChars: directive.length,
  };
}

export function buildJudgePrompt(
  agent: AgentState,
  session: SessionState,
  ctx: JudgeContext,
): PromptSet {
  const systemPrompt = buildJudgeSystemPrompt(
    agent.name,
    session.config.topic,
    ctx.speakerName,
  );
  const history = projectHistory(session, agent.name);
  const directive = buildJudgeDirective(agent, session, ctx);

  return {
    systemPrompt,
    userPrompt: assembleUserPrompt(history, directive),
    maxTokens: 50,
    history,
    directive,
    historyChars: history.length,
    directiveChars: directive.length,
  };
}

export function buildDefensePrompt(
  agent: AgentState,
  session: SessionState,
  ctx: DefenseContext,
): PromptSet {
  const systemPrompt = buildDefenseSystemPrompt(
    agent.name,
    session.config.topic,
    ctx.interrupterName,
  );
  const history = projectHistory(session, agent.name);
  const directive = buildDefenseDirective(agent, session, ctx);

  return {
    systemPrompt,
    userPrompt: assembleUserPrompt(history, directive),
    maxTokens: 50,
    history,
    directive,
    historyChars: history.length,
    directiveChars: directive.length,
  };
}
