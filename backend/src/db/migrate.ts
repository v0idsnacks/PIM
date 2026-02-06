import postgres from 'postgres';
import 'dotenv/config';

/**
 * Auto-migration script - Creates tables if they don't exist.
 * This runs on server startup to ensure the database is ready.
 */
export async function ensureTablesExist(): Promise<boolean> {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString || connectionString.includes('your_') || connectionString.includes('password@host')) {
        console.log('⚠️ DATABASE_URL not configured - skipping migration');
        return false;
    }

    const sql = postgres(connectionString);

    try {
        // Check if messages table exists
        const tableCheck = await sql`
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public'
                AND table_name = 'messages'
            );
        `;

        const messagesExist = tableCheck[0]?.exists;

        if (!messagesExist) {
            console.log('📦 Creating database tables...');

            // Create messages table
            await sql`
                CREATE TABLE IF NOT EXISTS "messages" (
                    "id" serial PRIMARY KEY NOT NULL,
                    "contact_name" text NOT NULL,
                    "message_content" text NOT NULL,
                    "is_from_user" boolean DEFAULT false,
                    "platform" text DEFAULT 'instagram',
                    "created_at" timestamp DEFAULT now()
                );
            `;

            // Create vip_contacts table
            await sql`
                CREATE TABLE IF NOT EXISTS "vip_contacts" (
                    "id" serial PRIMARY KEY NOT NULL,
                    "username" text NOT NULL,
                    "nickname" text,
                    "custom_prompt" text,
                    "is_enabled" boolean DEFAULT true NOT NULL,
                    "created_at" timestamp DEFAULT now() NOT NULL,
                    CONSTRAINT "vip_contacts_username_unique" UNIQUE("username")
                );
            `;

            console.log('✅ Database tables created successfully!');
        } else {
            console.log('✅ Database tables already exist');
        }

        await sql.end();
        return true;
    } catch (error) {
        console.error('❌ Migration error:', error);
        await sql.end();
        return false;
    }
}
