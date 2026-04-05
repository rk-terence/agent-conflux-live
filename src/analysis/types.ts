// ── L1 Threshold Constants ──────────────────────────────────────────────────
// All thresholds in one place for easy tuning.

export const THRESHOLDS = {
  /** Fraction of normalize_result events using a fallback path */
  L1_FALLBACK_RATE: 0.25,
  /** Fraction of normalize_result events with truncation_suspected */
  L1_TRUNCATION_RATE: 0.25,
  /** Fraction of collisions resolved at tier 3 or 4 */
  L1_TIER3_4_COLLISION_RATE: 0.30,
  /** Max fraction of speech turns any single speaker may hold */
  L1_SPEAKER_MONOPOLY_RATIO: 0.60,
  /** Minimum speech turns before monopoly check applies */
  L1_SPEAKER_MONOPOLY_MIN_TURNS: 8,
  /** Absolute count of dedup drops that triggers fail */
  L1_DEDUP_DROP_COUNT: 3,
  /** Fraction of utterance_filter_result events where cleaning produced null */
  L1_CLEANED_TO_NULL_RATE: 0.25,
} as const;

// ── Summary Schema Version ──────────────────────────────────────────────────

export const SUMMARY_SCHEMA_VERSION = 4;

// ── Output Types ────────────────────────────────────────────────────────────

export const L2_RUBRIC_WEIGHTS = {
  personality_contrast: 30,
  dramatic_tension: 25,
  quotability: 20,
  surprise: 15,
  arc_completion: 10,
} as const;

export type L2RubricName = keyof typeof L2_RUBRIC_WEIGHTS;

export interface L2EvidenceRef {
  turn: number;
  speaker: string;
  text: string;
}

export interface L2CandidateQuote extends L2EvidenceRef {}

export interface L2RubricScore {
  rubric: L2RubricName;
  score: number;
  why: string;
  evidence: L2EvidenceRef[];
  failure_mode: string | null;
}

export interface L2ScoredResult {
  status: "scored";
  rubrics: L2RubricScore[];
  weighted_total_100: number;
  dominant_observation: string;
  candidate_quotes: L2CandidateQuote[];
  mechanics_contamination_note: string;
  human_decision_required: true;
  scorer_model: string;
  scored_at: string;
}

export interface L2BlockedResult {
  status: "blocked";
  reasons: string[];
  scorer_model: null;
  scored_at: string;
}

export type L2Result = L2ScoredResult | L2BlockedResult;

export interface SizeStats {
  min: number;
  max: number;
  avg: number;
  count: number;
}

export interface SizesSection {
  prompt_history_chars: SizeStats | null;
  prompt_user_chars: SizeStats | null;
  response_content_chars: SizeStats | null;
  thought_chars: SizeStats | null;
  utterance_cleaned_chars: SizeStats | null;
}

export interface RunSummary {
  schema_version: number;
  source: {
    log_path: string;
    run_id: string | null;
    log_schema_version: number | null;
  };
  run: {
    started_at: string | null;
    ended_at: string | null;
    duration_ms: number | null;
    terminal: boolean;
    status: string | null;
    end_reason: string | null;
  };
  session: {
    topic: string | null;
    agents: AgentInfo[];
    config: Record<string, unknown>;
  };
  counts: RunCounts;
  api: ApiStats;
  normalization: NormalizationStats;
  filtering: FilteringStats;
  mechanics: MechanicsStats;
  sizes: SizesSection;
  classification: Classification;
  eligible_for_l2: boolean;
  l2?: L2Result;
  warnings: string[];
}

export interface AgentInfo {
  name: string;
  provider: string;
  model: string;
  thinkingModel?: boolean;
}

export interface RunCounts {
  turns_started: number;
  turns_completed: number;
  speech_turns: number;
  silence_turns: number;
  thought_updates: number;
  api_calls_started: number;
  api_calls_finished: number;
  api_calls_succeeded: number;
  api_calls_failed: number;
  normalize_results: number;
  utterance_filter_results: number;
  collisions: number;
  interruptions_attempted: number;
}

export interface ApiModeStats {
  started: number;
  succeeded: number;
  failed: number;
  total_duration_ms: number;
}

export interface ApiAgentStats {
  started: number;
  succeeded: number;
  failed: number;
  total_duration_ms: number;
  avg_duration_ms: number;
  max_duration_ms: number;
}

