-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_name" text NOT NULL,
	"message_content" text NOT NULL,
	"is_from_user" boolean DEFAULT false,
	"platform" text DEFAULT 'instagram',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "vip_contacts" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"nickname" text,
	"custom_prompt" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vip_contacts_username_unique" UNIQUE("username")
);

*/