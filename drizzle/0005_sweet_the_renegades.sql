CREATE TABLE `app_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `app_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `auth_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`default_hash` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `app_users` ADD `user_code` text;--> statement-breakpoint
ALTER TABLE `app_users` ADD `password_hash` text;--> statement-breakpoint
ALTER TABLE `app_users` ADD `must_change_password` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_app_users_code` ON `app_users` (`user_code`);