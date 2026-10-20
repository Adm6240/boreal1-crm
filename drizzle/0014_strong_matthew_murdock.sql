DROP INDEX `idx_client_orders_project`;--> statement-breakpoint
CREATE INDEX `idx_client_orders_project` ON `client_orders` (`client_id`,`project_key`);