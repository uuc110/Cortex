# Event Type Mapping: swarm-tools → Cortex Fork

**Reference file:** `cortex-refs/swarm-tools/packages/swarm-mail/src/streams/events.ts`

---

## Existing swarm-tools Event Types (56 total)

All events extend `BaseEventSchema` (Zod-validated) with common fields:
- `id?: number` (auto-generated)
- `type: string` (discriminator)
- `project_key: string`
- `timestamp: number` (Unix ms)
- `sequence?: number` (auto-generated ordering)

### 1. Agent Lifecycle (2 types)

| Event Type | Schema | Key Fields |
|-----------|--------|------------|
| `agent_registered` | `AgentRegisteredEventSchema` | `agent_name`, `program`, `model`, `task_description` |
| `agent_active` | `AgentActiveEventSchema` | `agent_name` |

### 2. Messages (5 types)

| Event Type | Schema | Key Fields |
|-----------|--------|------------|
| `message_sent` | `MessageSentEventSchema` | `from_agent`, `to_agents[]`, `subject`, `body`, `thread_id`, `importance`, `ack_required`, `epic_id`, `bead_id`, `message_type` |
| `message_read` | `MessageReadEventSchema` | `message_id`, `agent_name` |
| `message_acked` | `MessageAckedEventSchema` | `message_id`, `agent_name` |
| `thread_created` | `ThreadCreatedEventSchema` | `thread_id`, `epic_id`, `initial_subject`, `creator_agent` |
| `thread_activity` | `ThreadActivityEventSchema` | `thread_id`, `message_count`, `participant_count`, `last_message_agent`, `has_unread` |

### 3. File Reservations (3 types)

| Event Type | Schema | Key Fields |
|-----------|--------|------------|
| `file_reserved` | `FileReservedEventSchema` | `agent_name`, `paths[]`, `reason`, `exclusive`, `ttl_seconds`, `expires_at`, `epic_id`, `bead_id`, `is_retry`, `conflict_agent` |
| `file_released` | `FileReleasedEventSchema` | `agent_name`, `target_agent`, `release_all`, `paths[]`, `reservation_ids[]`, `hold_duration_ms`, `files_modified` |
| `file_conflict` | `FileConflictEventSchema` | `requesting_agent`, `holding_agent`, `paths[]`, `resolution` (wait/force/abort) |

### 4. Task Execution (4 types)

| Event Type | Schema | Key Fields |
|-----------|--------|------------|
| `task_started` | `TaskStartedEventSchema` | `agent_name`, `bead_id`, `epic_id` |
| `task_progress` | `TaskProgressEventSchema` | `agent_name`, `bead_id`, `progress_percent`, `message`, `files_touched[]` |
| `task_completed` | `TaskCompletedEventSchema` | `agent_name`, `bead_id`, `summary`, `files_touched[]`, `success` |
| `task_blocked` | `TaskBlockedEventSchema` | `agent_name`, `bead_id`, `reason` |

### 5. Eval/Learning (3 types)

| Event Type | Schema | Key Fields |
|-----------|--------|------------|
| `decomposition_generated` | `DecompositionGeneratedEventSchema` | `epic_id`, `task`, `strategy`, `epic_title`, `subtasks[]`, `recovery_context` |
| `subtask_outcome` | `SubtaskOutcomeEventSchema` | `epic_id`, `bead_id`, `planned_files[]`, `actual_files[]`, `duration_ms`, `error_count`, `retry_count`, `success`, `scope_violation`, `commit` |
| `human_feedback` | `HumanFeedbackEventSchema` | `epic_id`, `accepted`, `modified`, `notes` |

### 6. Checkpoint & Recovery (4 types)

| Event Type | Schema | Key Fields |
|-----------|--------|------------|
| `swarm_checkpointed` | `SwarmCheckpointedEventSchema` | `epic_id`, `bead_id`, `strategy`, `files[]`, `dependencies[]`, `directives`, `recovery`, `trigger`, `context_tokens_before/after` |
| `swarm_recovered` | `SwarmRecoveredEventSchema` | `epic_id`, `bead_id`, `recovered_from_checkpoint`, `recovery_duration_ms`, `files_restored[]` |
| `checkpoint_created` | `CheckpointCreatedEventSchema` | `epic_id`, `bead_id`, `agent_name`, `checkpoint_id`, `trigger`, `progress_percent`, `files_snapshot[]` |
| `context_compacted` | `ContextCompactedEventSchema` | `agent_name`, `tokens_before`, `tokens_after`, `compression_ratio`, `summary_length` |

### 7. Swarm Lifecycle (6 types)

