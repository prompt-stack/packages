/**
 * MCP Registry - Register/unregister MCP servers in agent configs
 */

export interface RegistrationResult {
  success: boolean;
  skipped?: boolean;
  error?: string;
  reason?: string;
  configPath?: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  key: string;
  configPath?: string;
  configPaths?: string[];
}

export interface InstalledAgent {
  id: string;
  name: string;
  configPath: string;
}

export interface McpRegistrationSummary {
  [agentId: string]: {
    name: string;
    registered?: boolean;
    serverCount?: number;
    servers?: string[];
    configPath: string;
  };
}

// From agents.js
export const AGENT_CONFIGS: AgentConfig[];
export function findAgentConfig(agent: AgentConfig): string | null;
export function getInstalledAgents(): InstalledAgent[];

// From registry.js
export function registerMcpClaude(
  stackId: string,
  installPath: string,
  manifest: unknown
): Promise<RegistrationResult>;

export function registerMcpCodex(
  stackId: string,
  installPath: string,
  manifest: unknown
): Promise<RegistrationResult>;

export function registerMcpGemini(
  stackId: string,
  installPath: string,
  manifest: unknown
): Promise<RegistrationResult>;

export function unregisterMcpClaude(stackId: string): Promise<RegistrationResult>;

export function unregisterMcpCodex(stackId: string): Promise<RegistrationResult>;

export function unregisterMcpGemini(stackId: string): Promise<RegistrationResult>;

export function registerMcpAll(
  stackId: string,
  installPath: string,
  manifest: unknown,
  targetAgents?: string[] | null
): Promise<Record<string, RegistrationResult>>;

export function unregisterMcpAll(
  stackId: string,
  targetAgents?: string[] | null
): Promise<Record<string, RegistrationResult>>;

export function listRegisteredMcps(): Promise<string[]>;

export function getMcpRegistrationSummary(stackId?: string): Promise<McpRegistrationSummary>;
