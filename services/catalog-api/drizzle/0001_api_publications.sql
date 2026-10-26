CREATE TABLE `api_current` (
	`singleton` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `api_records` (
	`version_id` text NOT NULL,
	`kind` text NOT NULL,
	`record_key` text NOT NULL,
	`payload_json` text NOT NULL,
	PRIMARY KEY(`version_id`, `kind`, `record_key`)
);
--> statement-breakpoint
CREATE TABLE `api_versions` (
	`version_id` text PRIMARY KEY NOT NULL,
	`manifest_json` text NOT NULL
);