| Event Type | Schema | Key Fields |
|-----------|--------|------------|
| `swarm_started` | `SwarmStartedEventSchema` | `epic_id`, `epic_title`, `strategy`, `subtask_count`, `total_files`, `coordinator_agent` |
| `worker_spawned` | `WorkerSpawnedEventSchema` | `epic_id`, `bead_id`, `worker_agent`, `subtask_title`, `files_assigned[]`, `spawn_order`, `is_parallel` |
| `worker_completed` | `WorkerCompletedEventSchema` | `epic_id`, `bead_id`, `worker_agent`, `success`, `duration_ms`, `files_touched[]`, `error_message` |
| `review_started` | `ReviewStartedEventSchema` | `epic_id`, `bead_id`, `attempt` |
| `review_completed` | `ReviewCompletedEventSchema` | `epic_id`, `bead_id`, `status` (approved/needs_changes/blocked), `attempt`, `duration_ms` |
| `swarm_completed` | `SwarmCompletedEventSchema` | `epic_id`, `epic_title`, `success`, `total_duration_ms`, `subtasks_completed`, `subtasks_failed`, `total_files_touched[]` |

### 8. Hive/Cell (6 types)

| Event Type | Schema | Key Fields |
|-----------|--------|------------|
| `cell_created` | `CellCreatedEventSchema` | `cell_id`, `title`, `description`, `issue_type`, `priority`, `parent_id`, `created_by` |
| `cell_updated` | `CellUpdatedEventSchema` | `cell_id`, `fields_changed[]`, `updated_by` |
| `cell_status_changed` | `CellStatusChangedEventSchema` | `cell_id`, `old_status`, `new_status`, `reason`, `changed_by` |
| `cell_closed` | `CellClosedEventSchema` | `cell_id`, `reason`, `closed_by`, `duration_ms` |
| `epic_created` | `EpicCreatedEventSchema` | `epic_id`, `title`, `description`, `subtask_count`, `subtask_ids[]`, `created_by` |
| `hive_synced` | `HiveSyncedEventSchema` | `cells_synced`, `push_success`, `sync_duration_ms` |

### 9. Memory (5 types)

| Event Type | Schema | Key Fields |
|-----------|--------|------------|
| `memory_stored` | `MemoryStoredEventSchema` | `memory_id`, `content_preview`, `tags[]`, `auto_tagged`, `collection`, `embedding_model` |
| `memory_found` | `MemoryFoundEventSchema` | `query`, `result_count`, `top_score`, `search_duration_ms`, `used_fts` |
| `memory_updated` | `MemoryUpdatedEventSchema` | `memory_id`, `operation` (ADD/UPDATE/DELETE/NOOP), `reason`, `supersedes_id` |
| `memory_validated` | `MemoryValidatedEventSchema` | `memory_id`, `decay_reset` |
| `memory_deleted` | `MemoryDeletedEventSchema` | `memory_id`, `reason` |

### 10. CASS (3 types)

| Event Type | Schema | Key Fields |
|-----------|--------|------------|
| `cass_searched` | `CassSearchedEventSchema` | `query`, `agent_filter`, `days_filter`, `result_count`, `search_duration_ms` |
| `cass_viewed` | `CassViewedEventSchema` | `session_path`, `line_number`, `agent_type` |
| `cass_indexed` | `CassIndexedEventSchema` | `sessions_indexed`, `messages_indexed`, `duration_ms`, `full_rebuild` |

### 11. Skills (2 types)

| Event Type | Schema | Key Fields |
|-----------|--------|------------|
| `skill_loaded` | `SkillLoadedEventSchema` | `skill_name`, `skill_source` (global/project/bundled), `context_provided`, `content_length` |
| `skill_created` | `SkillCreatedEventSchema` | `skill_name`, `skill_scope` (global/project), `description` |

### 12. Decision Trace (1 type)

| Event Type | Schema | Key Fields |
|-----------|--------|------------|
| `decision_recorded` | `DecisionRecordedEventSchema` | `decision_id`, `decision_type`, `epic_id`, `bead_id`, `rationale_length`, `precedent_count` |

### 13. Compaction (3 types)

| Event Type | Schema | Key Fields |
|-----------|--------|------------|
| `compaction_triggered` | `CompactionTriggeredEventSchema` | `session_id`, `trigger` (auto/manual/context_limit), `context_size_before` |
| `swarm_detected` | `SwarmDetectedEventSchema` | `session_id`, `confidence` (high/medium/low/none), `detection_source`, `epic_id`, `reasons[]` |
| `context_injected` | `ContextInjectedEventSchema` | `session_id`, `context_type`, `content_length`, `injection_method` |

