import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import {sql} from 'drizzle-orm';

export const crmResetRuns = sqliteTable('crm_reset_runs', {
 id:text('id').primaryKey(),status:text('status').notNull(),summary:text('summary').notNull(),actorId:text('actor_id').notNull(),createdAt:text('created_at').notNull(),restoredAt:text('restored_at'),
});
export const crmResetRows = sqliteTable('crm_reset_rows', {
 resetId:text('reset_id').notNull().references(()=>crmResetRuns.id),entity:text('entity').notNull(),rowKey:text('row_key').notNull(),payload:text('payload').notNull(),
},t=>[uniqueIndex('idx_crm_reset_row').on(t.resetId,t.entity,t.rowKey)]);

export const serialReceipts = sqliteTable('inventory_serial_receipts', {
 id:text('id').primaryKey(),filename:text('filename').notNull(),date:text('date').notNull(),mode:text('mode').notNull(),payload:text('payload').notNull(),authorId:text('author_id').notNull(),createdAt:text('created_at').notNull(),
});
export const serialUnits = sqliteTable('inventory_serial_units', {
 id:text('id').primaryKey(),itemId:text('item_id').notNull().references(()=>inventoryItems.id),kind:text('kind').notNull(),serial:text('serial').notNull(),serialKey:text('serial_key').notNull(),seal:text('seal'),sealKey:text('seal_key'),
 parentId:text('parent_id'),originId:text('origin_id'),status:text('status').notNull().default('available'),revision:integer('revision').notNull().default(1),receiptId:text('receipt_id').notNull().references(()=>serialReceipts.id),payload:text('payload').notNull(),orderId:text('order_id').references(()=>clientOrders.id),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('idx_serial_identity').on(t.kind,t.serialKey),uniqueIndex('idx_serial_seal').on(t.sealKey),index('idx_serial_item').on(t.itemId,t.status),index('idx_serial_parent').on(t.parentId)]);
export const serialEvents = sqliteTable('inventory_serial_events', {
 id:text('id').primaryKey(),unitId:text('unit_id').notNull().references(()=>serialUnits.id),action:text('action').notNull(),expectedRevision:integer('expected_revision'),orderId:text('order_id').references(()=>clientOrders.id),payload:text('payload').notNull(),authorId:text('author_id').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('idx_serial_event_unit').on(t.unitId,t.createdAt)]);
export const serialShortages = sqliteTable('inventory_serial_shortages', {
 id:text('id').primaryKey(),equipmentId:text('equipment_id').notNull().references(()=>serialUnits.id),kind:text('kind').notNull(),activeKey:text('active_key'),removedId:text('removed_id'),replacementId:text('replacement_id'),orderId:text('order_id').references(()=>clientOrders.id),createdAt:text('created_at').notNull(),resolvedAt:text('resolved_at'),
},t=>[uniqueIndex('idx_serial_shortage_active').on(t.activeKey),index('idx_serial_shortage_equipment').on(t.equipmentId)]);

export const inventoryItems = sqliteTable('inventory_items', {
 id:text('id').primaryKey(),sku:text('sku').notNull(),name:text('name').notNull(),manufacturer:text('manufacturer').notNull().default(''),kind:text('kind').notNull(),condition:text('condition').notNull().default('unknown'),
 balance:integer('balance').notNull().default(0),minimum:integer('minimum').notNull().default(0),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('idx_inventory_sku').on(t.sku),check('inventory_nonnegative',sql`${t.balance} >= 0`)]);
export const inventoryKits = sqliteTable('inventory_kits', {
 id:text('id').primaryKey(),name:text('name').notNull(),components:text('components').notNull(),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('idx_inventory_kit_name').on(t.name)]);
