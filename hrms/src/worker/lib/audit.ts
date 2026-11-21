import { auditLog } from '../db/schema';
import type { DB } from './db';

export async function audit(
  db: DB,
  companyId: string,
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  data?: unknown,
) {
  await db.insert(auditLog).values({ companyId, actorId, action, entity, entityId, data: data ?? null });
}
