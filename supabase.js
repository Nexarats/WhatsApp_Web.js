import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client for WhatsApp service.
 * Uses service role key to bypass RLS for server-side operations.
 */

// Lazy initialization to handle environment variables loaded after import
let supabaseClient = null;

function getSupabaseClient() {
    if (!supabaseClient) {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseServiceKey) {
            throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
        }

        supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        });
    }

    return supabaseClient;
}

// Export as a getter to ensure lazy initialization
export const supabase = new Proxy({}, {
    get(target, prop) {
        const client = getSupabaseClient();
        const value = client[prop];
        if (typeof value === 'function') {
            return value.bind(client);
        }
        return value;
    }
});