import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export const SUPABASE_URL = 'https://cnaublclebiysmqatwzu.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_0ln6TcRbDTyfzKiROO4xGA_1LZjS_Sn'

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