### 14. Coordinator Session (4 types)

| Event Type | Schema | Key Fields |
|-----------|--------|------------|
| `coordinator_decision` | `CoordinatorDecisionEventSchema` | `session_id`, `epic_id`, `decision_type` (10 subtypes), `payload` |
| `coordinator_violation` | `CoordinatorViolationEventSchema` | `session_id`, `epic_id`, `violation_type` (4 subtypes), `payload` |
| `coordinator_outcome` | `CoordinatorOutcomeEventSchema` | `session_id`, `epic_id`, `outcome_type` (5 subtypes), `payload` |
| `coordinator_compaction` | `CoordinatorCompactionEventSchema` | `session_id`, `epic_id`, `compaction_type` (5 subtypes), `payload` |

### 15. Validation (3 types)

| Event Type | Schema | Key Fields |
|-----------|--------|------------|
| `validation_started` | `ValidationStartedEventSchema` | `epic_id`, `swarm_id`, `started_at` |
| `validation_issue` | `ValidationIssueEventSchema` | `epic_id`, `severity`, `category`, `message`, `location` |
| `validation_completed` | `ValidationCompletedEventSchema` | `epic_id`, `swarm_id`, `passed`, `issue_count`, `duration_ms` |

---

## New Event Types for Beads Bridge

These events track the bridge between swarm's internal cell tracking and the external `bd` CLI.

