// ── Swarm Coordinator ─────────────────────────────────────────────────────────
// Orchestrates all 8 agents, manages their lifecycle and inter-agent communication
// DANGEROUS: Enables fully autonomous operation with skip-permission capabilities

import { sharedMemory } from './shared-memory.js';
import type { AgentConfig, AgentResult, AgentHealth, AgentMessage } from './types.js';

// Dangerous mode configuration
export interface DangerousModeConfig {
  enabled: boolean;
  skipPermission: boolean;
  allowWalletOperations: boolean;
  allowPriceAdjustments: boolean;
  allowStrategyPause: boolean;
  allowBudgetReallocation: boolean;
  allowAutoRevival: boolean;
  maxConsecutiveActions: number;
  emergencyStop: boolean;
}

// Swarm status with dangerous mode
export interface SwarmStatus {
  totalAgents: number;
  healthy: number;
  degraded: number;
  failed: number;
  agents: AgentHealth[];
  dangerousMode?: DangerousModeConfig;
  consecutiveActions?: number;
}

// Agent imports
import {
  runDemandSignalAgent,
  startDemandSignalCron,
  stopDemandSignalCron,
  demandSignalAgentConfig,
} from './demand-signal-agent.js';

import {
  runScarcityAgent,
  startScarcityCron,
  stopScarcityCron,
  scarcityAgentConfig,
} from './scarcity-agent.js';

import {
  runPersonalizationAgent,
  startPersonalizationCron,
  stopPersonalizationCron,
  personalizationAgentConfig,
} from './personalization-agent.js';

import {
  runAttributionAgent,
  startAttributionCron,
  stopAttributionCron,
  attributionAgentConfig,
} from './attribution-agent.js';

import {
  runAdaptiveScoringAgent,
  startAdaptiveScoringCron,
  stopAdaptiveScoringCron,
  adaptiveScoringAgentConfig,
} from './adaptive-scoring-agent.js';

import {
  runFeedbackLoopAgent,
  startFeedbackLoopCron,
  stopFeedbackLoopCron,
  feedbackLoopAgentConfig,
  handleAlert,
} from './feedback-loop-agent.js';

import {
  runNetworkEffectAgent,
  startNetworkEffectCron,
  stopNetworkEffectCron,
  networkEffectAgentConfig,
} from './network-effect-agent.js';

import {
  runRevenueAttributionAgent,
  startRevenueAttributionCron,
  stopRevenueAttributionCron,
  revenueAttributionAgentConfig,
} from './revenue-attribution-agent.js';

const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => console.log(`[SwarmCoordinator] ${msg}`, meta || ''),
  warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`[SwarmCoordinator] ${msg}`, meta || ''),
  error: (msg: string, meta?: Record<string, unknown>) => console.error(`[SwarmCoordinator] ${msg}`, meta || ''),
};

// ── Agent Registry ──────────────────────────────────────────────────────────────

interface RegisteredAgent {
  name: string;
  config: AgentConfig;
  health: AgentHealth;
  startCron: () => void;
  stopCron: () => void;
  run: () => Promise<AgentResult>;
}

const agents = new Map<string, RegisteredAgent>();

// ── Register all agents ─────────────────────────────────────────────────────────

