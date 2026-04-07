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
  
  // Estados para feedback visual imediato
  const [erroEmail, setErroEmail] = useState("");
  const [erroSenha, setErroSenha] = useState("");

  // Validador de E-mail usando Regex
  const validarEmail = (texto) => {
    setEmail(texto);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (texto.length > 0 && !emailRegex.test(texto)) {
      setErroEmail("Por favor, insira um e-mail válido.");
    } else {
      setErroEmail("");
    }
  };

  // Validador de Senha
  const validarSenha = (texto) => {
    setSenha(texto);
    if (texto.length > 0 && texto.length < 6) {
      setErroSenha("A senha deve ter no mínimo 6 caracteres.");
    } else {
      setErroSenha("");
    }
  };

  async function handleLogin() {
    if (!email || !senha) {
      Alert.alert("Aviso", "Por favor, preencha seu e-mail e senha.");
      return;
    }

    if (erroEmail || erroSenha) {
      Alert.alert("Aviso", "Por favor, corrija os erros nos campos antes de continuar.");
      return;
    }

    try {
      setCarregando(true);
      
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: senha,
      });

      if (authError) throw authError;

      const { data: aluno, error: alunoError } = await supabase
        .from("alunos")
        .select("id, nome_completo")
        .eq("auth_id", authData.user.id)
        .single();

      if (alunoError || !aluno) {
        throw new Error("Perfil de aluno não encontrado.");
      }

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
            style={[styles.input, erroEmail ? styles.inputErro : null]}
            placeholder="Digite seu e-mail"
            placeholderTextColor="#A0A0A0"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={validarEmail}
          />
          {/* Mensagem de Erro do E-mail */}
          {erroEmail ? <Text style={styles.textoErro}>{erroEmail}</Text> : null}

          <Text style={[styles.label, { marginTop: erroEmail ? 5 : 0 }]}>Senha</Text>
          <TextInput
            style={[styles.input, erroSenha ? styles.inputErro : null]}
            placeholder="Digite sua senha"
            placeholderTextColor="#A0A0A0"
            secureTextEntry
            value={senha}
            onChangeText={validarSenha}
          />
          {/* Mensagem de Erro da Senha */}
          {erroSenha ? <Text style={styles.textoErro}>{erroSenha}</Text> : null}

          <TouchableOpacity 
            style={[
              styles.button, 
              (carregando || erroEmail || erroSenha) && styles.buttonDisabled
            ]} 
            onPress={handleLogin}
            disabled={carregando || !!erroEmail || !!erroSenha}
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
  
  // Estilos de Input
  input: { backgroundColor: "#F9F9F9", borderWidth: 1, borderColor: "#E5E5E5", borderRadius: 12, padding: 15, fontSize: 16, color: "#2D2D2D", marginBottom: 20 },
  inputErro: { borderColor: "#E07A5F", backgroundColor: "#FFF5F2", marginBottom: 5 },
  
  // Texto de Feedback
  textoErro: { color: "#E07A5F", fontSize: 12, marginLeft: 5, marginBottom: 15, fontWeight: "600" },

  button: { backgroundColor: "#D98E73", padding: 16, borderRadius: 12, alignItems: "center", marginTop: 10, shadowColor: "#D98E73", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 4 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#FFF", fontSize: 16, fontWeight: "900" }
});