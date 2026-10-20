CREATE TABLE `sales_history` (
	`year` integer NOT NULL,
	`consultant_key` text NOT NULL,
	`consultant` text NOT NULL,
	`month` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`filename` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sales_history_period` ON `sales_history` (`year`,`consultant_key`,`month`);