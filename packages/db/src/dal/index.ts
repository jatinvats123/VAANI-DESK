import type { Database } from "../client.js";
import { createSystemDal, type SystemDal } from "./system.js";
import { createTenantDal, type TenantDal } from "./tenant.js";

export interface Dal {
  /** Narrow unscoped operations: webhooks, auth, business bootstrap/routing. */
  system: SystemDal;
  /** Everything else — pre-scoped to one tenant. */
  forBusiness: (businessId: string) => TenantDal;
}

export function createDal(db: Database): Dal {
  return {
    system: createSystemDal(db),
    forBusiness: (businessId: string) => createTenantDal(db, businessId),
  };
}

export { createSystemDal, createTenantDal };
export type { SystemDal, TenantDal };
export { createEvalStore, type EvalStore } from "./evals.js";
export type {
  AuditInput,
  CompleteCallInput,
  CreateBookingInput,
  StartCallInput,
} from "./tenant.js";
