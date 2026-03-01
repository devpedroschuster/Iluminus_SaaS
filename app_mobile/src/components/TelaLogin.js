import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ScrollView
} from "react-native";
import { supabase } from "../services/supabase";

export default function TelaPerfil({ alunoId, onLogout }) {
  const [perfil, setPerfil] = useState(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    async function carregarDadosDoAluno() {
      try {
        setCarregando(true);
        // Busca os dados básicos do aluno
        const { data, error } = await supabase
          .from("alunos")
          .select("nome_completo, email, telefone")
          .eq("id", alunoId)
          .single();

        if (error) throw error;
        setPerfil(data);

      } catch (error) {
        console.error("Erro ao carregar perfil:", error);
      } finally {
        setCarregando(false);
      }
    }

    if (alunoId) {
      carregarDadosDoAluno();
    }
  }, [alunoId]);

  async function handleSair() {
    // No navegador o Alert.alert pode falhar, então chamamos direto.
    // No celular, seria ideal um Alert de confirmação.
    try {
      await onLogout();
    } catch (error) {
      console.error("Erro ao fazer logout:", error);
    }
  }

  if (carregando) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#D98E73" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {perfil?.nome_completo?.charAt(0).toUpperCase() || "A"}
          </Text>
        </View>
        <Text style={styles.nome}>{perfil?.nome_completo}</Text>
        <Text style={styles.email}>{perfil?.email}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Meu Plano</Text>
        <View style={styles.cardPlano}>
          <View style={styles.planoHeader}>
            <Text style={styles.planoNome}>Plano Mensal - Funcional</Text>
            <Text style={styles.planoStatus}>Ativo</Text>
          </View>
          <View style={styles.planoDetalhes}>
            <Text style={styles.planoTexto}>Vencimento: <Text style={styles.planoDestaque}>10/04/2026</Text></Text>
            <Text style={styles.planoTexto}>Aulas restantes: <Text style={styles.planoDestaque}>8</Text></Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Meus Dados</Text>
        <View style={styles.cardDados}>
          <View style={styles.dadoLinha}>
            <Text style={styles.dadoLabel}>Telefone</Text>
            <Text style={styles.dadoValor}>{perfil?.telefone || "Não informado"}</Text>
          </View>
          <View style={styles.divisor} />
          <View style={styles.dadoLinha}>
            <Text style={styles.dadoLabel}>Senha</Text>
            <Text style={styles.dadoValor}>********</Text>
          </View>
        </View>
        <Text style={styles.dicaSenha}>
          Para alterar sua senha ou dados cadastrais, acesse o Portal Web.
        </Text>
      </View>

      <TouchableOpacity style={styles.botaoSair} onPress={handleSair}>
        <Text style={styles.botaoSairTexto}>Sair da Conta</Text>
      </TouchableOpacity>
      
      {/* Espaçamento extra pro final da tela não ficar escondido pela barra */}
      <View style={{ height: 100 }} /> 
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FDF8F5" },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#FDF8F5" },
  
  header: { alignItems: "center", marginTop: 40, marginBottom: 30 },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: "#D98E73", justifyContent: "center", alignItems: "center", marginBottom: 15, shadowColor: "#D98E73", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 5 },
  avatarText: { fontSize: 32, fontWeight: "bold", color: "#FFF" },
  nome: { fontSize: 24, fontWeight: "bold", color: "#2D2D2D", marginBottom: 5 },
  email: { fontSize: 14, color: "#8E8E8E" },

  section: { marginBottom: 25 },
  sectionTitle: { fontSize: 16, fontWeight: "bold", color: "#2D2D2D", marginBottom: 10, marginLeft: 5 },
  
  cardPlano: { backgroundColor: "#FFF", borderRadius: 20, padding: 20, borderWidth: 1, borderColor: "#F0E5DE", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  planoHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 15, borderBottomWidth: 1, borderBottomColor: "#F5F5F5", paddingBottom: 10 },
  planoNome: { fontSize: 16, fontWeight: "bold", color: "#D98E73" },
  planoStatus: { backgroundColor: "#E8F5E9", color: "#2E7D32", fontSize: 12, fontWeight: "bold", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, overflow: "hidden" },
  planoDetalhes: { gap: 8 },
  planoTexto: { fontSize: 14, color: "#8E8E8E" },
  planoDestaque: { fontWeight: "bold", color: "#2D2D2D" },

  cardDados: { backgroundColor: "#FFF", borderRadius: 20, padding: 20, borderWidth: 1, borderColor: "#F0E5DE" },
  dadoLinha: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  dadoLabel: { fontSize: 14, color: "#8E8E8E" },
  dadoValor: { fontSize: 14, fontWeight: "600", color: "#2D2D2D" },
  divisor: { height: 1, backgroundColor: "#F5F5F5", marginVertical: 15 },
  dicaSenha: { fontSize: 12, color: "#A0A0A0", textAlign: "center", marginTop: 10, paddingHorizontal: 20 },

  botaoSair: { backgroundColor: "#FFF", borderWidth: 1, borderColor: "#E53E3E", borderRadius: 15, padding: 18, alignItems: "center", marginTop: 10 },
  botaoSairTexto: { color: "#E53E3E", fontWeight: "bold", fontSize: 16 },
});