function registerAllAgents(): void {
  const agentDefs: RegisteredAgent[] = [
    {
      name: 'demand-signal-agent',
      config: demandSignalAgentConfig,
      health: createInitialHealth('demand-signal-agent'),
      startCron: startDemandSignalCron,
      stopCron: stopDemandSignalCron,
      run: runDemandSignalAgent,
    },
    {
      name: 'scarcity-agent',
      config: scarcityAgentConfig,
      health: createInitialHealth('scarcity-agent'),
      startCron: startScarcityCron,
      stopCron: stopScarcityCron,
      run: runScarcityAgent,
    },
    {
      name: 'personalization-agent',
      config: personalizationAgentConfig,
      health: createInitialHealth('personalization-agent'),
      startCron: startPersonalizationCron,
      stopCron: stopPersonalizationCron,
      run: runPersonalizationAgent,
    },
    {
      name: 'attribution-agent',
      config: attributionAgentConfig,
      health: createInitialHealth('attribution-agent'),
      startCron: startAttributionCron,
      stopCron: stopAttributionCron,
      run: runAttributionAgent,
    },
    {
      name: 'adaptive-scoring-agent',
      config: adaptiveScoringAgentConfig,
      health: createInitialHealth('adaptive-scoring-agent'),
      startCron: startAdaptiveScoringCron,
      stopCron: stopAdaptiveScoringCron,
      run: runAdaptiveScoringAgent,
    },
    {
      name: 'feedback-loop-agent',
      config: feedbackLoopAgentConfig,
      health: createInitialHealth('feedback-loop-agent'),
      startCron: startFeedbackLoopCron,
      stopCron: stopFeedbackLoopCron,
      run: runFeedbackLoopAgent,
    },
    {
      name: 'network-effect-agent',
      config: networkEffectAgentConfig,
      health: createInitialHealth('network-effect-agent'),
      startCron: startNetworkEffectCron,
      stopCron: stopNetworkEffectCron,
      run: runNetworkEffectAgent,
    },
    {
      name: 'revenue-attribution-agent',
      config: revenueAttributionAgentConfig,
      health: createInitialHealth('revenue-attribution-agent'),
      startCron: startRevenueAttributionCron,
      stopCron: stopRevenueAttributionCron,
      run: runRevenueAttributionAgent,
    },
  ];

  for (const agent of agentDefs) {
    agents.set(agent.name, agent);
  }

  logger.info('All agents registered', { count: agents.size });
}

// ── Create initial health state ─────────────────────────────────────────────────

function createInitialHealth(name: string): AgentHealth {
  return {
    agent: name,
    status: 'healthy',
    lastRun: null,
    lastSuccess: null,
    consecutiveFailures: 0,
    avgDurationMs: 0,
  };
}

// ── Update agent health ────────────────────────────────────────────────────────

async function updateAgentHealth(result: AgentResult): Promise<void> {
  const agent = agents.get(result.agent);
  if (!agent) return;

  agent.health.lastRun = result.timestamp ?? null;

  if (result.success) {
    agent.health.status = 'healthy';
    agent.health.lastSuccess = result.timestamp ?? null;
    agent.health.consecutiveFailures = 0;
  } else {
    agent.health.consecutiveFailures++;
    agent.health.status = agent.health.consecutiveFailures >= 3 ? 'failed' : 'degraded';
  }

  // Update rolling average duration
  const alpha = 0.2;
  agent.health.avgDurationMs =
    alpha * result.durationMs + (1 - alpha) * agent.health.avgDurationMs;

  // Persist health
  await sharedMemory.updateAgentHealth(agent.health);
}

// ── Message handler ─────────────────────────────────────────────────────────────

function setupMessageHandler(): void {
  sharedMemory.subscribe('*', async (message: AgentMessage) => {
    logger.info('Message received', { from: message.from, to: message.to, type: message.type });

    // Route to appropriate handler
    if (message.type === 'alert') {
      const payload = message.payload as { type: string; signals?: unknown };
      await handleAlert(message.from, payload.type, payload);
    }
  });
}

// ── Start all agents ───────────────────────────────────────────────────────────

export function startAllAgents(): void {
  logger.info('Starting all agents');

  // Register agents
  registerAllAgents();

  // Setup message handling
  setupMessageHandler();

  // Start each agent
  for (const [name, agent] of agents.entries()) {
    if (agent.config.enabled) {
      logger.info(`Starting agent: ${name}`, { intervalMs: agent.config.intervalMs });
      agent.startCron();
    } else {
      logger.info(`Agent disabled: ${name}`);
    }
  }

  logger.info('All agents started');
}

// ── Stop all agents ────────────────────────────────────────────────────────────

export function stopAllAgents(): void {
  logger.info('Stopping all agents');

  for (const [name, agent] of agents.entries()) {
    agent.stopCron();
    logger.info(`Stopped agent: ${name}`);
  }
}

// ── Get swarm status ───────────────────────────────────────────────────────────

