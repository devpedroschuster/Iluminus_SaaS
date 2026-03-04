import { format } from "date-fns";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { supabase } from "../services/supabase";

const cores = {
  primaria: "#D98E73",
  secundaria: "#8A9A5B",
  fundo: "#FDF8F5",
  branco: "#FFFFFF",
  texto: "#2D2D2D",
  textoSuave: "#8E8E8E",
  verde: "#10B981",
  vermelho: "#EF4444",
  amarelo: "#F59E0B",
};

export default function TelaPerfil({ alunoId, onLogout }) {
  const [perfil, setPerfil] = useState(null);
  const [mensalidades, setMensalidades] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function carregarDados() {
    try {
      setCarregando(true);

      // 1. Busca Dados do Aluno + Plano
      const { data: dadosAluno, error: errAluno } = await supabase
        .from("alunos")
        .select(`*, planos (nome, preco, frequencia_semanal)`)
        .eq("id", alunoId)
        .single();

      if (errAluno) throw errAluno;
      setPerfil(dadosAluno);

      // 2. Busca Histórico Financeiro (se a tabela existir)
      const { data: dadosFin, error: errFin } = await supabase
        .from("mensalidades")
        .select("*")
        .eq("aluno_id", alunoId)
        .order("data_vencimento", { ascending: false });

      if (errFin && errFin.code !== '42P01') { // Ignora se a tabela não existir ainda
          throw errFin;
      }
      setMensalidades(dadosFin || []);
      
    } catch (error) {
      Alert.alert("Aviso", "Algumas informações podem não ter sido carregadas.");
      console.log("Erro ao carregar perfil:", error);
    } finally {
      setCarregando(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    carregarDados();
  }, [alunoId]);

  const onRefresh = () => {
    setRefreshing(true);
    carregarDados();
  };

  const getStatusCor = (status, dataVencimento) => {
    if (status === "pago") return cores.verde;
    if (dataVencimento && new Date(dataVencimento) < new Date()) return cores.vermelho;
    return cores.amarelo;
  };

  const getStatusTexto = (status, dataVencimento) => {
    if (status === "pago") return "PAGO";
    if (dataVencimento && new Date(dataVencimento) < new Date()) return "ATRASADO";
    return "ABERTO";
  };

  if (carregando && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={cores.primaria} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Cabeçalho do Perfil */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarTexto}>
            {perfil?.nome_completo?.charAt(0).toUpperCase() || "A"}
          </Text>
        </View>
        <Text style={styles.nome}>{perfil?.nome_completo}</Text>
        <Text style={styles.email}>{perfil?.email}</Text>
      </View>

      {/* Card do Plano */}
      <View style={styles.card}>
        <Text style={styles.cardTitulo}>Meu Plano</Text>
        {perfil?.planos ? (
          <View>
            <View style={styles.row}>
              <Text style={styles.label}>Plano:</Text>
              <Text style={styles.valor}>{perfil.planos.nome}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Frequência:</Text>
              <Text style={styles.valor}>
                {perfil.planos.frequencia_semanal}x na semana
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Valor:</Text>
              <Text style={styles.valor}>
                {Number(perfil.planos.preco || 0).toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Status:</Text>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: perfil.ativo ? cores.verde : cores.vermelho },
                ]}
              >
                <Text style={styles.badgeTexto}>
                  {perfil.ativo ? "ATIVO" : "INATIVO"}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <Text style={styles.semPlano}>Nenhum plano vinculado.</Text>
        )}
      </View>

      {/* Histórico Financeiro */}
      <View style={styles.section}>
        <Text style={styles.sectionTitulo}>Histórico Financeiro</Text>
        {mensalidades.length === 0 ? (
          <Text style={styles.semDados}>Nenhuma cobrança registrada.</Text>
        ) : (
          mensalidades.map((item) => (
            <View key={item.id} style={styles.itemFinanceiro}>
              <View>
                <Text style={styles.mesRef}>Vencimento</Text>
                <Text style={styles.dataVenc}>
                  {item.data_vencimento ? format(new Date(item.data_vencimento), "dd/MM/yyyy") : "--/--/----"}
                </Text>
              </View>

              <View style={styles.direitaItem}>
                <Text
                  style={[
                    styles.statusTexto,
                    { color: getStatusCor(item.status, item.data_vencimento) },
                  ]}
                >
                  {getStatusTexto(item.status, item.data_vencimento)}
                </Text>
                {item.valor_pago && (
                  <Text style={styles.valorPago}>
                    Pg:{" "}
                    {Number(item.valor_pago).toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}
                  </Text>
                )}
              </View>
            </View>
          ))
        )}
      </View>

      <TouchableOpacity style={styles.botaoSair} onPress={onLogout}>
        <Text style={styles.textoSair}>Sair do Aplicativo</Text>
      </TouchableOpacity>

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: cores.fundo },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: { alignItems: "center", paddingVertical: 30 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: cores.secundaria,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 15,
  },
  avatarTexto: { fontSize: 32, fontWeight: "bold", color: cores.branco },
  nome: { fontSize: 22, fontWeight: "bold", color: cores.texto },
  email: { fontSize: 14, color: cores.textoSuave },

  card: {
    backgroundColor: cores.branco,
    marginHorizontal: 20,
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#F0E0D6",
    marginBottom: 25,
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 5,
  },
  cardTitulo: {
    fontSize: 18,
    fontWeight: "bold",
    color: cores.primaria,
    marginBottom: 15,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
    alignItems: "center",
  },
  label: { fontSize: 14, color: cores.textoSuave },
  valor: { fontSize: 15, fontWeight: "600", color: cores.texto },
  semPlano: { fontStyle: "italic", color: cores.textoSuave },

  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  badgeTexto: { color: "#FFF", fontSize: 10, fontWeight: "bold" },

  section: { paddingHorizontal: 20 },
  sectionTitulo: {
    fontSize: 18,
    fontWeight: "bold",
    color: cores.texto,
    marginBottom: 15,
  },
  semDados: { color: cores.textoSuave, textAlign: "center", marginTop: 10 },

  itemFinanceiro: {
    backgroundColor: cores.branco,
    padding: 15,
    borderRadius: 15,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#F0E0D6",
  },
  mesRef: { fontSize: 10, color: cores.textoSuave, textTransform: "uppercase" },
  dataVenc: { fontSize: 16, fontWeight: "bold", color: cores.texto },
  direitaItem: { alignItems: "flex-end" },
  statusTexto: { fontWeight: "bold", fontSize: 12 },
  valorPago: { fontSize: 10, color: cores.textoSuave, marginTop: 2 },

  botaoSair: {
    margin: 20,
    padding: 18,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#E5E5E5",
    borderRadius: 15,
    alignItems: "center",
  },
  textoSair: { color: cores.vermelho, fontWeight: "bold" },
});