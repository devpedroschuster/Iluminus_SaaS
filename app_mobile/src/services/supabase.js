import { createClient } from "@supabase/supabase-js";
import "react-native-url-polyfill/auto";
// Importamos as variáveis do módulo virtual @env
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@env";

// Fallback de segurança para debug (opcional, ajuda a saber se o .env carregou)
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "ERRO: Variáveis de ambiente do Supabase não carregadas. Verifique o arquivo .env",
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
