CREATE TABLE `client_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`project_key` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`author_id` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `history_clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_client_orders_project` ON `client_orders` (`client_id`,`project_key`);--> statement-breakpoint
CREATE INDEX `idx_client_orders_date` ON `client_orders` (`client_id`,`created_at`);