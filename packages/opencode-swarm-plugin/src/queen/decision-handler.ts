export interface DecisionDeps {
  sendMail: (params: any) => Promise<void>;
  eventStore: { emit: (type: string, data: any) => void };
  memoryRecall: (query: string, opts?: { limit?: number }) => Promise<any[]>;
}

export interface DecisionResult {
  action: "approved" | "rejected" | "deferred";
  reason: string;
  replyMessage: any;
}

export interface DecisionHandler {
  handleDiscovery(msg: any): Promise<DecisionResult>;
  handleDecisionRequest(msg: any): Promise<DecisionResult>;
  handleHelpRequest(msg: any): Promise<DecisionResult>;
}

const buildContextUpdate = (records: any[]) => {
  const updates = records.map((record) => {
    if (typeof record === "string") return record;
    if (record?.info) return record.info;
    if (record?.text) return record.text;
    return JSON.stringify(record);
  });
  return updates.join("\n\n");
};

export function createDecisionHandler(deps: DecisionDeps): DecisionHandler {
  const handleDiscovery = async (msg: any): Promise<DecisionResult> => {
    const approved = msg.priority <= 3;
    const replyMessage = approved
      ? {
          tag: "APPROVED",
          beadId: msg.beadId,
          decision: msg.title,
          reason: "Discovery accepted",
        }
      : {
          tag: "REJECTED",
          beadId: msg.beadId,
          decision: msg.title,
          reason: "Priority too low for scope",
        };

    const action = approved ? "approved" : "rejected";
    const reason = approved ? "priority_in_scope" : "priority_out_of_scope";

    deps.eventStore.emit("queen_decision_made", {
      beadId: msg.beadId,
      action,
      reason,
      tag: msg.tag,
    });

    return { action, reason, replyMessage };
  };

  const handleDecisionRequest = async (msg: any): Promise<DecisionResult> => {
    const hasRecommendation =
      typeof msg.recommendation === "string" && msg.recommendation.length > 0;
    const replyMessage = hasRecommendation
      ? {
          tag: "APPROVED",
          beadId: msg.beadId,
          decision: msg.recommendation,
          reason: "Accepted recommendation",
        }
      : {
          tag: "DEFERRED",
          beadId: msg.beadId,
          reason: "Recommendation required before decision",
          waitingFor: "recommendation",
        };

    const action = hasRecommendation ? "approved" : "deferred";
    const reason = hasRecommendation
      ? "recommendation_accepted"
      : "recommendation_missing";

    deps.eventStore.emit("queen_decision_made", {
      beadId: msg.beadId,
      action,
      reason,
      tag: msg.tag,
    });

    return { action, reason, replyMessage };
  };

  const handleHelpRequest = async (msg: any): Promise<DecisionResult> => {
    const hasRecommendation =
      typeof msg.recommendation === "string" && msg.recommendation.length > 0;

    if (hasRecommendation) {
      const replyMessage = {
        tag: "APPROVED",
        beadId: msg.beadId,
        decision: msg.recommendation,
        reason: "Recommendation provided",
      };

      deps.eventStore.emit("queen_decision_made", {
        beadId: msg.beadId,
        action: "approved",
        reason: "recommendation_provided",
        tag: msg.tag,
      });

      return {
        action: "approved",
        reason: "recommendation_provided",
        replyMessage,
      };
    }

    const memories = await deps.memoryRecall(`${msg.question}\n${msg.context}`, {
      limit: 5,
    });

    if (memories.length > 0) {
      const replyMessage = {
        tag: "CONTEXT",
        beadId: msg.beadId,
        update: buildContextUpdate(memories),
      };

      deps.eventStore.emit("queen_decision_made", {
        beadId: msg.beadId,
        action: "approved",
        reason: "context_supplied",
        tag: msg.tag,
      });

      return {
        action: "approved",
        reason: "context_supplied",
        replyMessage,
      };
    }

    const replyMessage = {
      tag: "DEFERRED",
      beadId: msg.beadId,
      reason: "No immediate guidance found",
      waitingFor: "additional_context",
    };

    deps.eventStore.emit("queen_decision_made", {
      beadId: msg.beadId,
      action: "deferred",
      reason: "context_missing",
      tag: msg.tag,
    });

    return { action: "deferred", reason: "context_missing", replyMessage };
  };

  return {
    handleDiscovery,
    handleDecisionRequest,
    handleHelpRequest,
  };
}
