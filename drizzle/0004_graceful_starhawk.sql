CREATE TABLE `app_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`consultant_name` text,
	`auth_user_id` text,
	`active` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_app_users_email` ON `app_users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_app_users_auth` ON `app_users` (`auth_user_id`);--> statement-breakpoint
CREATE TABLE `goal_settings` (
	`year` integer PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