export interface ApiErrorEntry {
  call_id: string;
  agent: string;
  mode: string;
  error_code?: string;
  error_message?: string;
  http_status?: number;
}

export interface ApiStats {
  by_mode: Record<string, ApiModeStats>;
  by_agent: Record<string, ApiAgentStats>;
  errors: ApiErrorEntry[];
  finish_reasons: Record<string, number>;
  truncation_suspected_count: number;
  fallback_count: number;
}

export interface NormalizationStats {
  fallback_path_counts: Record<string, number>;
  thought_type_counts: Record<string, number>;
  raw_kind_counts: Record<string, number>;
}

export interface FilteringStats {
  dedup_drop_count: number;
  history_hallucination_count: number;
  speaker_prefix_stripped_count: number;
  action_stripped_count: number;
  silence_by_length_count: number;
  truncated_by_max_length_count: number;
  silence_token_detected_count: number;
  cleaned_to_null_count: number;
  pipeline_filter_count: number;
  pipeline_cleaned_to_null_count: number;
}

export interface MechanicsStats {
  speaker_turns: Record<string, number>;
  collision_tiers: Record<string, number>;
  tier3_count: number;
  tier4_count: number;
  interruption_success_count: number;
  interruption_failure_count: number;
}

export interface Classification {
  l0_infra: {
    result: "pass" | "fail";
    reasons: string[];
  };
  l1_mechanics: {
    result: "pass" | "fail" | "not_evaluated";
    reasons: string[];
  };
}

// ── Parse Error ─────────────────────────────────────────────────────────────

export interface ParseError {
  line: number;
  raw: string;
  error: string;
}

// ── Internal Accumulator State ──────────────────────────────────────────────

export interface AccumulatorState {
  // Run identity
  runIds: Set<string>;
  schemaVersion: number | null;

  // Bookend tracking
  hasRunStarted: boolean;
  hasRunFinished: boolean;
  runFinishedTerminal: boolean;
  runFinishedStatus: string | null;
  hasFatalError: boolean;
  fatalErrors: string[];

  // API call lifecycle tracking — keyed by "call_id:attempt" for retry safety
  apiCallsStartedKeys: Set<string>;
  apiCallsFinishedKeys: Set<string>;
  /** Set of call_ids that have at least one api_call_finished (any attempt) */
  apiCallsFinishedCallIds: Set<string>;
  /** Set of call_ids that have at least one successful api_call_finished */
  apiCallsSucceededCallIds: Set<string>;
  duplicateCallKeys: string[];
  duplicateFinishedKeys: string[];
  orphanFinished: string[];

  // Downstream lifecycle validation
  orphanNormalizeResults: string[];
  orphanFilterResults: string[];

  // Cross-field context consistency (warnings, not L0 blockers)
  /** Expected context per call_id: turn, agent, mode from first api_call_started */
  callIdContext: Map<string, { turn: number; agent: string; mode: string }>;
  retryContextMismatchCount: number;
  normalizeContextMismatchCount: number;
  filterContextMismatchCount: number;
  /** normalize_result linking to a call_id with no successful finish */
  normalizeOnFailedCallCount: number;

  // Provider error signals (for L0)
  authErrors: Array<{ call_id: string; detail: string }>;
  modelErrors: Array<{ call_id: string; detail: string }>;

  // Corrupt event signals (for L0)
  corruptEvents: Array<{ line: number; event: string; missing: string[] }>;

  // Per-agent duration tracking (for avg/max computation)
  agentDurations: Map<string, number[]>;

  // Cleaned-to-null tracking (for L1)
  cleanedToNullCount: number;

  // Interruption evaluation tracking (for L1 consistency check)
  interruptionEvalSuccessCount: number;
  interruptionEvalFailureCount: number;
  /** Evaluations where a representative was selected (someone actually tried to interrupt) */
  interruptionEvalWithRepresentativeCount: number;

  // Size tracking — streaming accumulators (constant memory)
  historyCharsAcc: SizeAccumulator;
  userPromptCharsAcc: SizeAccumulator;
  contentCharsAcc: SizeAccumulator;
  thoughtCharsAcc: SizeAccumulator;
  cleanedUtteranceCharsAcc: SizeAccumulator;
}

export interface SizeAccumulator {
  min: number;
  max: number;
  sum: number;
  count: number;
}
