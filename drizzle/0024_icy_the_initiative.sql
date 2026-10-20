CREATE TABLE `activity_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`schedule_next` integer DEFAULT 1 NOT NULL,
	`updated_by` text,
	`updated_at` text
);
