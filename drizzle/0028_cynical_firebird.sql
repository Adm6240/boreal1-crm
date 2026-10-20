CREATE TABLE `crm_reset_rows` (
	`reset_id` text NOT NULL,
	`entity` text NOT NULL,
	`row_key` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`reset_id`) REFERENCES `crm_reset_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_crm_reset_row` ON `crm_reset_rows` (`reset_id`,`entity`,`row_key`);--> statement-breakpoint
CREATE TABLE `crm_reset_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` text NOT NULL,
	`restored_at` text
);
