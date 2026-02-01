export interface WorkerContext {
  bead: BeadInfo;
  epic: BeadInfo | null;
  siblings: BeadInfo[];
  dependencies: BeadInfo[];
  memoryContext: any[];
  projectPath: string;
  projectKey: string;
}

export interface BeadInfo {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  parentId?: string;
}

export interface ContextLoaderDeps {
  beadClient: {
    show: (id: string) => Promise<any>;
    list: (filter?: any) => Promise<any[]>;
    listDeps?: (id: string) => Promise<any[]>;
  };
  memoryRecall: (query: string, opts?: { limit?: number }) => Promise<any[]>;
  projectPath: string;
  projectKey: string;
}

export interface ContextLoader {
  loadWorkerContext(beadId: string): Promise<WorkerContext>;
}

function normalizeBead(raw: any, fallbackId?: string): BeadInfo {
  const id = typeof raw?.id === "string" ? raw.id : fallbackId ?? "unknown";
  const title = typeof raw?.title === "string" ? raw.title : "Unknown";
  const description = typeof raw?.description === "string" ? raw.description : "";
  const status = typeof raw?.status === "string" ? raw.status : "unknown";
  const priority = typeof raw?.priority === "number" ? raw.priority : 0;
  const parentId =
    typeof raw?.parentId === "string"
      ? raw.parentId
      : typeof raw?.parent_id === "string"
        ? raw.parent_id
        : undefined;

  return { id, title, description, status, priority, parentId };
}

export function createContextLoader(deps: ContextLoaderDeps): ContextLoader {
  async function loadWorkerContext(beadId: string): Promise<WorkerContext> {
    let bead: BeadInfo;

    try {
      const raw = await deps.beadClient.show(beadId);
      bead = normalizeBead(raw, beadId);
    } catch {
      bead = {
        id: beadId,
        title: "Unknown",
        description: "",
        status: "unknown",
        priority: 0,
      };
    }

    let epic: BeadInfo | null = null;
    if (bead.parentId) {
      try {
        const rawEpic = await deps.beadClient.show(bead.parentId);
        epic = normalizeBead(rawEpic, bead.parentId);
      } catch {
        epic = null;
      }
    }

    let siblings: BeadInfo[] = [];
    if (epic) {
      try {
        const rawSiblings = await deps.beadClient.list({ parentId: epic.id });
        siblings = rawSiblings
          .map((raw) => normalizeBead(raw))
          .filter((sib) => sib.id !== beadId);
      } catch {
        siblings = [];
      }
    }

    let dependencies: BeadInfo[] = [];
    if (deps.beadClient.listDeps) {
      try {
        const rawDeps = await deps.beadClient.listDeps(beadId);
        dependencies = rawDeps.map((raw) => normalizeBead(raw));
      } catch {
        dependencies = [];
      }
    }

    let memoryContext: any[] = [];
    try {
      const query = `${bead.title} ${bead.description}`.trim();
      memoryContext = await deps.memoryRecall(query, { limit: 10 });
    } catch {
      memoryContext = [];
    }

    return {
      bead,
      epic,
      siblings,
      dependencies,
      memoryContext,
      projectPath: deps.projectPath,
      projectKey: deps.projectKey,
    };
  }

  return { loadWorkerContext };
}
