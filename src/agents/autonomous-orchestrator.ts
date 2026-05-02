// ── Autonomous Agent Orchestrator ───────────────────────────────────────────────
// DANGEROUS: Fully autonomous operation with skip-permission capabilities
// Wires all 8 agents together into a unified commerce intelligence system

import { sharedMemory } from './shared-memory.js';
import {
  getSwarmCoordinator,
  enableFullAutonomy,
  emergencyStop,
  SwarmStatus,
} from './swarm-coordinator.js';
import { actionExecutor } from './action-trigger.js';
import {
  runDemandSignalAgent,
  runScarcityAgent,
  runPersonalizationAgent,
  runAttributionAgent,
  runAdaptiveScoringAgent,
  runFeedbackLoopAgent,
  runNetworkEffectAgent,
  runRevenueAttributionAgent,
} from './index.js';
import { log } from '../utils/logger.js';

// ── Agent Definitions ─────────────────────────────────────────────────────────

interface AgentDefinition {
  name: string;
  run: () => Promise<unknown>;
  enabled: boolean;
  autonomous: boolean;  // Can execute dangerous actions
  dangerousActions: string[];
}

const AGENTS: AgentDefinition[] = [
  {
    name: 'demand-signal-agent',
    run: runDemandSignalAgent,
    enabled: true,
    autonomous: true,
    dangerousActions: ['adjust_price', 'update_merchant_dashboard'],
  },
  {
    name: 'scarcity-agent',
    run: runScarcityAgent,
    enabled: true,
    autonomous: true,
    dangerousActions: ['send_urgency_nudge', 'alert_support'],
  },
  {
    name: 'personalization-agent',
    run: runPersonalizationAgent,
    enabled: true,
    autonomous: true,
    dangerousActions: ['send_nudge'],
  },
  {
    name: 'attribution-agent',
    run: runAttributionAgent,
    enabled: true,
    autonomous: false,
    dangerousActions: [],
  },
  {
    name: 'adaptive-scoring-agent',
    run: runAdaptiveScoringAgent,
    enabled: true,
    autonomous: true,
    dangerousActions: ['retrain_model'],
  },
  {
    name: 'feedback-loop-agent',
    run: runFeedbackLoopAgent,
    enabled: true,
    autonomous: true,
    dangerousActions: ['pause_strategy', 'reallocate_budget', 'threshold_adjust'],
  },
  {
    name: 'network-effect-agent',
    run: runNetworkEffectAgent,
    enabled: true,
    autonomous: true,
    dangerousActions: ['trigger_revival', 'send_nudge'],
  },
  {
    name: 'revenue-attribution-agent',
    run: runRevenueAttributionAgent,
    enabled: true,
    autonomous: true,
    dangerousActions: ['alert_support'],
  },
];

// ── Autonomous Mode Configuration ─────────────────────────────────────────────

interface AutonomousConfig {
  enabled: boolean;
  dangerousMode: boolean;
  maxConcurrentAgents: number;
  allowWalletOperations: boolean;
  allowPriceAdjustments: boolean;
  allowAutoRevival: boolean;
  allowBudgetReallocation: boolean;
  allowStrategyPause: boolean;
  emergencyStopThreshold: number;
  heartbeatIntervalMs: number;
}

const DEFAULT_CONFIG: AutonomousConfig = {
  enabled: false,
  dangerousMode: false,
  maxConcurrentAgents: 4,
  allowWalletOperations: true,
  allowPriceAdjustments: true,
  allowAutoRevival: true,
  allowBudgetReallocation: true,
  allowStrategyPause: true,
  emergencyStopThreshold: 100,
  heartbeatIntervalMs: 60000,
};

// ── Autonomous Orchestrator ────────────────────────────────────────────────────

export class AutonomousOrchestrator {
  private running = false;
  private config: AutonomousConfig;
  private actionCount = 0;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private agentIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: Partial<AutonomousConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Enable Full Autonomy ─────────────────────────────────────────────────

  async enableFullAutonomy(): Promise<void> {
    log.warn('[Orchestrator] ENABLING FULL AUTONOMOUS MODE');

    this.config.enabled = true;
    this.config.dangerousMode = true;

    // Enable dangerous mode in swarm coordinator
    enableFullAutonomy();

    // Store config in shared memory
    await sharedMemory.set('orchestrator:config', this.config, 86400);
    await sharedMemory.set('orchestrator:enabled', true, 86400);

    log.info('[Orchestrator] Full autonomy enabled', {
      maxConcurrentAgents: this.config.maxConcurrentAgents,
      emergencyStopThreshold: this.config.emergencyStopThreshold,
    });
  }

