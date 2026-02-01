import type { WorkerMailSender } from "./mail-sender.js";

export interface DiscoveryInput {
  title: string;
  description?: string;
  priority: number;
  parentBeadId: string;
}

export interface DiscoveryDeps {
  beadClient: {
    create: (args: any) => Promise<string>;
  };
  mailSender: WorkerMailSender;
  eventStore: { emit: (type: string, data: any) => void };
}

export type DiscoveryHandlerFn = (discovery: DiscoveryInput) => Promise<string>;

export function createDiscoveryHandler(deps: DiscoveryDeps): DiscoveryHandlerFn {
  return async (discovery) => {
    const childBeadId = await deps.beadClient.create({
      title: discovery.title,
      description: discovery.description,
      parentId: discovery.parentBeadId,
      priority: discovery.priority,
      type: "task",
    });

    await deps.mailSender.sendDiscovery(
      discovery.parentBeadId,
      childBeadId,
      discovery.title,
      discovery.priority,
      discovery.description ?? discovery.title,
    );

    deps.eventStore.emit("beads_task_created", {
      parentBeadId: discovery.parentBeadId,
      childBeadId,
      title: discovery.title,
      priority: discovery.priority,
    });

    return childBeadId;
  };
}