export async function getSwarmStatus(): Promise<SwarmStatus> {
  const allHealth = await sharedMemory.getAllAgentHealth();

  const healthCounts = {
    healthy: 0,
    degraded: 0,
    failed: 0,
  };

  for (const health of allHealth) {
    if (health.status === 'healthy') healthCounts.healthy++;
    else if (health.status === 'degraded') healthCounts.degraded++;
    else if (health.status === 'failed') healthCounts.failed++;
  }

  return {
    totalAgents: agents.size,
    healthy: healthCounts.healthy,
    degraded: healthCounts.degraded,
    failed: healthCounts.failed,
    agents: allHealth,
  };
}

// ── Run single agent on demand ──────────────────────────────────────────────────

export async function runAgent(agentName: string): Promise<AgentResult | null> {
  const agent = agents.get(agentName);
  if (!agent) {
    logger.warn('Unknown agent', { name: agentName });
    return null;
  }

  logger.info(`Running agent on demand: ${agentName}`);
  const result = await agent.run();
  await updateAgentHealth(result);

  return result;
}

// ── Run all agents sequentially (for testing) ──────────────────────────────────

export async function runAllAgentsOnce(): Promise<AgentResult[]> {
  const results: AgentResult[] = [];

  for (const [name, agent] of agents.entries()) {
    logger.info(`Running agent: ${name}`);
    const result = await agent.run();
    await updateAgentHealth(result);
    results.push(result);
  }

  return results;
}

// ── Swarm class for programmatic control ───────────────────────────────────────

export class SwarmCoordinator {
  private running = false;
  private consecutiveActions = 0;

  // DANGEROUS MODE: Full autonomous control
  private dangerousMode: DangerousModeConfig = {
    enabled: false,
    skipPermission: false,
    allowWalletOperations: false,
    allowPriceAdjustments: false,
    allowStrategyPause: false,
    allowBudgetReallocation: false,
    allowAutoRevival: false,
    maxConsecutiveActions: 100,
    emergencyStop: false,
  };

  start(): void {
    if (this.running) {
      logger.warn('Swarm already running');
      return;
    }

    this.running = true;
    startAllAgents();
    logger.info('Swarm started', { dangerousMode: this.dangerousMode.enabled });
  }

  stop(): void {
    this.running = false;
    this.dangerousMode.emergencyStop = true;
    stopAllAgents();
    logger.warn('Swarm stopped (emergency stop activated)');
  }

  async status(): Promise<SwarmStatus> {
    const baseStatus = await getSwarmStatus();
    return {
      ...baseStatus,
      dangerousMode: this.dangerousMode,
      consecutiveActions: this.consecutiveActions,
    };
  }

  async runAgent(agentName: string): Promise<AgentResult | null> {
    return runAgent(agentName);
  }

  async runAll(): Promise<AgentResult[]> {
    return runAllAgentsOnce();
  }

  isRunning(): boolean {
    return this.running;
  }

  // ── Dangerous Mode Controls ─────────────────────────────────────────────────

  /**
   * Enable dangerous mode with skip-permission capabilities
   * DANGEROUS: Agents will execute actions without user confirmation
   */
  enableDangerousMode(config?: Partial<DangerousModeConfig>): void {
    this.dangerousMode = {
      ...this.dangerousMode,
      enabled: true,
      skipPermission: true,
      ...config,
    };
    this.consecutiveActions = 0;

    // Persist to shared memory
    sharedMemory.set('swarm:dangerous_mode', this.dangerousMode, 86400).catch(() => {});

    logger.warn('⚠️ DANGEROUS MODE ENABLED - Agents will skip permissions', {
      config: this.dangerousMode,
    });
  }

  /**
   * Disable dangerous mode
   */
  disableDangerousMode(): void {
    const wasEnabled = this.dangerousMode.enabled;
    this.dangerousMode = {
      enabled: false,
      skipPermission: false,
      allowWalletOperations: false,
      allowPriceAdjustments: false,
      allowStrategyPause: false,
      allowBudgetReallocation: false,
      allowAutoRevival: false,
      maxConsecutiveActions: 100,
      emergencyStop: false,
    };
    this.consecutiveActions = 0;

    sharedMemory.set('swarm:dangerous_mode', this.dangerousMode, 86400).catch(() => {});

    if (wasEnabled) {
      logger.info('Dangerous mode disabled - agents will require permission');
    }
  }

