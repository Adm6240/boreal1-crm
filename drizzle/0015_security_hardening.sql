CREATE TABLE `client_access` (
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`granted_by` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `history_clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_client_access` ON `client_access` (`client_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_security_events_date` ON `security_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `user_activities` (
	`user_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `app_users`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
UPDATE app_users SET must_change_password=1 WHERE password_hash IS NOT NULL;
--> statement-breakpoint
DELETE FROM app_sessions WHERE user_id IN (SELECT id FROM app_users WHERE must_change_password=1);

--> statement-breakpoint
UPDATE app_users SET active=0 WHERE id IN ('0cf93b80-41db-4222-a474-bf50cf467f29','1aa1d34e-795f-447d-8b15-20522571ea5d','83ed3776-f970-4e55-bb53-e915c742a0db') AND email NOT LIKE '%@%';

--> statement-breakpoint
UPDATE app_users SET active=0 WHERE email <> 'admin@example.invalid' AND password_hash IS NOT NULL AND (password_hash IN (SELECT default_hash FROM auth_settings WHERE id IN (1,2)) OR (SELECT COUNT(*) FROM app_users shared WHERE shared.password_hash=app_users.password_hash)>1);