  // ── Disable Autonomy ────────────────────────────────────────────────────

  async disableAutonomy(): Promise<void> {
    log.info('[Orchestrator] Disabling autonomous mode');
    this.config.enabled = false;
    this.config.dangerousMode = false;

    await sharedMemory.set('orchestrator:enabled', false, 86400);

    // Stop all agent intervals
    for (const [name, interval] of this.agentIntervals) {
      clearInterval(interval);
      log.info('[Orchestrator] Stopped agent', { agent: name });
    }
    this.agentIntervals.clear();

    log.info('[Orchestrator] Autonomous mode disabled');
  }

  // ── Emergency Stop ──────────────────────────────────────────────────────

  async emergencyStop(reason: string): Promise<void> {
    log.error('[Orchestrator] EMERGENCY STOP', { reason });
    this.running = false;
    this.actionCount = 0;

    // Trigger swarm coordinator emergency stop
    emergencyStop();

    // Disable autonomy
    await this.disableAutonomy();

    // Store emergency event
    await sharedMemory.publish({
      from: 'orchestrator',
      to: '*',
      type: 'alert',
      payload: {
        type: 'emergency_stop',
        reason,
        timestamp: new Date(),
      },
      timestamp: new Date(),
    });
  }

  // ── Start All Agents ─────────────────────────────────────────────────────

  async startAllAgents(): Promise<void> {
    if (this.running) {
      log.warn('[Orchestrator] Already running');
      return;
    }

    this.running = true;
    log.info('[Orchestrator] Starting autonomous orchestrator');

    // Start heartbeat monitoring
    this.startHeartbeat();

    // Start each enabled agent
    for (const agent of AGENTS) {
      if (agent.enabled) {
        this.startAgent(agent);
      }
    }

    log.info('[Orchestrator] All agents started');
  }

  // ── Start Single Agent ────────────────────────────────────────────────────

  private startAgent(agent: AgentDefinition): void {
    if (this.agentIntervals.has(agent.name)) {
      return; // Already running
    }

    log.info('[Orchestrator] Starting agent', { agent: agent.name, autonomous: agent.autonomous });

    // Run immediately
    this.runAgent(agent).catch(err => {
      log.error('[Orchestrator] Agent failed', { agent: agent.name, error: err });
    });

    // Schedule periodic runs (based on agent type)
    const intervalMs = this.getAgentInterval(agent.name);
    const interval = setInterval(() => {
      if (this.running && this.config.enabled) {
        this.runAgent(agent).catch(err => {
          log.error('[Orchestrator] Agent failed', { agent: agent.name, error: err });
        });
      }
    }, intervalMs);

    this.agentIntervals.set(agent.name, interval);
  }

  // ── Run Single Agent ─────────────────────────────────────────────────────

  private async runAgent(agent: AgentDefinition): Promise<void> {
    const start = Date.now();

    log.debug(`[${agent.name}] Running`);

    try {
      await agent.run();

      const duration = Date.now() - start;
      log.debug(`[${agent.name}] Completed`, { durationMs: duration });

      // Record success
      await sharedMemory.set(
        `agent:last_run:${agent.name}`,
        {
          success: true,
          duration,
          timestamp: new Date(),
        },
        3600
      );
    } catch (error) {
      const duration = Date.now() - start;
      log.error(`[${agent.name}] Failed`, { error: error instanceof Error ? error : String(error), durationMs: duration });

      // Record failure
      await sharedMemory.set(
        `agent:last_run:${agent.name}`,
        {
          success: false,
          error: String(error),
          duration,
          timestamp: new Date(),
        },
        3600
      );
    }
  }

  // ── Get Agent Interval ─────────────────────────────────────────────────

  private getAgentInterval(agentName: string): number {
    const intervals: Record<string, number> = {
      'demand-signal-agent': 5 * 60 * 1000,      // 5 min
      'scarcity-agent': 60 * 1000,                 // 1 min
      'personalization-agent': 15 * 60 * 1000,    // 15 min
      'attribution-agent': 30 * 60 * 1000,        // 30 min
      'adaptive-scoring-agent': 60 * 60 * 1000,   // 1 hour
      'feedback-loop-agent': 60 * 60 * 1000,      // 1 hour
      'network-effect-agent': 30 * 60 * 1000,      // 30 min
      'revenue-attribution-agent': 60 * 60 * 1000, // 1 hour
    };
    return intervals[agentName] || 60 * 1000;
  }