export const inventoryMovements = sqliteTable('inventory_movements', {
 id:text('id').primaryKey(),itemId:text('item_id').notNull().references(()=>inventoryItems.id),delta:integer('delta').notNull(),date:text('date').notNull(),kind:text('kind').notNull(),orderId:text('order_id').references(()=>clientOrders.id),context:text('context').notNull(),note:text('note').notNull().default(''),revision:integer('revision').notNull().default(1),authorId:text('author_id').notNull(),createdAt:text('created_at').notNull(),
},t=>[uniqueIndex('idx_inventory_order_item').on(t.orderId,t.itemId),index('idx_inventory_movement_date').on(t.date),check('inventory_delta_nonzero',sql`${t.delta} != 0`)]);
export const inventoryMovementNotes = sqliteTable('inventory_movement_notes', {
 movementId:text('movement_id').primaryKey(),note:text('note').notNull(),revision:integer('revision').notNull(),updatedBy:text('updated_by').notNull(),updatedAt:text('updated_at').notNull(),
});

export const historyClients = sqliteTable('history_clients', {
  id: text('id').primaryKey(),
  legacyKey: text('legacy_key').notNull(),
  name: text('name').notNull(),
  state: text('state').notNull(),
  routeToken: text('route_token').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [uniqueIndex('idx_history_clients_legacy_key').on(table.legacyKey), uniqueIndex('idx_history_clients_route_token').on(table.routeToken)]);

export const historyEmails = sqliteTable('history_emails', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().references(() => historyClients.id),
  dedupeKey: text('dedupe_key').notNull(),
  subject: text('subject').notNull(),
  sender: text('sender').notNull(),
  recipients: text('recipients').notNull(),
  cc: text('cc').notNull(),
  sentAt: text('sent_at'),
  textBody: text('text_body').notNull(),
  htmlBody: text('html_body').notNull(),
  project: text('project').notNull(),
  source: text('source').notNull(),
  originalKey: text('original_key').notNull(),
  originalName: text('original_name').notNull(),
  authorId: text('author_id').notNull(),
  recordedAt: text('recorded_at').notNull(),
}, table => [uniqueIndex('idx_history_emails_dedupe').on(table.clientId, table.dedupeKey), index('idx_history_emails_client_date').on(table.clientId, table.sentAt)]);

export const historyAttachments = sqliteTable('history_attachments', {
  id: text('id').primaryKey(),
  emailId: text('email_id').notNull().references(() => historyEmails.id, {onDelete: 'cascade'}),
  objectKey: text('object_key').notNull(),
  name: text('name').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  contentId: text('content_id'),
  inline: integer('inline').notNull(),
}, table => [index('idx_history_attachments_email').on(table.emailId)]);

export const clientOrders = sqliteTable('client_orders', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().references(() => historyClients.id),
  projectKey: text('project_key').notNull(),
  payload: text('payload').notNull(),
  status: text('status').notNull(),
  orderRef: text('order_ref'),
  workflow: text('workflow').notNull().default('{}'),
  revision: integer('revision').notNull(),
  authorId: text('author_id').notNull(),
  updatedBy: text('updated_by').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [index('idx_client_orders_project').on(table.clientId, table.projectKey), uniqueIndex('idx_client_orders_ref').on(table.orderRef), index('idx_client_orders_date').on(table.clientId, table.createdAt), index('idx_client_orders_status').on(table.status)]);

