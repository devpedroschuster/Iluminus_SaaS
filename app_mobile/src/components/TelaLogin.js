import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
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

  async function handleLogin() {
    if (!email || !senha) {
      Alert.alert("Aviso", "Por favor, preencha seu e-mail e senha.");
      return;
    }

    try {
      setCarregando(true);
      
      // 1. Faz o login no Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: senha,
      });

      if (authError) throw authError;

      // 2. Busca os dados do aluno na nossa tabela 'alunos'
      const { data: aluno, error: alunoError } = await supabase
        .from("alunos")
        .select("id, nome_completo")
        .eq("auth_id", authData.user.id)
        .single();

      if (alunoError || !aluno) {
        throw new Error("Perfil de aluno não encontrado.");
      }

      // 3. Devolve os dados para o App.js destravar o aplicativo
      onLogado(aluno);

    } catch (error) {
      console.error("Erro no login:", error);
      Alert.alert(
        "Falha no Login", 
        error.message === "Invalid login credentials" 
          ? "E-mail ou senha incorretos." 
          : "Não foi possível conectar. Verifique sua internet."
      );
    } finally {
      setCarregando(false);
    }
  }

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={styles.content}>
        
        {/* Cabeçalho */}
        <View style={styles.logoContainer}>
          <Text style={styles.logoText}>ILUMINUS</Text>
          <Text style={styles.subtitle}>Espaço de Movimento</Text>
        </View>

        {/* Formulário */}
        <View style={styles.form}>
          <Text style={styles.label}>E-mail</Text>
          <TextInput
            style={styles.input}
            placeholder="Digite seu e-mail"
            placeholderTextColor="#A0A0A0"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
          />

          <Text style={styles.label}>Senha</Text>
          <TextInput
            style={styles.input}
            placeholder="Digite sua senha"
            placeholderTextColor="#A0A0A0"
            secureTextEntry
            value={senha}
            onChangeText={setSenha}
          />

          <TouchableOpacity 
            style={[styles.button, carregando && styles.buttonDisabled]} 
            onPress={handleLogin}
            disabled={carregando}
          >
            {carregando ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.buttonText}>Acessar Agenda</Text>
            )}
          </TouchableOpacity>
        </View>

      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FDF8F5" },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: 30 },
  
  logoContainer: { alignItems: "center", marginBottom: 50 },
  logoText: { fontSize: 36, fontWeight: "900", color: "#D98E73", letterSpacing: 2 },
  subtitle: { fontSize: 14, color: "#8E8E8E", marginTop: 5, textTransform: "uppercase", letterSpacing: 1, fontWeight: "600" },
  
  form: { backgroundColor: "#FFF", padding: 25, borderRadius: 24, shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 3, borderWidth: 1, borderColor: "#F0E0D6" },
  label: { fontSize: 12, fontWeight: "900", color: "#8E8E8E", textTransform: "uppercase", marginBottom: 8, marginLeft: 4 },
  input: { backgroundColor: "#F9F9F9", borderWidth: 1, borderColor: "#E5E5E5", borderRadius: 12, padding: 15, fontSize: 16, color: "#2D2D2D", marginBottom: 20 },
  
  button: { backgroundColor: "#D98E73", padding: 16, borderRadius: 12, alignItems: "center", marginTop: 10, shadowColor: "#D98E73", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 4 },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: "#FFF", fontSize: 16, fontWeight: "900" }
});