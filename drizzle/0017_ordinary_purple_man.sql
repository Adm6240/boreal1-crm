CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`minimum` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "inventory_nonnegative" CHECK("inventory_items"."balance" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_sku` ON `inventory_items` (`sku`);--> statement-breakpoint
CREATE TABLE `inventory_kits` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`components` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_kit_name` ON `inventory_kits` (`name`);--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`delta` integer NOT NULL,
	`date` text NOT NULL,
	`kind` text NOT NULL,
	`order_id` text,
	`context` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`author_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `client_orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inventory_delta_nonzero" CHECK("inventory_movements"."delta" != 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_order_item` ON `inventory_movements` (`order_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `idx_inventory_movement_date` ON `inventory_movements` (`date`);
--> statement-breakpoint
CREATE TRIGGER inventory_apply_movement AFTER INSERT ON inventory_movements
BEGIN
 UPDATE inventory_items SET balance=balance+NEW.delta WHERE id=NEW.item_id;
END;
