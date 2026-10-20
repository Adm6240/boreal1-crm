CREATE TABLE `inventory_import_trash` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`filename` text NOT NULL,
	`summary` text NOT NULL,
	`status` text NOT NULL,
	`removed_by` text NOT NULL,
	`removed_at` text NOT NULL,
	`restored_at` text
);
--> statement-breakpoint
CREATE TABLE `inventory_import_trash_rows` (
	`trash_id` text NOT NULL,
	`entity` text NOT NULL,
	`row_key` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`trash_id`) REFERENCES `inventory_import_trash`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_trash_row` ON `inventory_import_trash_rows` (`trash_id`,`entity`,`row_key`);