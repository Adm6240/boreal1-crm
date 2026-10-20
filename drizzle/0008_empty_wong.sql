CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`filename` text NOT NULL,
	`summary` text NOT NULL,
	`author_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `import_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`source_key` text NOT NULL,
	`client_id` text,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`author_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `history_clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_import_source` ON `import_records` (`kind`,`source_key`);