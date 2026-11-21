import {
  pgTable, text, timestamp, boolean, uuid, date, numeric, integer, jsonb, pgEnum, uniqueIndex, index,
} from 'drizzle-orm/pg-core';

/* ---------- Better Auth tables (login accounts) ---------- */

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/* ---------- HRMS tables. Every row carries company_id. ---------- */

export const roleEnum = pgEnum('role', ['admin', 'hr', 'manager', 'employee']);
export const leaveStatusEnum = pgEnum('leave_status', ['pending', 'approved', 'rejected', 'cancelled']);

export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  // Weekly offs as day numbers, 0 = Sunday ... 6 = Saturday
  weeklyOffs: integer('weekly_offs').array().notNull().default([0]),
  // Plain-text HR policy used by the AI assistant
  policyText: text('policy_text').notNull().default(''),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const employees = pgTable('employees', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  employeeCode: text('employee_code'),
  fullName: text('full_name').notNull(),
  email: text('email').notNull(),
  designation: text('designation'),
  department: text('department'),
  managerId: uuid('manager_id'),
  role: roleEnum('role').notNull().default('employee'),
  dateOfJoining: date('date_of_joining'),
  status: text('status').notNull().default('active'), // active | exited
  mustChangePassword: boolean('must_change_password').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('employees_company_email').on(t.companyId, t.email),
  uniqueIndex('employees_user').on(t.userId),
  index('employees_manager').on(t.managerId),
]);

export const leaveTypes = pgTable('leave_types', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  code: text('code').notNull(),
  annualQuota: numeric('annual_quota', { precision: 5, scale: 1 }).notNull().default('0'),
  active: boolean('active').notNull().default(true),
}, (t) => [uniqueIndex('leave_types_company_code').on(t.companyId, t.code)]);

export const leaveRequests = pgTable('leave_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  leaveTypeId: uuid('leave_type_id').notNull().references(() => leaveTypes.id),
  fromDate: date('from_date').notNull(),
  toDate: date('to_date').notNull(),
  halfDay: boolean('half_day').notNull().default(false),
  days: numeric('days', { precision: 5, scale: 1 }).notNull(),
  reason: text('reason'),
  status: leaveStatusEnum('status').notNull().default('pending'),
  approverId: uuid('approver_id').references(() => employees.id),
  decisionNote: text('decision_note'),
  decidedAt: timestamp('decided_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('leave_requests_company_status').on(t.companyId, t.status), index('leave_requests_employee').on(t.employeeId)]);

export const holidays = pgTable('holidays', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  name: text('name').notNull(),
}, (t) => [uniqueIndex('holidays_company_date').on(t.companyId, t.date)]);

export const attendance = pgTable('attendance', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  checkIn: timestamp('check_in', { withTimezone: true }),
  checkOut: timestamp('check_out', { withTimezone: true }),
}, (t) => [uniqueIndex('attendance_employee_date').on(t.employeeId, t.date)]);

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  employeeId: uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  r2Key: text('r2_key').notNull(),
  contentType: text('content_type'),
  size: integer('size').notNull(),
  uploadedBy: uuid('uploaded_by').references(() => employees.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  data: jsonb('data'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('audit_company_created').on(t.companyId, t.createdAt)]);
