import type { EngineTuningOverride } from "@/lib/config/engineTuning";
import type { EngineResult } from "@/lib/itinerary/engine";
import type {
  ConstraintErrorReason,
  GenerateItineraryInput,
  GraphEdge,
  GraphNode,
} from "@/types/domain";

export type RobustnessProfile = "quick" | "heavy" | "replay";
export type ScenarioExpectation = "must_plan" | "may_reject";

export type SerializableAttractionsByCity =
  | Record<string, GraphNode[]>
  | Array<readonly [string, GraphNode[]]>
  | Array<{ cityId: string; attractions: GraphNode[] }>;

export interface SerializableEngineContext {
  nodes: GraphNode[];
  edges: GraphEdge[];
  attractionsByCity?: SerializableAttractionsByCity;
  nowEpochMs?: number;
  makeIdSeed?: string;
  tuningOverride?: EngineTuningOverride;
}

export interface GeneratedScenario {
  id: string;
  index: number;
  profile: RobustnessProfile;
  seed: string;
  title: string;
  source: "synthetic" | "dataset";
  datasetId?: string;
  mutation?: string;
  expectation: ScenarioExpectation;
  input: GenerateItineraryInput;
  context: SerializableEngineContext;
}

export interface InvariantViolation {
  code: string;
  message: string;
  severity: "error" | "warning";
  path?: string;
  expected?: unknown;
  actual?: unknown;
}

export interface CaseResult {
  scenarioId: string;
  caseIndex: number;
  expectation: ScenarioExpectation;
  elapsedMs: number;
  status: "ok" | "rejected" | "threw";
  result?: EngineResult;
  thrownError?: {
    name: string;
    message: string;
    stack?: string;
  };
  violations: InvariantViolation[];
}

export interface RobustnessRunSummary {
  profile: RobustnessProfile;
  seed: string;
  startedAtEpochMs: number;
  finishedAtEpochMs: number;
  durationMs: number;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  thrownCases: number;
  okCases: number;
  rejectedCases: number;
  constraintReasonCounts: Partial<Record<ConstraintErrorReason, number>>;
  violationCounts: Record<string, number>;
  cases: CaseResult[];
}
