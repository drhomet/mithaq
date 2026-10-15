import { auditLog } from './audit-log/audit-log.ts'
import { backofficeLog } from './backoffice-log/backoffice-log.ts'

export const kayan = [auditLog, backofficeLog] as const
