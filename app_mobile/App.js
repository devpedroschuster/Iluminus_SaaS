import AsyncStorage from "@react-native-async-storage/async-storage";
import { addDays, format, isSameDay, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

// Componentes
import CardAula from "./src/components/CardAula";
import TelaLogin from "./src/components/TelaLogin";
import TelaPerfil from "./src/components/TelaPerfil";
import AgendamentoBottomSheet from "./src/components/AgendamentoBottomSheet";
import { supabase } from "./src/services/supabase";

const cores = {
  fundo: "#FDF8F5",
  primaria: "#D98E73",
  secundaria: "#8A9A5B",
  texto: "#2D2D2D",
  textoSuave: "#8E8E8E",
  branco: "#FFFFFF",
  ativo: "#D98E73",
  inativo: "#C4C4C4",
};

export default function App() {
  const [alunoId, setAlunoId] = useState(null);
  const [nomeAluno, setNomeAluno] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [telaAtual, setTelaAtual] = useState("agenda");
  const [feriadoMsg, setFeriadoMsg] = useState(null);
  const [modalAgendamentoVisivel, setModalAgendamentoVisivel] = useState(false);
  const [dataSelecionada, setDataSelecionada] = useState(startOfDay(new Date()));
  const [aulas, setAulas] = useState([]);

  useEffect(() => {
    verificarSessao();
  }, []);

  // MUDANÇAS EM TEMPO REAL
  useEffect(() => {
    if (!alunoId) return;

    const channel = supabase
      .channel('mudancas-globais-presencas')
      .on('postgres_changes', {
        event: '*', 
        schema: 'public',
        table: 'presencas'
      }, (payload) => {
        console.log("🔄 Mudança detectada nas vagas!", payload);
        buscarAulas(false);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [alunoId]);

  useEffect(() => {
    if (alunoId && telaAtual === "agenda") buscarAulas(true);
  }, [dataSelecionada, alunoId, telaAtual]);

  async function verificarSessao() {
    try {
      setCarregando(true);
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) throw new Error("Sessão expirada");

      const { data: aluno, error: alunoError } = await supabase
        .from("alunos")
        .select("id, nome_completo")
        .eq("auth_id", session.user.id)
        .single();

      if (alunoError || !aluno) throw new Error("Perfil não encontrado");

      setAlunoId(aluno.id);
      setNomeAluno(aluno.nome_completo);
      await AsyncStorage.setItem("@aluno_id", String(aluno.id));
      await AsyncStorage.setItem("@aluno_nome", aluno.nome_completo);
    } catch (e) {
      await handleLogout();
    } finally {
      setCarregando(false);
    }
  }

  async function buscarAulas(mostrarLoading = true) {
    if (mostrarLoading) setCarregando(true);
    const dataIso = format(dataSelecionada, "yyyy-MM-dd");

    try {
      // 1. PRIMEIRO VERIFICA SE É FERIADO
      const { data: feriados, error: errFeriado } = await supabase
        .from("feriados")
        .select("descricao")
        .eq("data", dataIso);

      if (errFeriado) throw errFeriado;

      if (feriados && feriados.length > 0) {
        setFeriadoMsg(feriados[0].descricao);
        setAulas([]); 
        setCarregando(false);
        return; 
      } else {
        setFeriadoMsg(null); 
      }

      // 2. SE NÃO É FERIADO, BUSCA AS AULAS NORMALMENTE
      const { data, error } = await supabase
        .from("agenda")
        .select(`*, presencas(*)`)
        .eq("ativa", true)
        .order("horario", { ascending: true });

      if (error) throw error;

      // 3. FILTRA AS AULAS DO DIA ESPECÍFICO
      const diaSemanaAtual = format(dataSelecionada, "EEEE", { locale: ptBR }).toLowerCase();
      const diasTraduzidos = {
        "domingo": "Domingo",
        "segunda-feira": "Segunda-feira",
        "terça-feira": "Terça-feira",
        "quarta-feira": "Quarta-feira",
        "quinta-feira": "Quinta-feira",
        "sexta-feira": "Sexta-feira",
        "sábado": "Sábado",
      };
      const diaCorreto = diasTraduzidos[diaSemanaAtual];

      const aulasDoDia = (data || []).filter((aula) => {
        if (!aula.eh_recorrente) return aula.data_especifica === dataIso;
        return aula.dia_semana === diaCorreto;
      });

      setAulas(aulasDoDia);
    } catch (err) {
      console.error("Erro ao buscar aulas:", err);
      if (err.message.includes("Network")) {
        Alert.alert("Sem conexão", "Verifique sua internet.");
      }
    } finally {
      setCarregando(false);
      setRefreshing(false);
    }
  }

  const onRefresh = () => {
    setRefreshing(true);
    buscarAulas(false);
  };

  async function handleLogout() {
    try {
      setCarregando(true);
      await supabase.auth.signOut();
    } catch (err) {
      console.error("Erro logout:", err);
    } finally {
      await AsyncStorage.multiRemove(["@aluno_id", "@aluno_nome"]);
      setAlunoId(null);
      setNomeAluno("");
      setCarregando(false);
    }
  }

  if (carregando && !alunoId) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={cores.primaria} />
      </View>
    );
  }

  if (!alunoId) {
    return (
      <TelaLogin
        onLogado={(perfil) => {
          setAlunoId(perfil.id);
          setNomeAluno(perfil.nome_completo);
        }}
      />
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          {telaAtual === "agenda" ? (
            <>
              <View style={styles.header}>
                <View>
                  <Text style={styles.saudacao}>Olá, {nomeAluno.split(" ")[0]}!</Text>
                  <Text style={styles.titulo}>Sua Agenda</Text>
                </View>
              </View>

              <View style={styles.calendarioContainer}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {Array.from({ length: 14 }).map((_, i) => {
                    const dia = addDays(new Date(), i);
                    const ativo = isSameDay(dia, dataSelecionada);
                    return (
                      <TouchableOpacity
                        key={dia.toISOString()}
                        onPress={() => setDataSelecionada(startOfDay(dia))}
                        style={[styles.diaCard, ativo && styles.diaCardAtivo]}
                      >
                        <Text style={[styles.diaSemana, ativo && styles.textoAtivo]}>
                          {format(dia, "EEE", { locale: ptBR }).replace(".", "")}
                        </Text>
                        <Text style={[styles.diaNumero, ativo && styles.textoAtivo]}>
                          {format(dia, "d")}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              {/* RENDERIZAÇÃO CONDICIONAL: LOADING, FERIADO OU LISTA */}
              {carregando ? (
                <ActivityIndicator size="large" color={cores.primaria} style={{ marginTop: 50 }} />
              ) : feriadoMsg ? (
                <View style={styles.containerFeriado}>
                  <Text style={styles.emojiFeriado}>🏖️</Text>
                  <Text style={styles.tituloFeriado}>Feriado</Text>
                  <Text style={styles.descFeriado}>{feriadoMsg}</Text>
                  <Text style={styles.avisoFeriado}>
                    O estúdio estará fechado neste dia. Bom descanso!
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={aulas}
                  keyExtractor={(item) => item.id.toString()}
                  renderItem={({ item }) => (
                    <CardAula
                      aula={item}
                      alunoId={alunoId}
                      dataSelecionada={dataSelecionada}
                      onAgendamentoSucesso={() => buscarAulas(false)}
                    />
                  )}
                  contentContainerStyle={{ paddingBottom: 80 }}
                  refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[cores.primaria]} tintColor={cores.primaria} />
                  }
                  ListEmptyComponent={
                    <View style={styles.containerVazio}>
                      <Text style={styles.vazio}>Nenhuma aula disponível para este dia.</Text>
                    </View>
                  }
                />
              )}

              {/* Botão Flutuante (FAB) */}
              <TouchableOpacity 
                style={styles.fab} 
                activeOpacity={0.8}
                onPress={() => setModalAgendamentoVisivel(true)}
              >
                <Text style={styles.fabText}>+</Text>
              </TouchableOpacity>

              {/* Bottom Sheet de Agendamento Rápido */}
              <AgendamentoBottomSheet 
                isVisible={modalAgendamentoVisivel}
                onClose={() => {
                  setModalAgendamentoVisivel(false);
                  buscarAulas(false); 
                }}
                aulasDisponiveis={aulas}
                alunoId={alunoId}
              />
            </>
          ) : (
            <TelaPerfil alunoId={alunoId} onLogout={handleLogout} />
          )}
        </View>

        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.tabButton} onPress={() => setTelaAtual("agenda")}>
            <Text style={{ fontSize: 24 }}>📅</Text>
            <Text style={[styles.tabText, telaAtual === "agenda" ? styles.tabTextAtivo : null]}>Agenda</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.tabButton} onPress={() => setTelaAtual("perfil")}>
            <Text style={{ fontSize: 24 }}>👤</Text>
            <Text style={[styles.tabText, telaAtual === "perfil" ? styles.tabTextAtivo : null]}>Meu Perfil</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingScreen: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: cores.fundo },
  container: { flex: 1, backgroundColor: cores.fundo },
  content: { flex: 1, paddingHorizontal: 20, position: 'relative' },

  header: { marginVertical: 20 },
  saudacao: { fontSize: 14, color: cores.textoSuave },
  titulo: { fontSize: 24, fontWeight: "bold", color: cores.texto },

  calendarioContainer: { marginBottom: 20, height: 80 },
  diaCard: { backgroundColor: cores.branco, width: 60, height: 75, borderRadius: 18, justifyContent: "center", alignItems: "center", marginRight: 10, borderWidth: 1, borderColor: "#F0E0D6" },
  diaCardAtivo: { backgroundColor: cores.primaria, borderColor: cores.primaria },
  diaSemana: { fontSize: 12, color: cores.textoSuave, textTransform: "uppercase" },
  diaNumero: { fontSize: 18, fontWeight: "bold", color: cores.texto },
  textoAtivo: { color: cores.branco },

  containerVazio: { marginTop: 50, alignItems: "center" },
  vazio: { color: cores.textoSuave, fontSize: 16 },

  // Estilos do Feriado
  containerFeriado: { marginTop: 60, alignItems: "center", paddingHorizontal: 20 },
  emojiFeriado: { fontSize: 48, marginBottom: 10 },
  tituloFeriado: { fontSize: 20, fontWeight: "bold", color: cores.primaria, textAlign: "center", marginBottom: 5 },
  descFeriado: { fontSize: 16, color: cores.textoSuave, textAlign: "center" },
  avisoFeriado: { fontSize: 14, color: cores.textoSuave, textAlign: "center", marginTop: 15 },

  // Estilos do FAB
  fab: {
    position: "absolute",
    right: 20,
    bottom: 20,
    backgroundColor: cores.primaria,
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  fabText: {
    color: cores.branco,
    fontSize: 32,
    fontWeight: "300",
    marginTop: -4,
  },

  bottomBar: { flexDirection: "row", backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#F0E0D6", paddingVertical: 10, paddingBottom: 20, elevation: 10, shadowColor: "#000", shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.1, shadowRadius: 4 },
  tabButton: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  tabText: { fontSize: 10, fontWeight: "bold", color: cores.inativo, textTransform: "uppercase" },
  tabTextAtivo: { color: cores.ativo },
});