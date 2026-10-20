CREATE TABLE IF NOT EXISTS `_production_reset_orders` (
	`id` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
DELETE FROM `_production_reset_orders`;
--> statement-breakpoint
INSERT INTO `_production_reset_orders` (`id`) SELECT `id` FROM `client_orders`;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `_production_reset_service_serials` (
	`serial_key` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
DELETE FROM `_production_reset_service_serials`;
--> statement-breakpoint
INSERT OR IGNORE INTO `_production_reset_service_serials` (`serial_key`)
SELECT `serial_key` FROM `service_equipment`
WHERE `order_id` IN (SELECT `id` FROM `_production_reset_orders`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `_production_reset_serial_links` (
	`unit_id` text PRIMARY KEY NOT NULL,
	`parent_id` text
);
--> statement-breakpoint
DELETE FROM `_production_reset_serial_links`;
--> statement-breakpoint
INSERT INTO `_production_reset_serial_links` (`unit_id`,`parent_id`)
SELECT e.`unit_id`,MAX(json_extract(e.`payload`,'$.fromParent'))
FROM `inventory_serial_events` e
WHERE e.`order_id` IN (SELECT `id` FROM `_production_reset_orders`)
GROUP BY e.`unit_id`;
--> statement-breakpoint
UPDATE `inventory_items`
SET `balance`=`balance`-COALESCE((
	SELECT SUM(m.`delta`) FROM `inventory_movements` m
	WHERE m.`item_id`=`inventory_items`.`id`
	AND m.`order_id` IN (SELECT `id` FROM `_production_reset_orders`)
),0)
WHERE EXISTS (
	SELECT 1 FROM `inventory_movements` m
	WHERE m.`item_id`=`inventory_items`.`id`
	AND m.`order_id` IN (SELECT `id` FROM `_production_reset_orders`)
);
--> statement-breakpoint
DELETE FROM `inventory_movement_notes`
WHERE `movement_id` IN (
	SELECT `id` FROM `inventory_movements`
	WHERE `order_id` IN (SELECT `id` FROM `_production_reset_orders`)
);
--> statement-breakpoint
DELETE FROM `inventory_movements`
WHERE `order_id` IN (SELECT `id` FROM `_production_reset_orders`);
--> statement-breakpoint
DELETE FROM `inventory_serial_shortages`
WHERE `order_id` IN (SELECT `id` FROM `_production_reset_orders`);
--> statement-breakpoint
UPDATE `inventory_serial_units`
SET `status`='available',`parent_id`=NULL,`order_id`=NULL,`revision`=`revision`+1
WHERE `order_id` IN (SELECT `id` FROM `_production_reset_orders`)
OR `id` IN (SELECT `unit_id` FROM `_production_reset_serial_links`);
--> statement-breakpoint
UPDATE `inventory_serial_units` AS u
SET `parent_id`=(
	SELECT l.`parent_id` FROM `_production_reset_serial_links` l WHERE l.`unit_id`=u.`id`
),`revision`=`revision`+1
WHERE u.`status`='available'
AND u.`kind` IN ('battery','charger')
AND EXISTS (
	SELECT 1 FROM `_production_reset_serial_links` l
	JOIN `inventory_serial_units` p ON p.`id`=l.`parent_id`
	WHERE l.`unit_id`=u.`id` AND l.`parent_id` IS NOT NULL
	AND p.`kind`='equipment' AND p.`status`='available'
)
AND NOT EXISTS (
	SELECT 1 FROM `inventory_serial_units` occupied
	JOIN `_production_reset_serial_links` l ON l.`unit_id`=u.`id`
	WHERE occupied.`parent_id`=l.`parent_id`
	AND occupied.`kind`=u.`kind`
	AND occupied.`status`='available'
	AND occupied.`id`!=u.`id`
);
--> statement-breakpoint
UPDATE `inventory_serial_shortages` AS s
SET `active_key`=s.`equipment_id`||':'||s.`kind`,`resolved_at`=NULL
WHERE s.`order_id` IS NULL
AND s.`active_key` IS NULL
AND s.`removed_id` IS NULL
AND s.`replacement_id` IS NULL
AND s.`equipment_id` IN (
	SELECT l.`unit_id` FROM `_production_reset_serial_links` l
	JOIN `inventory_serial_units` u ON u.`id`=l.`unit_id`
	WHERE u.`kind`='equipment' AND u.`status`='available'
)
AND NOT EXISTS (
	SELECT 1 FROM `inventory_serial_units` component
	WHERE component.`parent_id`=s.`equipment_id`
	AND component.`kind`=s.`kind`
	AND component.`status`='available'
);
--> statement-breakpoint
DELETE FROM `inventory_serial_events`
WHERE `order_id` IN (SELECT `id` FROM `_production_reset_orders`);
--> statement-breakpoint
DELETE FROM `service_orders`
WHERE `serial_key` IN (SELECT `serial_key` FROM `_production_reset_service_serials`);
--> statement-breakpoint
DELETE FROM `service_equipment`
WHERE `order_id` IN (SELECT `id` FROM `_production_reset_orders`);
--> statement-breakpoint
DELETE FROM `project_stages`
WHERE `source` IN ('order_new','order','workflow');
--> statement-breakpoint
DELETE FROM `client_orders`
WHERE `id` IN (SELECT `id` FROM `_production_reset_orders`);
--> statement-breakpoint
DROP TABLE `_production_reset_serial_links`;
--> statement-breakpoint
DROP TABLE `_production_reset_service_serials`;
--> statement-breakpoint
DROP TABLE `_production_reset_orders`;
