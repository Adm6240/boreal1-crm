CREATE TABLE `inventory_serial_events` (
	`id` text PRIMARY KEY NOT NULL,
	`unit_id` text NOT NULL,
	`action` text NOT NULL,
	`expected_revision` integer,
	`order_id` text,
	`payload` text NOT NULL,
	`author_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`unit_id`) REFERENCES `inventory_serial_units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `client_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_serial_event_unit` ON `inventory_serial_events` (`unit_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `inventory_serial_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`date` text NOT NULL,
	`mode` text NOT NULL,
	`payload` text NOT NULL,
	`author_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inventory_serial_shortages` (
	`id` text PRIMARY KEY NOT NULL,
	`equipment_id` text NOT NULL,
	`kind` text NOT NULL,
	`active_key` text,
	`removed_id` text,
	`replacement_id` text,
	`order_id` text,
	`created_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`equipment_id`) REFERENCES `inventory_serial_units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `client_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_serial_shortage_active` ON `inventory_serial_shortages` (`active_key`);--> statement-breakpoint
CREATE INDEX `idx_serial_shortage_equipment` ON `inventory_serial_shortages` (`equipment_id`);--> statement-breakpoint
CREATE TABLE `inventory_serial_units` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`kind` text NOT NULL,
	`serial` text NOT NULL,
	`serial_key` text NOT NULL,
	`seal` text,
	`seal_key` text,
	`parent_id` text,
	`origin_id` text,
	`status` text DEFAULT 'available' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`receipt_id` text NOT NULL,
	`payload` text NOT NULL,
	`order_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`receipt_id`) REFERENCES `inventory_serial_receipts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `client_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_serial_identity` ON `inventory_serial_units` (`kind`,`serial_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_serial_seal` ON `inventory_serial_units` (`seal_key`);--> statement-breakpoint
CREATE INDEX `idx_serial_item` ON `inventory_serial_units` (`item_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_serial_parent` ON `inventory_serial_units` (`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX idx_serial_kit_slot ON inventory_serial_units(parent_id,kind) WHERE parent_id IS NOT NULL AND status='available';
--> statement-breakpoint
CREATE TRIGGER serial_revision_guard BEFORE INSERT ON inventory_serial_events WHEN NEW.expected_revision IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM inventory_serial_units WHERE id=NEW.unit_id AND status='available' AND revision=NEW.expected_revision) THEN RAISE(ABORT,'serial_revision_conflict') END;
END;
--> statement-breakpoint
CREATE TRIGGER serial_balance_insert AFTER INSERT ON inventory_serial_units WHEN NEW.status='available' BEGIN
 SELECT CASE WHEN (SELECT COUNT(*) FROM inventory_serial_units WHERE item_id=NEW.item_id AND status='available') > (SELECT balance FROM inventory_items WHERE id=NEW.item_id) THEN RAISE(ABORT,'serial_balance') END;
END;
--> statement-breakpoint
CREATE TRIGGER serial_balance_update BEFORE UPDATE OF balance ON inventory_items BEGIN
 SELECT CASE WHEN NEW.balance < (SELECT COUNT(*) FROM inventory_serial_units WHERE item_id=NEW.id AND status='available') THEN RAISE(ABORT,'serial_balance') END;
END;
--> statement-breakpoint
CREATE TRIGGER serial_parent_insert BEFORE INSERT ON inventory_serial_units WHEN NEW.parent_id IS NOT NULL BEGIN
 SELECT CASE WHEN NEW.kind NOT IN ('battery','charger') OR NOT EXISTS(SELECT 1 FROM inventory_serial_units WHERE id=NEW.parent_id AND kind='equipment' AND status='available' AND json_extract(payload,'$.'||NEW.kind||'ItemId')=NEW.item_id) THEN RAISE(ABORT,'serial_parent') END;
END;
--> statement-breakpoint
CREATE TRIGGER serial_parent_update BEFORE UPDATE OF parent_id ON inventory_serial_units WHEN NEW.parent_id IS NOT NULL BEGIN
 SELECT CASE WHEN NEW.kind NOT IN ('battery','charger') OR NOT EXISTS(SELECT 1 FROM inventory_serial_units WHERE id=NEW.parent_id AND kind='equipment' AND status='available' AND json_extract(payload,'$.'||NEW.kind||'ItemId')=NEW.item_id) THEN RAISE(ABORT,'serial_parent') END;
END;
--> statement-breakpoint
CREATE TRIGGER serial_origin_immutable BEFORE UPDATE OF origin_id,serial_key,item_id,kind,receipt_id ON inventory_serial_units BEGIN
 SELECT RAISE(ABORT,'serial_origin_immutable');
END;
