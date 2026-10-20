ALTER TABLE `inventory_items` ADD `manufacturer` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE inventory_items
SET manufacturer=COALESCE((SELECT json_extract(payload,'$.brand') FROM inventory_import_items WHERE item_id=inventory_items.id),'')
WHERE EXISTS(SELECT 1 FROM inventory_import_items WHERE item_id=inventory_items.id);
--> statement-breakpoint
UPDATE inventory_items
SET name=(
 SELECT trim(
  CASE
   WHEN lower(COALESCE(json_extract(payload,'$.product'),'')) LIKE '%bateria%' THEN 'Bateria'
   WHEN lower(COALESCE(json_extract(payload,'$.product'),'')) LIKE '%carregador%' OR lower(COALESCE(json_extract(payload,'$.product'),'')) LIKE '%fonte%' THEN 'Carregador'
   WHEN lower(COALESCE(json_extract(payload,'$.product'),'')) LIKE '%capa%' THEN 'Capa protetora'
   WHEN lower(COALESCE(json_extract(payload,'$.product'),'')) LIKE '%impressora%' THEN 'Impressora'
   WHEN lower(COALESCE(json_extract(payload,'$.product'),'')) LIKE '%coletor%' OR lower(COALESCE(json_extract(payload,'$.product'),'')) LIKE '%terminal%' THEN 'Coletor'
   WHEN lower(COALESCE(json_extract(payload,'$.product'),'')) LIKE '%tablet%' THEN 'Tablet'
   WHEN lower(COALESCE(json_extract(payload,'$.product'),'')) LIKE '%scanner%' OR lower(COALESCE(json_extract(payload,'$.product'),'')) LIKE '%leitor%' THEN 'Leitor'
   ELSE ''
  END || ' ' || COALESCE(NULLIF(json_extract(payload,'$.equipment'),''),NULLIF(json_extract(payload,'$.model'),''),'')
 ) FROM inventory_import_items WHERE item_id=inventory_items.id
)
WHERE EXISTS(
 SELECT 1 FROM inventory_import_items
 WHERE item_id=inventory_items.id
 AND trim(COALESCE(json_extract(payload,'$.product'),''))!=''
 AND trim(COALESCE(NULLIF(json_extract(payload,'$.equipment'),''),NULLIF(json_extract(payload,'$.model'),''),''))!=''
 AND (
  lower(COALESCE(json_extract(payload,'$.product'),'')) LIKE '%bateria%'
  OR lower(COALESCE(json_extract(payload,'$.product'),'')) LIKE '%carregador%'
  OR lower(COALESCE(json_extract(payload,'$.product'),'')) LIKE '%fonte%'
  OR lower(COALESCE(json_extract(payload,'$.product'),'')) LIKE '%capa%'
  OR lower(COALESCE(json_extract(payload,'$.product'),'')) LIKE '%impressora%'
  OR lower(COALESCE(json_extract(payload,'$.product'),'')) LIKE '%coletor%'
  OR lower(COALESCE(json_extract(payload,'$.product'),'')) LIKE '%terminal%'
  OR lower(COALESCE(json_extract(payload,'$.product'),'')) LIKE '%tablet%'
  OR lower(COALESCE(json_extract(payload,'$.product'),'')) LIKE '%scanner%'
  OR lower(COALESCE(json_extract(payload,'$.product'),'')) LIKE '%leitor%'
 )
);
