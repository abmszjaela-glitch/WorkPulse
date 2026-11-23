import { createClient } from '@supabase/supabase-js';
import { supabaseUrl, supabaseKey } from './environment.js';

// Stateless backend client: do not persist employee sessions on the server.
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

export default supabase;
