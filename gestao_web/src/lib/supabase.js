import { createClient } from "@supabase/supabase-js";

// Busca as variáveis de ambiente (Segurança e Boas Práticas)
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Fallback de segurança: Se não encontrar as variáveis, avisa no console
if (!supabaseUrl || !supabaseAnonKey) {
  console.error("ERRO CRÍTICO: Variáveis de ambiente do Supabase não encontradas.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);