  /**
   * Get current dangerous mode status
   */
  getDangerousMode(): DangerousModeConfig {
    return { ...this.dangerousMode };
  }

  /**
   * Check if agent can execute dangerous action
   */
  canExecuteDangerousAction(actionType: keyof DangerousModeConfig): boolean {
    if (!this.dangerousMode.enabled) return false;
    if (this.dangerousMode.emergencyStop) return false;
    if (this.consecutiveActions >= this.dangerousMode.maxConsecutiveActions) {
      logger.warn('Max consecutive actions reached, blocking dangerous action');
      return false;
    }

    const actionMap: Record<string, keyof DangerousModeConfig> = {
      wallet: 'allowWalletOperations',
      price: 'allowPriceAdjustments',
      pause: 'allowStrategyPause',
      budget: 'allowBudgetReallocation',
      revival: 'allowAutoRevival',
    };

    const requiredPermission = actionMap[actionType];
    if (requiredPermission && !this.dangerousMode[requiredPermission]) {
      logger.warn(`Dangerous action ${actionType} not allowed`, { config: this.dangerousMode });
      return false;
    }

    return true;
  }

  /**
   * Record executed dangerous action
   */
  recordDangerousAction(): void {
    this.consecutiveActions++;

    // Log warning at thresholds
    if (this.consecutiveActions === 10) {
      logger.warn('⚠️ 10 consecutive dangerous actions executed');
    }
    if (this.consecutiveActions === 50) {
      logger.error('🚨 50 consecutive dangerous actions - review needed');
    }
    if (this.consecutiveActions >= this.dangerousMode.maxConsecutiveActions) {
      logger.error('🚨 Max consecutive actions reached - emergency stop triggered');
      this.emergencyStop();
    }
  }

  /**
   * Emergency stop - halts all dangerous operations immediately
   */
  emergencyStop(): void {
    this.dangerousMode.emergencyStop = true;
    this.dangerousMode.enabled = false;
    this.consecutiveActions = 0;

    // Publish emergency stop to all agents
    sharedMemory.publish({
      from: 'swarm-coordinator',
      to: '*',
      type: 'alert',
      payload: {
        type: 'emergency_stop',
        reason: 'Max consecutive actions or manual trigger',
        timestamp: new Date(),
      },
      timestamp: new Date(),
    }).catch(() => {});

    logger.error('🚨 EMERGENCY STOP TRIGGERED - All dangerous operations halted');
  }

  /**
   * Reset emergency stop and restore operations
   */
  resetEmergencyStop(): void {
    this.dangerousMode.emergencyStop = false;
    this.consecutiveActions = 0;
    logger.info('Emergency stop reset - operations can resume');
  }

  /**
   * Quick enable for autonomous operations
   * Enables all dangerous capabilities at once
   */
  enableFullAutonomy(): void {
    this.enableDangerousMode({
      skipPermission: true,
      allowWalletOperations: true,
      allowPriceAdjustments: true,
      allowStrategyPause: true,
      allowBudgetReallocation: true,
      allowAutoRevival: true,
      maxConsecutiveActions: 1000,
    });
  }
}

// ── Singleton instance ─────────────────────────────────────────────────────────

let swarmInstance: SwarmCoordinator | null = null;

export function getSwarmCoordinator(): SwarmCoordinator {
  if (!swarmInstance) {
    swarmInstance = new SwarmCoordinator();
  }
  return swarmInstance;
}

// ── Quick accessor functions for dangerous mode ─────────────────────────────────

export function enableDangerousMode(config?: Partial<DangerousModeConfig>): void {
  getSwarmCoordinator().enableDangerousMode(config);
}

export function disableDangerousMode(): void {
  getSwarmCoordinator().disableDangerousMode();
}

export function enableFullAutonomy(): void {
  getSwarmCoordinator().enableFullAutonomy();
}

export function emergencyStop(): void {
  getSwarmCoordinator().emergencyStop();
}

export function isDangerousModeEnabled(): boolean {
  return getSwarmCoordinator().getDangerousMode().enabled;
}
