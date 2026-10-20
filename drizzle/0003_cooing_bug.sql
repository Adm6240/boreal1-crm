ALTER TABLE `client_orders` ADD `order_ref` text;--> statement-breakpoint
ALTER TABLE `client_orders` ADD `workflow` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_client_orders_ref` ON `client_orders` (`order_ref`);--> statement-breakpoint
CREATE INDEX `idx_client_orders_status` ON `client_orders` (`status`);