CREATE TABLE `market_import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`state` text NOT NULL,
	`summary` text NOT NULL,
	`author_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_market_import_created` ON `market_import_batches` (`created_at`);--> statement-breakpoint
CREATE TABLE `market_presence` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`state` text NOT NULL,
	`municipality_code` text,
	`municipality` text NOT NULL,
	`municipality_key` text NOT NULL,
	`company` text NOT NULL,
	`company_key` text NOT NULL,
	`sector` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`author_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_market_presence_unique` ON `market_presence` (`state`,`municipality_key`,`company_key`);--> statement-breakpoint
CREATE INDEX `idx_market_presence_state_city` ON `market_presence` (`state`,`municipality_key`);--> statement-breakpoint
CREATE INDEX `idx_market_presence_company` ON `market_presence` (`company_key`);