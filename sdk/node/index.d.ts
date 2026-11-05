// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type CapabilityReference = { capabilityId: string; version: string; manifestDigest: string };
export type ExecutionTarget = { kind: 'capability'; capability: CapabilityReference }
  | { kind: 'composition'; compositionId: string; version: string; compositionDigest: string };
export type Execution = { executionId: string; state: 'accepted' | 'running' | 'auth_required' | 'succeeded' | 'failed' | 'timed_out' | 'outcome_unknown' | 'cancelled'; output?: Json; [key: string]: unknown };
export type ExecutionContext = { purpose: string; dataSubject?: string; emergency?: boolean; justification?: string };
export type RequestOptions = { method?: string; json?: Json; body?: BodyInit; contentType?: string; ifMatch?: string; idempotencyKey?: string; signal?: AbortSignal };
export type TicketContext = { active: false } | { active: true; context: { tenantId: string; executionId: string; purpose?: string; dataSubject?: string; emergency?: boolean; [key: string]: unknown }; [key: string]: unknown };
export function inputDigest(input: Json): string;
export class JuncturaError extends Error { status: number; code: string; requestId?: string; }
export function createJuncturaClient(options: { baseUrl: string; clientId: string; clientSecret: string; timeoutMs?: number; fetcher?: typeof fetch }): Readonly<{
  request(path: string, options?: RequestOptions): Promise<Response>;
  identity(): Promise<{ subject: string; tenantId: string; roles: string[]; [key: string]: unknown }>;
  createRecord(collection: string, data: Json): Promise<{ id: string; data: Json; [key: string]: unknown }>;
  getRecord(collection: string, id: string): Promise<{ id: string; data: Json; [key: string]: unknown }>;
  putObject(id: string, bytes: BodyInit): Promise<unknown>;
  getObject(id: string): Promise<ArrayBuffer>;
  workflowDefinitions(): Promise<unknown>;
  startWorkflow(definitionId: string, input: Json, idempotencyKey?: string): Promise<unknown>;
  discover(query?: { limit?: number; cursor?: string }): Promise<unknown>;
  execute(target: ExecutionTarget, input: Json, idempotencyKey?: string, context?: ExecutionContext): Promise<Execution>;
  redeemTicket(invocation: { authorization: string | undefined; invocationId: string; input: Json }): Promise<TicketContext>;
  execution(id: string): Promise<Execution>;
  waitForExecution(id: string, options?: { timeoutMs?: number; intervalMs?: number; signal?: AbortSignal }): Promise<Execution>;
}>;
