import {
  classifyMessage,
  createMailEnvelope,
  parseCortexMessage,
} from "./message-types.js";

export interface MonitorConfig {
  projectKey: string;
  epicBeadId: string;
  pollIntervalMs?: number;
  maxIdlePolls?: number;
}

export interface InboxMessage {
  id: number;
  from: string;
  subject: string;
  body: string;
  thread_id?: string;
  importance?: string;
  created_at?: string;
}

export interface InboxResult {
  messages: InboxMessage[];
}

export interface QueenDeps {
  getInbox: (params: {
    projectPath: string;
    agentName: string;
    limit: number;
  }) => Promise<InboxResult>;
  sendMail: (params: {
    fromAgent: string;
    toAgents: string[];
    subject: string;
    body: string;
    threadId: string;
    importance: string;
    ackRequired: boolean;
  }) => Promise<void>;
  beadClient: {
    show: (id: string) => Promise<any>;
    list: (filter?: any) => Promise<any[]>;
    update: (id: string, data: any) => Promise<void>;
    close: (id: string, reason: string) => Promise<void>;
  };
  eventStore: {
    emit: (type: string, data: any) => void;
  };
  decisionHandler: {
    handleDiscovery: (msg: any) => Promise<{
      action: string;
      reason: string;
      replyMessage: any;
    }>;
    handleDecisionRequest: (msg: any) => Promise<{
      action: string;
      reason: string;
      replyMessage: any;
    }>;
    handleHelpRequest: (msg: any) => Promise<{
      action: string;
      reason: string;
      replyMessage: any;
    }>;
  };
  reviewHandler: {
    handleCompleted: (msg: any) => Promise<{
      status: string;
      issues?: any[];
      remainingAttempts?: number;
    }>;
  };
}

export interface MonitorStats {
  messagesProcessed: number;
  decisionsRouted: number;
  reviewsRouted: number;
  idlePolls: number;
}

export interface QueenMonitor {
  start(): Promise<void>;
  stop(): void;
  isRunning(): boolean;
  getStats(): MonitorStats;
  processOnce(): Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_MAX_IDLE_POLLS = 50;
const DEFAULT_INBOX_LIMIT = 25;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export function createQueenMonitor(
  config: MonitorConfig,
  deps: QueenDeps,
): QueenMonitor {
  const processedMessageIds = new Set<number>();
  const stats: MonitorStats = {
    messagesProcessed: 0,
    decisionsRouted: 0,
    reviewsRouted: 0,
    idlePolls: 0,
  };
  let running = false;

  const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxIdlePolls = config.maxIdlePolls ?? DEFAULT_MAX_IDLE_POLLS;

  const processMessage = async (message: InboxMessage) => {
    if (processedMessageIds.has(message.id)) return false;

    const tag = classifyMessage(message.subject);
    if (!tag) return false;

    const parsed = parseCortexMessage(message.subject, message.body);
    if (!parsed) return false;

    const meta = {
      from: message.from,
      threadId: message.thread_id ?? `thread-${message.id}`,
    };

    const enriched = { ...parsed, __meta: meta };

    processedMessageIds.add(message.id);
    stats.messagesProcessed += 1;

    switch (parsed.tag) {
      case "DONE": {
        stats.reviewsRouted += 1;
        await deps.reviewHandler.handleCompleted(enriched);
        return true;
      }
      case "DISCOVERY": {
        stats.decisionsRouted += 1;
        const result = await deps.decisionHandler.handleDiscovery(enriched);
        if (result.replyMessage) {
          const envelope = createMailEnvelope(
            result.replyMessage,
            "queen",
            [message.from],
            meta.threadId,
          );
          await deps.sendMail(envelope);
        }
        return true;
      }
      case "DECISION": {
        stats.decisionsRouted += 1;
        const result = await deps.decisionHandler.handleDecisionRequest(enriched);
        if (result.replyMessage) {
          const envelope = createMailEnvelope(
            result.replyMessage,
            "queen",
            [message.from],
            meta.threadId,
          );
          await deps.sendMail(envelope);
        }
        return true;
      }
      case "HELP": {
        stats.decisionsRouted += 1;
        const result = await deps.decisionHandler.handleHelpRequest(enriched);
        if (result.replyMessage) {
          const envelope = createMailEnvelope(
            result.replyMessage,
            "queen",
            [message.from],
            meta.threadId,
          );
          await deps.sendMail(envelope);
        }
        return true;
      }
      case "BLOCKED": {
        deps.eventStore.emit("task_blocked", {
          beadId: parsed.beadId,
          blocker: parsed.blocker,
        });
        return true;
      }
      case "STATUS": {
        deps.eventStore.emit("task_status", {
          beadId: parsed.beadId,
          status: parsed.status,
          percentComplete: parsed.percentComplete,
        });
        return true;
      }
      case "FILE": {
        console.info("FILE update", {
          beadId: parsed.beadId,
          files: parsed.files,
          changeType: parsed.changeType,
        });
        return true;
      }
      case "READY": {
        console.info("READY update", {
          beadId: parsed.beadId,
          dependentBeadIds: parsed.dependentBeadIds,
        });
        return true;
      }
      default: {
        return false;
      }
    }
  };

  const processOnce = async () => {
    const inbox = await deps.getInbox({
      projectPath: config.projectKey,
      agentName: "queen",
      limit: DEFAULT_INBOX_LIMIT,
    });

    let processedAny = false;
    for (const message of inbox.messages) {
      // eslint-disable-next-line no-await-in-loop
      const processed = await processMessage(message);
      if (processed) processedAny = true;
    }

    if (!processedAny) {
      stats.idlePolls += 1;
      if (stats.idlePolls >= maxIdlePolls) {
        running = false;
      }
    } else {
      stats.idlePolls = 0;
    }
  };

  const start = async () => {
    running = true;
    while (running) {
      // eslint-disable-next-line no-await-in-loop
      await processOnce();
      if (!running) break;
      // eslint-disable-next-line no-await-in-loop
      await sleep(pollIntervalMs);
    }
  };

  const stop = () => {
    running = false;
  };

  return {
    start,
    stop,
    isRunning: () => running,
    getStats: () => ({ ...stats }),
    processOnce,
  };
}
