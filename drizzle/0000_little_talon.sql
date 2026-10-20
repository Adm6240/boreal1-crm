CREATE TABLE `history_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`email_id` text NOT NULL,
	`object_key` text NOT NULL,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`content_id` text,
	`inline` integer NOT NULL,
	FOREIGN KEY (`email_id`) REFERENCES `history_emails`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_history_attachments_email` ON `history_attachments` (`email_id`);--> statement-breakpoint
CREATE TABLE `history_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`legacy_key` text NOT NULL,
	`name` text NOT NULL,
	`state` text NOT NULL,
	`route_token` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_history_clients_legacy_key` ON `history_clients` (`legacy_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_history_clients_route_token` ON `history_clients` (`route_token`);--> statement-breakpoint
CREATE TABLE `history_emails` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`subject` text NOT NULL,
	`sender` text NOT NULL,
	`recipients` text NOT NULL,
	`cc` text NOT NULL,
	`sent_at` text,
	`text_body` text NOT NULL,
	`html_body` text NOT NULL,
	`project` text NOT NULL,
	`source` text NOT NULL,
	`original_key` text NOT NULL,
	`original_name` text NOT NULL,
	`author_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `history_clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_history_emails_dedupe` ON `history_emails` (`client_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `idx_history_emails_client_date` ON `history_emails` (`client_id`,`sent_at`);