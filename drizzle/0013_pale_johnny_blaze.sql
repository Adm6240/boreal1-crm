CREATE TABLE `service_equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`serial_key` text NOT NULL,
	`serial` text NOT NULL,
	`order_id` text,
	`client_id` text,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `client_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `history_clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_service_equipment_serial` ON `service_equipment` (`serial_key`);--> statement-breakpoint
CREATE TABLE `service_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_key` text NOT NULL,
	`serial_key` text NOT NULL,
	`status` text NOT NULL,
	`active_key` text,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_service_request` ON `service_orders` (`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_service_active` ON `service_orders` (`active_key`);--> statement-breakpoint
CREATE INDEX `idx_service_serial` ON `service_orders` (`serial_key`);