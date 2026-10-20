CREATE TABLE `client_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`cnpj` text,
	`payload` text NOT NULL,
	`revision` integer NOT NULL,
	`origin_name` text,
	`origin_state` text,
	`author_id` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `history_clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_client_profiles_cnpj` ON `client_profiles` (`cnpj`);