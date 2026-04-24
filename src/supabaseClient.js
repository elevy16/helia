import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nmrxwaayxsxdvmznafvf.supabase.co';
const supabaseAnonKey = 'sb_publishable_NTa_tGDw0kWqVKh-TYQkvA_WkL8bUt0';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
