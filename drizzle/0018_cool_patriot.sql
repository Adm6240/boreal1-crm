CREATE TABLE `inventory_import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`filename` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`author_id` text NOT NULL,
	`created_at` text NOT NULL,
	`applied_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_import_fingerprint` ON `inventory_import_batches` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `inventory_import_items` (
	`item_id` text PRIMARY KEY NOT NULL,
	`identity_key` text NOT NULL,
	`batch_id` text NOT NULL,
	`status` text NOT NULL,
	`source_balance` integer,
	`history_net` integer NOT NULL,
	`reason` text NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `inventory_import_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_import_identity` ON `inventory_import_items` (`identity_key`);--> statement-breakpoint
CREATE TABLE `inventory_import_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`item_id` text,
	`record_key` text NOT NULL,
	`status` text NOT NULL,
	`date` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `inventory_import_batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_inventory_import_record` ON `inventory_import_lines` (`record_key`);--> statement-breakpoint
CREATE INDEX `idx_inventory_import_item` ON `inventory_import_lines` (`item_id`);