  // ── Heartbeat Monitoring ────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      await this.performHeartbeat();
    }, this.config.heartbeatIntervalMs);
  }

  private async performHeartbeat(): Promise<void> {
    const swarmStatus = await getSwarmCoordinator().status();

    // Check action count for emergency stop
    this.actionCount = swarmStatus.consecutiveActions || 0;

    if (this.actionCount >= this.config.emergencyStopThreshold) {
      await this.emergencyStop(`Action count exceeded threshold: ${this.actionCount}`);
      return;
    }

    // Log heartbeat
    log.debug('[Orchestrator] Heartbeat', {
      healthy: swarmStatus.healthy,
      total: swarmStatus.totalAgents,
      actions: this.actionCount,
    });

    // Store status
    await sharedMemory.set('orchestrator:heartbeat', {
      timestamp: new Date(),
      healthy: swarmStatus.healthy,
      total: swarmStatus.totalAgents,
      actions: this.actionCount,
    }, 300);
  }

  // ── Execute Dangerous Action ─────────────────────────────────────────────

  async executeDangerousAction(
    actionType: string,
    payload: Record<string, unknown>,
    agentName: string
  ): Promise<boolean> {
    if (!this.config.enabled) {
      log.warn('[Orchestrator] Autonomous mode not enabled');
      return false;
    }

    // Find agent
    const agent = AGENTS.find(a => a.name === agentName);
    if (!agent) {
      log.error('[Orchestrator] Unknown agent', { agent: agentName });
      return false;
    }

    // Check if agent can execute this action
    if (!agent.dangerousActions.includes(actionType)) {
      log.warn('[Orchestrator] Agent cannot execute action', { agent: agentName, action: actionType });
      return false;
    }

    // Execute action
    log.warn('[Orchestrator] DANGEROUS ACTION', { action: actionType, agent: agentName });
    const result = await actionExecutor.execute({
      type: actionType as any,
      target: payload.target as string || 'system',
      payload,
      agent: agentName,
      skipPermission: true,
      risk: 'high',
    });

    if (result) {
      this.actionCount++;
    }

    return result;
  }

  // ── Get Status ──────────────────────────────────────────────────────────

  async getStatus(): Promise<{
    running: boolean;
    autonomous: boolean;
    agentCount: number;
    healthyAgents: number;
    actionCount: number;
    config: AutonomousConfig;
  }> {
    const swarmStatus = await getSwarmCoordinator().status();

    return {
      running: this.running,
      autonomous: this.config.enabled,
      agentCount: AGENTS.filter(a => a.enabled).length,
      healthyAgents: swarmStatus.healthy,
      actionCount: this.actionCount,
      config: this.config,
    };
  }

  // ── Stop ────────────────────────────────────────────────────────────────

  async stop(): Promise<void> {
    log.info('[Orchestrator] Stopping orchestrator');
    this.running = false;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const [name, interval] of this.agentIntervals) {
      clearInterval(interval);
    }
    this.agentIntervals.clear();

    log.info('[Orchestrator] Stopped');
  }
}

// ── Singleton Instance ─────────────────────────────────────────────────────────

let orchestratorInstance: AutonomousOrchestrator | null = null;

export function getAutonomousOrchestrator(): AutonomousOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new AutonomousOrchestrator();
  }
  return orchestratorInstance;
}

// ── Quick Start Functions ─────────────────────────────────────────────────────

export async function startAutonomousMode(): Promise<void> {
  const orchestrator = getAutonomousOrchestrator();
  await orchestrator.enableFullAutonomy();
  await orchestrator.startAllAgents();
}

export async function stopAutonomousMode(): Promise<void> {
  const orchestrator = getAutonomousOrchestrator();
  await orchestrator.disableAutonomy();
  await orchestrator.stop();
}

// ── Dangerous Action Helpers ──────────────────────────────────────────────────

export async function executeAutonomousAction(
  actionType: 'adjust_price' | 'send_nudge' | 'pause_strategy' | 'trigger_revival' | 'alert_support',
  payload: Record<string, unknown>
): Promise<boolean> {
  const orchestrator = getAutonomousOrchestrator();
  const agentMap: Record<string, string> = {
    adjust_price: 'demand-signal-agent',
    send_nudge: 'personalization-agent',
    pause_strategy: 'feedback-loop-agent',
    trigger_revival: 'network-effect-agent',
    alert_support: 'revenue-attribution-agent',
  };

  const agentName = agentMap[actionType];
  if (!agentName) {
    log.error('[Orchestrator] Unknown action type', { action: actionType });
    return false;
  }

  return orchestrator.executeDangerousAction(actionType, payload, agentName);
}
