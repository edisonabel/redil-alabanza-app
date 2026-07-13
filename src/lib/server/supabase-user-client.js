import { createClient } from '@supabase/supabase-js';
import { getSupabaseServerEnv } from './supabase-env.js';

export const createSupabaseUserClient = (accessToken) => {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseServerEnv();
  if (!accessToken) {
    throw new Error('Se requiere una sesion autenticada para consultar Supabase.');
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
};
