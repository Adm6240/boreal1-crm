CREATE TABLE `inventory_import_drafts` (
	`batch_id` text NOT NULL,
	`identity_key` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `inventory_import_batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_draft_item` ON `inventory_import_drafts` (`batch_id`,`identity_key`);--> statement-breakpoint
CREATE TRIGGER inventory_import_guard_insert BEFORE INSERT ON inventory_import_items
WHEN NEW.status='ready' AND ((SELECT balance FROM inventory_items WHERE id=NEW.item_id)!=0 OR EXISTS(SELECT 1 FROM inventory_movements WHERE item_id=NEW.item_id))
BEGIN SELECT RAISE(ABORT,'inventory_initial_conflict'); END;
--> statement-breakpoint
CREATE TRIGGER inventory_import_guard_resolve BEFORE UPDATE OF status ON inventory_import_items
WHEN OLD.status='pending' AND NEW.status='ready' AND ((SELECT balance FROM inventory_items WHERE id=NEW.item_id)!=0 OR EXISTS(SELECT 1 FROM inventory_movements WHERE item_id=NEW.item_id))
BEGIN SELECT RAISE(ABORT,'inventory_initial_conflict'); END;
--> statement-breakpoint
CREATE INDEX idx_inventory_import_line_identity ON inventory_import_lines (batch_id,json_extract(payload,'$.identityKey'));
--> statement-breakpoint
CREATE TRIGGER inventory_import_guard_pending BEFORE INSERT ON inventory_movements
WHEN EXISTS(SELECT 1 FROM inventory_import_items WHERE item_id=NEW.item_id AND status='pending')
BEGIN SELECT RAISE(ABORT,'inventory_pending_verification'); END;