export const clientProfiles = sqliteTable('client_profiles', {
  id: text('id').primaryKey().references(() => historyClients.id),
  cnpj: text('cnpj'),
  payload: text('payload').notNull(),
  revision: integer('revision').notNull(),
  originName: text('origin_name'),
  originState: text('origin_state'),
  authorId: text('author_id').notNull(),
  updatedBy: text('updated_by').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [uniqueIndex('idx_client_profiles_cnpj').on(table.cnpj)]);

export const appUsers = sqliteTable('app_users', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  consultantName: text('consultant_name'),
  avatarKey: text('avatar_key'),
  authUserId: text('auth_user_id'),
  userCode: text('user_code'),
  passwordHash: text('password_hash'),
  mustChangePassword: integer('must_change_password').notNull().default(1),
  active: integer('active').notNull().default(1),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [uniqueIndex('idx_app_users_email').on(table.email), uniqueIndex('idx_app_users_auth').on(table.authUserId), uniqueIndex('idx_app_users_code').on(table.userCode)]);

export const goalSettings = sqliteTable('goal_settings', {
  year: integer('year').primaryKey(),
  payload: text('payload').notNull(),
  updatedBy: text('updated_by').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const activitySettings = sqliteTable('activity_settings', {
  id: integer('id').primaryKey(),
  scheduleNext: integer('schedule_next').notNull().default(1),
  updatedBy: text('updated_by'),
  updatedAt: text('updated_at'),
});

export const appSessions = sqliteTable('app_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => appUsers.id),
  expiresAt: integer('expires_at').notNull(),
}, table => [index('idx_sessions_user').on(table.userId)]);
export const authAttempts = sqliteTable('auth_attempts', {
  key: text('key').primaryKey(),
  attempts: integer('attempts').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
export const authSettings = sqliteTable('auth_settings', {
  id: integer('id').primaryKey(),
  defaultHash: text('default_hash').notNull(),
});

export const importRecords = sqliteTable('import_records', {
 id: integer('id').primaryKey({autoIncrement:true}),
 kind: text('kind').notNull(), sourceKey: text('source_key').notNull(),
 clientId: text('client_id').references(()=>historyClients.id),
 payload: text('payload').notNull(), revision: integer('revision').notNull().default(1),
 authorId: text('author_id').notNull(), createdAt: text('created_at').notNull(),
}, t=>[uniqueIndex('idx_import_source').on(t.kind,t.sourceKey)]);
export const importBatches = sqliteTable('import_batches', {
 id: text('id').primaryKey(), filename:text('filename').notNull(),
 summary:text('summary').notNull(), authorId:text('author_id').notNull(), createdAt:text('created_at').notNull(),
});

export const marketPresence = sqliteTable('market_presence', {
 id: integer('id').primaryKey({autoIncrement:true}),
 state: text('state').notNull(), municipalityCode: text('municipality_code'), municipality: text('municipality').notNull(), municipalityKey: text('municipality_key').notNull(),
 region:text('region').notNull().default(''), acronym:text('acronym').notNull().default(''), legalNature:text('legal_nature').notNull().default(''), scope:text('scope').notNull().default(''),
 company: text('company').notNull(), companyKey: text('company_key').notNull(), sector: text('sector').notNull().default(''), note: text('note').notNull().default(''),
 authorId: text('author_id').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t=>[uniqueIndex('idx_market_presence_unique').on(t.state,t.municipalityKey,t.companyKey),index('idx_market_presence_state_city').on(t.state,t.municipalityKey),index('idx_market_presence_company').on(t.companyKey)]);

export const marketImportBatches = sqliteTable('market_import_batches', {
 id: text('id').primaryKey(), filename:text('filename').notNull(), state:text('state').notNull(), summary:text('summary').notNull(), authorId:text('author_id').notNull(), createdAt:text('created_at').notNull(),
}, t=>[index('idx_market_import_created').on(t.createdAt)]);

export const salesHistory = sqliteTable('sales_history', {
 year:integer('year').notNull(), consultantKey:text('consultant_key').notNull(), consultant:text('consultant').notNull(),month:integer('month').notNull(),amountCents:integer('amount_cents').notNull(),filename:text('filename').notNull(),updatedBy:text('updated_by').notNull(),updatedAt:text('updated_at').notNull(),
}, t=>[uniqueIndex('idx_sales_history_period').on(t.year,t.consultantKey,t.month)]);

export const projectStages = sqliteTable('project_stages', {
 clientId:text('client_id').notNull().references(()=>historyClients.id),projectKey:text('project_key').notNull(),projectName:text('project_name').notNull(),stage:text('stage').notNull(),source:text('source').notNull(),revision:integer('revision').notNull().default(1),updatedBy:text('updated_by').notNull(),updatedAt:text('updated_at').notNull(),
}, t=>[uniqueIndex('idx_project_stages_project').on(t.clientId,t.projectKey),index('idx_project_stages_stage').on(t.stage)]);

export const serviceEquipment = sqliteTable('service_equipment', {
 id:text('id').primaryKey(), serialKey:text('serial_key').notNull(), serial:text('serial').notNull(),
 orderId:text('order_id').references(()=>clientOrders.id), clientId:text('client_id').references(()=>historyClients.id),
 payload:text('payload').notNull(), createdAt:text('created_at').notNull(),
}, t=>[uniqueIndex('idx_service_equipment_serial').on(t.serialKey)]);
export const serviceOrders = sqliteTable('service_orders', {
 id:integer('id').primaryKey({autoIncrement:true}), requestKey:text('request_key').notNull(),
 serialKey:text('serial_key').notNull(), status:text('status').notNull(), activeKey:text('active_key'),
 payload:text('payload').notNull(), revision:integer('revision').notNull().default(1),
 createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(),
}, t=>[uniqueIndex('idx_service_request').on(t.requestKey),uniqueIndex('idx_service_active').on(t.activeKey),index('idx_service_serial').on(t.serialKey)]);

export const clientAccess = sqliteTable('client_access', {
 clientId:text('client_id').notNull().references(()=>historyClients.id),
 userId:text('user_id').notNull().references(()=>appUsers.id),
 grantedBy:text('granted_by').notNull(),
},t=>[uniqueIndex('idx_client_access').on(t.clientId,t.userId)]);
export const userActivities = sqliteTable('user_activities', {
 userId:text('user_id').primaryKey().references(()=>appUsers.id),
 cacheKey:text('cache_key'),
 payload:text('payload').notNull(),revision:integer('revision').notNull(),updatedAt:text('updated_at').notNull(),
});
export const securityEvents = sqliteTable('security_events', {
 id:integer('id').primaryKey({autoIncrement:true}),actorId:text('actor_id').notNull(),
 action:text('action').notNull(),target:text('target').notNull(),createdAt:text('created_at').notNull(),
},t=>[index('idx_security_events_date').on(t.createdAt)]);

export const inventoryImportBatches = sqliteTable('inventory_import_batches', {
 id:text('id').primaryKey(),fingerprint:text('fingerprint').notNull(),filename:text('filename').notNull(),payload:text('payload').notNull(),status:text('status').notNull(),revision:integer('revision').notNull().default(1),authorId:text('author_id').notNull(),createdAt:text('created_at').notNull(),appliedAt:text('applied_at'),
},t=>[uniqueIndex('idx_inventory_import_fingerprint').on(t.fingerprint)]);
export const inventoryImportItems = sqliteTable('inventory_import_items', {
 itemId:text('item_id').primaryKey().references(()=>inventoryItems.id),identityKey:text('identity_key').notNull(),batchId:text('batch_id').notNull().references(()=>inventoryImportBatches.id),status:text('status').notNull(),sourceBalance:integer('source_balance'),historyNet:integer('history_net').notNull(),reason:text('reason').notNull(),payload:text('payload').notNull(),revision:integer('revision').notNull().default(1),
},t=>[uniqueIndex('idx_inventory_import_identity').on(t.identityKey)]);
export const inventoryImportLines = sqliteTable('inventory_import_lines', {
 id:text('id').primaryKey(),batchId:text('batch_id').notNull().references(()=>inventoryImportBatches.id),itemId:text('item_id').references(()=>inventoryItems.id),recordKey:text('record_key').notNull(),status:text('status').notNull(),date:text('date').notNull(),payload:text('payload').notNull(),
},t=>[index('idx_inventory_import_record').on(t.recordKey),index('idx_inventory_import_item').on(t.itemId)]);
export const inventoryImportDrafts = sqliteTable('inventory_import_drafts', {
 batchId:text('batch_id').notNull().references(()=>inventoryImportBatches.id),identityKey:text('identity_key').notNull(),payload:text('payload').notNull(),
},t=>[uniqueIndex('idx_inventory_draft_item').on(t.batchId,t.identityKey)]);
export const inventoryImportTrash = sqliteTable('inventory_import_trash', {
 id:text('id').primaryKey(),batchId:text('batch_id').notNull(),filename:text('filename').notNull(),summary:text('summary').notNull(),status:text('status').notNull(),removedBy:text('removed_by').notNull(),removedAt:text('removed_at').notNull(),restoredAt:text('restored_at'),
});
export const inventoryImportTrashRows = sqliteTable('inventory_import_trash_rows', {
 trashId:text('trash_id').notNull().references(()=>inventoryImportTrash.id),entity:text('entity').notNull(),rowKey:text('row_key').notNull(),payload:text('payload').notNull(),
},t=>[uniqueIndex('idx_inventory_trash_row').on(t.trashId,t.entity,t.rowKey)]);