| Event Type | Schema | Key Fields | When Emitted |
|-----------|--------|------------|-------------|
| `beads_task_created` | `BeadsTaskCreatedEventSchema` | `bead_id`, `cell_id`, `title`, `type`, `priority`, `parent_bead_id`, `epic_id` | When `bd create` is called from swarm decomposition |
| `beads_dep_added` | `BeadsDepAddedEventSchema` | `source_bead_id`, `target_bead_id`, `dep_type` (one of bd's 18 types), `epic_id` | When `bd dep add` is called |
| `beads_dep_removed` | `BeadsDepRemovedEventSchema` | `source_bead_id`, `target_bead_id`, `dep_type`, `epic_id` | When `bd dep remove` is called |
| `beads_status_changed` | `BeadsStatusChangedEventSchema` | `bead_id`, `old_status`, `new_status`, `reason`, `changed_by` | When `bd update --status` is called |
| `beads_ready_changed` | `BeadsReadyChangedEventSchema` | `bead_ids[]`, `ready_count`, `blocked_count`, `epic_id` | After any `bd` operation that changes the ready set |
| `beads_closed` | `BeadsClosedEventSchema` | `bead_id`, `reason`, `commit_sha`, `duration_ms`, `epic_id` | When `bd close` is called |
| `beads_sync_completed` | `BeadsSyncCompletedEventSchema` | `beads_synced`, `conflicts`, `duration_ms` | When `bd sync` or git push completes |
| `beads_mapping_created` | `BeadsMappingCreatedEventSchema` | `cell_id`, `bead_id`, `epic_bead_id`, `mapping_type` (auto/manual) | When cell ↔ bead mapping is established |

### Beads Dependency Types (18 from bd CLI)

The `dep_type` field in `beads_dep_added` supports all 18 dependency types from the bd CLI:

| Type | Description | Example |
|------|-------------|---------|
| `blocks` | Task A blocks task B | Auth blocks Dashboard |
| `blocked-by` | Inverse of blocks | Dashboard blocked-by Auth |
| `depends-on` | Soft dependency | Tests depend-on Setup |
| `dependency-of` | Inverse of depends-on | Setup is dependency-of Tests |
| `parent` | Hierarchical parent | Epic is parent of Task |
| `child` | Hierarchical child | Task is child of Epic |
| `relates-to` | Related work | Login relates-to Signup |
| `duplicates` | Duplicate of | Issue A duplicates Issue B |
| `duplicated-by` | Inverse of duplicates | Issue B duplicated-by Issue A |
| `causes` | Root cause | Bug A causes Bug B |
| `caused-by` | Inverse of causes | Bug B caused-by Bug A |
| `requires` | Must have | Feature requires API |
| `required-by` | Inverse of requires | API required-by Feature |
| `tests` | Test relationship | Test tests Feature |
| `tested-by` | Inverse of tests | Feature tested-by Test |
| `implements` | Implementation of | PR implements Issue |
| `implemented-by` | Inverse | Issue implemented-by PR |
| `references` | General reference | Doc references Design |

---

## New Event Types for GSD Integration

These events track the GSD (Get Shit Done) structured execution framework.

| Event Type | Schema | Key Fields | When Emitted |
|-----------|--------|------------|-------------|
| `gsd_plan_created` | `GsdPlanCreatedEventSchema` | `plan_id`, `bead_id`, `epic_id`, `plan_path`, `task_count`, `wave_count`, `autonomous` | When PLAN.md is generated from swarm decomposition |
| `gsd_wave_started` | `GsdWaveStartedEventSchema` | `wave_number`, `epic_id`, `task_count`, `parallel_workers`, `files_in_scope[]` | When a wave of tasks begins parallel execution |
| `gsd_wave_completed` | `GsdWaveCompletedEventSchema` | `wave_number`, `epic_id`, `tasks_completed`, `tasks_failed`, `duration_ms` | When all tasks in a wave finish |
| `gsd_task_executed` | `GsdTaskExecutedEventSchema` | `task_name`, `bead_id`, `epic_id`, `wave_number`, `files_modified[]`, `commit_sha`, `success` | When a single GSD task completes |
| `gsd_verification_run` | `GsdVerificationRunEventSchema` | `epic_id`, `phase_num`, `verification_type` (task/phase), `must_haves_checked`, `artifacts_checked`, `key_links_checked` | When verification runs |
| `gsd_verification_passed` | `GsdVerificationPassedEventSchema` | `epic_id`, `phase_num`, `must_haves_passed`, `artifacts_passed`, `key_links_passed`, `total_checks` | When verification succeeds |
| `gsd_verification_failed` | `GsdVerificationFailedEventSchema` | `epic_id`, `phase_num`, `failures[]`, `fix_tasks_created`, `retry_count` | When verification fails |
| `gsd_state_updated` | `GsdStateUpdatedEventSchema` | `project_key`, `current_phase`, `current_wave`, `tasks_completed`, `tasks_remaining` | When STATE.md is updated |
| `gsd_checkpoint_gate` | `GsdCheckpointGateEventSchema` | `epic_id`, `gate_type` (human-verify/decision/human-action), `description`, `response` | When a human-in-the-loop gate is reached |
| `gsd_roadmap_phase_started` | `GsdRoadmapPhaseStartedEventSchema` | `project_key`, `phase_num`, `phase_name`, `epic_id`, `acceptance_criteria[]` | When a roadmap phase begins (Project Mode) |

---

## New Event Types for Queen/Worker Protocol

These events formalize the Cortex Queen/Worker protocol within the swarm event system.

| Event Type | Schema | Key Fields | When Emitted |
|-----------|--------|------------|-------------|
| `queen_decision_made` | `QueenDecisionMadeEventSchema` | `epic_id`, `decision_type` (approve_discovery/reject_discovery/resolve_conflict/promote_learning/assign_task), `bead_id`, `worker_id`, `rationale` | When Queen makes a coordination decision |
| `queen_review_completed` | `QueenReviewCompletedEventSchema` | `epic_id`, `bead_id`, `worker_id`, `verdict` (approved/needs_changes/blocked), `issues[]`, `attempt_number` | When Queen reviews worker output |
| `queen_learning_promoted` | `QueenLearningPromotedEventSchema` | `memory_id`, `from_tier` (short_term), `to_tier` (long_term), `reason`, `phase_num` | When Queen promotes verified learning |
| `worker_status_update` | `WorkerStatusUpdateEventSchema` | `bead_id`, `worker_id`, `status` (in_progress/stuck/blocked/done), `percent_complete`, `blockers[]`, `files[]` | When worker sends STATUS_UPDATE to Queen |
| `worker_discovery` | `WorkerDiscoveryEventSchema` | `bead_id`, `worker_id`, `child_bead_id`, `discovery_title`, `suggested_priority`, `description` | When worker discovers sub-work during execution |
| `worker_help_request` | `WorkerHelpRequestEventSchema` | `bead_id`, `worker_id`, `question`, `what_tried[]`, `options[]`, `recommendation` | When worker sends HELP_REQUEST to Queen |
| `worker_decision_request` | `WorkerDecisionRequestEventSchema` | `bead_id`, `worker_id`, `question`, `options[]`, `pros_cons`, `recommendation` | When worker sends DECISION_NEEDED to Queen |
| `worker_lifecycle_event` | `WorkerLifecycleEventSchema` | `bead_id`, `worker_id`, `phase` (pickup/orient/plan/execute/verify/learn/report/close), `duration_ms` | At each phase transition in worker lifecycle |
| `worker_guardrail_violation` | `WorkerGuardrailViolationEventSchema` | `bead_id`, `worker_id`, `violation_type` (cross_bead_mutation/epic_creation/scope_change/memory_promotion/reservation_override), `attempted_action`, `blocked` | When worker attempts something outside its guardrails |

---

## Cortex → Swarm Event Mapping

Maps Cortex's current 30 event types to their swarm equivalents. This shows which Cortex events are already covered by swarm and which need the new bridge types.

| Cortex Event Type | Swarm Equivalent | Status |
|-------------------|------------------|--------|
| `goal_received` | `swarm_started` | MAPPED — swarm_started covers the same lifecycle |
| `memory_queried` | `memory_found` | MAPPED — same concept, richer swarm schema |
| `decomposition_generated` | `decomposition_generated` | EXACT MATCH — identical event type |
| `tasks_created` | `epic_created` + `cell_created` (N times) | MAPPED — swarm has separate epic + cell events |
| `task_started` | `task_started` | EXACT MATCH |
| `task_completed` | `task_completed` | EXACT MATCH |
| `task_blocked` | `task_blocked` | EXACT MATCH |
| `task_progress` | `task_progress` | EXACT MATCH |
| `learning_stored` | `memory_stored` | MAPPED — swarm names it memory_stored |
| `goal_completed` | `swarm_completed` | MAPPED — swarm uses swarm_completed |
| `project_created` | *(NEW)* `gsd_roadmap_phase_started` | NEW — GSD integration |
| `research_completed` | *(no equivalent)* | NEW — keep Cortex type or add to GSD |
| `decision_recorded` | `decision_recorded` | EXACT MATCH |
| `roadmap_generated` | *(NEW)* `gsd_state_updated` | NEW — GSD integration |
| `phase_started` | *(NEW)* `gsd_roadmap_phase_started` | NEW — GSD integration |
| `phase_completed` | *(NEW)* `gsd_wave_completed` | NEW — GSD integration |
| `phase_failed` | *(NEW)* `gsd_verification_failed` | NEW — GSD integration |
| `milestone_recorded` | *(NEW)* `gsd_verification_passed` | NEW — GSD integration |
| `project_completed` | `swarm_completed` (with project scope) | MAPPED |
| `project_paused` | *(NEW)* `gsd_state_updated` | NEW — state tracking |
| `project_resumed` | *(NEW)* `gsd_state_updated` | NEW — state tracking |
| `mail_sent` | `message_sent` | MAPPED — naming difference (Cortex: mail_*, swarm: message_*) |
| `mail_read` | `message_read` | MAPPED |
| `mail_acked` | `message_acked` | MAPPED |
| `agent_registered` | `agent_registered` | EXACT MATCH |
| `agent_heartbeat` | `agent_active` | MAPPED — same concept, different name |
| `reservation_created` | `file_reserved` | MAPPED |
| `reservation_released` | `file_released` | MAPPED |
| `file_conflict` | `file_conflict` | EXACT MATCH |
| `thread_created` | `thread_created` | EXACT MATCH |
| `thread_activity` | `thread_activity` | EXACT MATCH |

### Summary

| Category | Count |
|----------|-------|
| Exact matches (same event type name) | 13 |
| Mapped (same concept, different name/schema) | 10 |
| New events needed (GSD/Beads/Queen-Worker) | 7 |
| **Total Cortex events covered** | **30/30** |

---

## Total Event Count After Fork

| Source | Count |
|--------|-------|
| Existing swarm-tools events | 56 |
| New: Beads bridge events | 8 |
| New: GSD integration events | 10 |
| New: Queen/Worker protocol events | 9 |
| **Total** | **83** |

All new events follow the same pattern:
- Extend `BaseEventSchema` (Zod-validated)
- Include `project_key` and `timestamp`
- Include `epic_id` and `bead_id` where applicable
- Use consistent field naming (snake_case)
- Support optional observability fields for duration, token counts, etc.

---

## Implementation Notes

### Adding New Events

1. Define Zod schema in `packages/swarm-mail/src/streams/events.ts`
2. Add to `AgentEventSchema` discriminated union
3. Export individual type alias
4. Add projection handlers in `packages/swarm-mail/src/streams/projections.ts` (if event creates/updates materialized views)
5. Add to event replay logic in `packages/swarm-mail/src/streams/store.ts`

### Event Versioning

swarm-tools uses Zod `.default()` and `.optional()` for backward compatibility. When extending events:
- Add new fields as `.optional()` to preserve old events
- Never remove fields from existing events
- If semantics change, create a new event type (don't reuse)

### Testing

Each new event type needs:
1. Schema validation test (valid event parses, invalid fails)
2. Projection test (event correctly updates materialized view)
3. Integration test (end-to-end: emit → store → query)

Use `createInMemorySwarmMail()` for tests (no file I/O).
