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
    Linking
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
  whatsApp: "#25D366",
  alertaFundo: "#FEF2F2",
  alertaBorda: "#FCA5A5"
};

export default function TelaPerfil({ alunoId, onLogout }) {
  const [perfil, setPerfil] = useState(null);
  const [mensalidades, setMensalidades] = useState([]);
  const [frequenciaMes, setFrequenciaMes] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const numeroWhatsApp = "5551994424348"; 

  async function carregarDados() {
    try {
      setCarregando(true);

      const { data: dadosAluno, error: errAluno } = await supabase
        .from("alunos")
        .select(`*, planos (nome, preco, frequencia_semanal)`)
        .eq("id", alunoId)
        .single();

      if (errAluno) throw errAluno;
      setPerfil(dadosAluno);

      const { data: dadosFin, error: errFin } = await supabase
        .from("mensalidades")
        .select("*")
        .eq("aluno_id", alunoId)
        .order("data_vencimento", { ascending: false });

      if (errFin && errFin.code !== '42P01') { 
          throw errFin;
      }
      setMensalidades(dadosFin || []);

      const { data: minhasPresencas } = await supabase
        .from("presencas")
        .select("*")
        .eq("aluno_id", alunoId);

      let countMes = 0;
      if (minhasPresencas) {
        const mesAtual = new Date().getMonth();
        const anoAtual = new Date().getFullYear();
        
        minhasPresencas.forEach(p => {
            const dataRaw = p.data_aula || p.data_checkin || p.created_at;
            if (dataRaw) {
                const dataAula = new Date(dataRaw);
                if (dataAula.getMonth() === mesAtual && dataAula.getFullYear() === anoAtual) {
                    countMes++;
                }
            }
        });
      }
      setFrequenciaMes(countMes);
      
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

  // Funções de Status e Cores
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

  const temMensalidadeAtrasada = mensalidades.some(m => {
      if (m.status === "pago" || !m.data_vencimento) return false;
      const hoje = new Date();
      hoje.setHours(0,0,0,0);
      return new Date(m.data_vencimento) < hoje;
  });

  // Função para abrir o WhatsApp
  const abrirWhatsApp = (mensagem) => {
      const url = `https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(mensagem)}`;
      Linking.openURL(url).catch(() => {
          Alert.alert("Erro", "Não foi possível abrir o WhatsApp. Verifique se o aplicativo está instalado.");
      });
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

      {/* Alerta de Inadimplência */}
      {temMensalidadeAtrasada && (
        <View style={styles.alertaAtraso}>
          <Text style={styles.alertaTitulo}>⚠️ Mensalidade Pendente</Text>
          <Text style={styles.alertaTexto}>
            Identificamos uma mensalidade em aberto. Para continuar agendando suas aulas sem interrupções, por favor, regularize sua situação.
          </Text>
          <TouchableOpacity 
            style={styles.btnAlerta} 
            onPress={() => abrirWhatsApp("Olá! Vi no aplicativo que tenho uma pendência. Como faço para regularizar minha mensalidade?")}
          >
            <Text style={styles.btnAlertaTexto}>Falar com a Recepção</Text>
          </TouchableOpacity>
        </View>
      )}

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
            
            {/* Exibição da Frequência do Mês */}
            <View style={styles.row}>
              <Text style={styles.label}>Aulas neste mês:</Text>
              <Text style={styles.valorDestaque}>{frequenciaMes} presenças</Text>
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
            <View key={item.id} style={[styles.itemFinanceiro, getStatusTexto(item.status, item.data_vencimento) === "ATRASADO" && styles.itemAtrasado]}>
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

      {/* Botão de Suporte WhatsApp */}
      <TouchableOpacity 
        style={styles.botaoWhatsApp} 
        onPress={() => abrirWhatsApp("Olá, Espaço Iluminus! Preciso de ajuda com o meu aplicativo/plano.")}
      >
        <Text style={styles.iconeWhatsApp}>💬</Text>
        <Text style={styles.textoWhatsApp}>Suporte via WhatsApp</Text>
      </TouchableOpacity>

      {/* Botão de Sair */}
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

  // Estilos do Alerta de Atraso
  alertaAtraso: {
    backgroundColor: cores.alertaFundo,
    marginHorizontal: 20,
    marginBottom: 20,
    padding: 15,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: cores.alertaBorda,
  },
  alertaTitulo: { color: cores.vermelho, fontWeight: "bold", fontSize: 16, marginBottom: 5 },
  alertaTexto: { color: "#7F1D1D", fontSize: 13, marginBottom: 15, lineHeight: 18 },
  btnAlerta: { backgroundColor: cores.vermelho, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  btnAlertaTexto: { color: "#FFF", fontWeight: "bold", fontSize: 13 },

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
  valorDestaque: { fontSize: 15, fontWeight: "bold", color: cores.secundaria },
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
  itemAtrasado: {
      backgroundColor: cores.alertaFundo,
      borderColor: cores.alertaBorda,
  },
  mesRef: { fontSize: 10, color: cores.textoSuave, textTransform: "uppercase" },
  dataVenc: { fontSize: 16, fontWeight: "bold", color: cores.texto },
  direitaItem: { alignItems: "flex-end" },
  statusTexto: { fontWeight: "bold", fontSize: 12 },
  valorPago: { fontSize: 10, color: cores.textoSuave, marginTop: 2 },

  // Estilos do Botão WhatsApp
  botaoWhatsApp: {
    marginHorizontal: 20,
    marginTop: 25,
    marginBottom: 5,
    padding: 16,
    backgroundColor: cores.whatsApp,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    elevation: 2,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  iconeWhatsApp: { fontSize: 18, marginRight: 8 },
  textoWhatsApp: { color: "#FFF", fontWeight: "bold", fontSize: 15 },

  botaoSair: {
    marginHorizontal: 20,
    marginTop: 10,
    padding: 16,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#E5E5E5",
    borderRadius: 15,
    alignItems: "center",
  },
  textoSair: { color: cores.vermelho, fontWeight: "bold" },
});