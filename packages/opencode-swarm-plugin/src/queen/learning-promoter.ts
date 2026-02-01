export interface LearningDeps {
  memoryRecall: (
    query: string,
    opts?: { limit?: number; collection?: string },
  ) => Promise<any[]>;
  memoryStore: (info: string, tags: string) => Promise<void>;
  eventStore: { emit: (type: string, data: any) => void };
}

export interface PromotionResult {
  promoted: number;
  skipped: number;
  errors: string[];
}

export interface LearningPromoter {
  promoteLearnings(
    candidates: Array<{ info: string; tags: string; confidence?: number; age?: number }>,
  ): Promise<PromotionResult>;
}

const CONFIDENCE_THRESHOLD = 0.7;
const AGE_THRESHOLD_DAYS = 30;

const isDuplicate = (records: any[]) =>
  records.some((record) =>
    typeof record?.similarity === "number" ? record.similarity > 0.95 : false,
  );

export function createLearningPromoter(deps: LearningDeps): LearningPromoter {
  const promoteLearnings = async (
    candidates: Array<{ info: string; tags: string; confidence?: number; age?: number }>,
  ): Promise<PromotionResult> => {
    let promoted = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const candidate of candidates) {
      const confidence = candidate.confidence ?? 0;
      const age = candidate.age ?? 0;

      if (confidence < CONFIDENCE_THRESHOLD || age > AGE_THRESHOLD_DAYS) {
        skipped += 1;
        continue;
      }

      try {
        const matches = await deps.memoryRecall(candidate.info, {
          limit: 3,
          collection: "long_term",
        });

        if (isDuplicate(matches)) {
          skipped += 1;
          continue;
        }

        await deps.memoryStore(candidate.info, candidate.tags);
        deps.eventStore.emit("learning_stored", {
          info: candidate.info,
          tags: candidate.tags,
        });
        promoted += 1;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown storage error";
        errors.push(message);
      }
    }

    return { promoted, skipped, errors };
  };

  return { promoteLearnings };
}
