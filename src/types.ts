export interface Skill {
  id: string;
  path: string;
  token_cost: number;
  triggers: string[];
  children?: string[];
  mcp_dependencies?: string[];
  parent?: string;
}

export interface MLModel {
  id: string;
  triggers: string[];
  backend: string;
  latency_ms: number;
  accuracy: number;
}

export interface Manifest {
  version: string;
  skills: Skill[];
  ml_offload_registry: MLModel[];
}
