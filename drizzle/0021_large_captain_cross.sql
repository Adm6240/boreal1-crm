CREATE TABLE `inventory_movement_notes` (
	`movement_id` text PRIMARY KEY NOT NULL,
	`note` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL
);
