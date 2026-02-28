import AsyncStorage from "@react-native-async-storage/async-storage";
import { useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../services/supabase";

export default function TelaLogin({ onLogado }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erroMsg, setErroMsg] = useState(""); // Novo estado para controlar a mensagem de erro

  async function handleLogin() {
    setErroMsg(""); // Limpa os erros anteriores ao tentar novamente

    if (!email || !senha) {
      setErroMsg("Preencha e-mail e senha.");
      return;
    }

    try {
      setCarregando(true);

      // 1. Autentica no Supabase
      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: senha,
        });

      if (authError) throw authError;

      // 2. Busca o perfil do aluno
      const { data: perfil, error: perfilError } = await supabase
        .from("alunos")
        .select("id, nome_completo, primeiro_acesso")
        .eq("auth_id", authData.user.id)
        .maybeSingle();

      if (perfilError) throw perfilError;

      if (!perfil) {
        setErroMsg("Perfil de aluno não encontrado no banco de dados.");
        setCarregando(false);
        return;
      }

      // 3. Trava de Primeiro Acesso (Segurança)
      if (perfil.primeiro_acesso) {
        setErroMsg("Seu primeiro acesso deve ser feito pelo nosso Portal Web para definir uma nova senha.");
        await supabase.auth.signOut(); // Desloga
        setCarregando(false);
        return;
      }

      // 4. Salva a sessão localmente
      await AsyncStorage.setItem("@aluno_id", String(perfil.id));
      await AsyncStorage.setItem("@aluno_nome", perfil.nome_completo);

      onLogado(perfil);
    } catch (err) {
      console.error("🚨 ERRO REAL DO SUPABASE:", err);
      setErroMsg(err.message || "Erro desconhecido ao tentar logar.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>Espaço Iluminus</Text>
      <Text style={styles.subtitulo}>App do Aluno</Text>

      <View style={styles.inputContainer}>
        <TextInput
          placeholder="Seu e-mail"
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholderTextColor="#aaa"
        />

        <TextInput
          placeholder="Sua senha"
          style={styles.input}
          value={senha}
          onChangeText={setSenha}
          secureTextEntry={true}
          placeholderTextColor="#aaa"
        />

        {/* Exibe a mensagem de erro se ela existir */}
        {erroMsg ? <Text style={styles.erroTexto}>{erroMsg}</Text> : null}

        <TouchableOpacity
          style={styles.botao}
          onPress={handleLogin}
          disabled={carregando}
        >
          {carregando ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={styles.botaoTexto}>Entrar</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FDF8F5",
    justifyContent: "center",
    padding: 30,
  },
  logo: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#D98E73",
    textAlign: "center",
  },
  subtitulo: {
    fontSize: 16,
    color: "#8E8E8E",
    textAlign: "center",
    marginBottom: 40,
  },
  inputContainer: { gap: 15 },
  input: {
    backgroundColor: "#FFF",
    padding: 18,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#F0E5DE",
    fontSize: 16,
    color: "#2D2D2D",
  },
  erroTexto: {
    color: "#E53E3E", // Vermelho
    fontSize: 14,
    fontWeight: "bold",
    textAlign: "center",
    marginTop: 5,
  },
  botao: {
    backgroundColor: "#D98E73",
    padding: 18,
    borderRadius: 15,
    alignItems: "center",
    marginTop: 10,
    shadowColor: "#D98E73",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  botaoTexto: { color: "#FFF", fontWeight: "bold", fontSize: 18 },
});