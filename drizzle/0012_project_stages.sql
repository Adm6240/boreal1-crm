CREATE TABLE `project_stages` (
	`client_id` text NOT NULL,
	`project_key` text NOT NULL,
	`project_name` text NOT NULL,
	`stage` text NOT NULL,
	`source` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `history_clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_stages_project` ON `project_stages` (`client_id`,`project_key`);--> statement-breakpoint
CREATE INDEX `idx_project_stages_stage` ON `project_stages` (`stage`);
