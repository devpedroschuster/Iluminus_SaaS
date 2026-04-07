import { format } from "date-fns";
import { useState, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../services/supabase";

const cores = {
  primaria: "#D98E73",
  secundaria: "#8A9A5B",
  texto: "#2D2D2D",
  textoSuave: "#8E8E8E",
  branco: "#FFFFFF",
  erro: "#E07A5F",
  desabilitado: "#E5E5E5",
  textoDesabilitado: "#A0A0A0",
  alertaVaga: "#E9C46A", 
};

export default function CardAula({
  aula,
  alunoId,
  dataSelecionada,
  onAgendamentoSucesso,
}) {
  const [processando, setProcessando] = useState(false);
  const travaClique = useRef(false);

  if (!aula) return null;

  const dataIso = format(dataSelecionada, "yyyy-MM-dd");
  const dataAulaCompleta = `${dataIso}T${aula.horario}`;
  const dataAulaObj = new Date(dataAulaCompleta);
  const dataLimite = new Date(dataAulaObj.getTime() + 20 * 60000); 
  const aulaJaPassou = new Date() > dataLimite;

  const jaAgendado = aula.presencas?.some((p) => {
    if (!p.aluno_id || !alunoId) return false;
    const dataRaw = p.data_aula || p.data_checkin;
    const dataPresenca = dataRaw ? dataRaw.split("T")[0] : null;
    return String(p.aluno_id) === String(alunoId) && dataPresenca === dataIso;
  });

  const vagasOcupadas =
    aula.presencas?.filter((p) => {
      const dataRaw = p.data_aula || p.data_checkin;
      const dataP = dataRaw ? dataRaw.split("T")[0] : null;
      return dataP === dataIso;
    }).length || 0;
    
  const capacidadeReal = aula.capacidade || 15;
  const lotado = vagasOcupadas >= capacidadeReal;
  const vagasRestantes = capacidadeReal - vagasOcupadas;
  const horarioFormatado = aula.horario ? aula.horario.substring(0, 5) : "--:--";

  // BARRA DE PROGRESSO
  const ocupacaoPercentual = Math.min((vagasOcupadas / capacidadeReal) * 100, 100);
  
  const getCorVagas = () => {
    if (ocupacaoPercentual < 60) return cores.secundaria;
    if (ocupacaoPercentual <= 85) return cores.alertaVaga;
    return cores.erro;
  };
  // ------------------------------------

  const tratarErro = (erro, titulo = "Atenção") => {
    console.error(erro);
    let mensagem = erro.message || "Ocorreu uma falha inesperada. Tente novamente.";
    if (mensagem.includes(":")) {
        mensagem = mensagem.split(":").pop().trim();
    }
    if (Platform.OS === "web") window.alert(`${titulo}: ${mensagem}`);
    else Alert.alert(titulo, mensagem);
  };

  async function executarCancelamento() {
    if (travaClique.current) return;
    travaClique.current = true;

    try {
      setProcessando(true);
      const { error } = await supabase.rpc("cancelar_agendamento", {
        p_aluno_id: alunoId,
        p_agenda_id: aula.id, 
      });

      if (error) throw error;
      onAgendamentoSucesso();
    } catch (err) {
      tratarErro(err, "Não foi possível cancelar");
    } finally {
      travaClique.current = false;
      setProcessando(false);
    }
  }

  async function handleAcao() {
    if (processando || travaClique.current) return;

    if (aulaJaPassou && !jaAgendado) {
      if (Platform.OS === "web") window.alert("O horário desta aula já passou.");
      else Alert.alert("Encerrada", "O horário desta aula já passou.");
      return;
    }

    if (jaAgendado) {
      if (Platform.OS === "web") {
        const confirmou = window.confirm("Deseja liberar sua vaga?");
        if (confirmou) executarCancelamento();
      } else {
        Alert.alert("Cancelar", "Deseja liberar sua vaga?", [
          { text: "Manter", style: "cancel" },
          { text: "Sim, cancelar", style: "destructive", onPress: executarCancelamento },
        ]);
      }
    } else {
      travaClique.current = true;
      try {
        setProcessando(true);
        const { error } = await supabase.rpc("agendar_aula", {
          p_aluno_id: alunoId,
          p_agenda_id: aula.id, 
        });

        if (error) throw error;

        if (Platform.OS === "web") window.alert(`Vaga garantida para ${horarioFormatado}. Bom treino!`);
        else Alert.alert("Sucesso!", `Vaga garantida para ${horarioFormatado}. Bom treino!`);
        
        onAgendamentoSucesso();
      } catch (err) {
        tratarErro(err, "Não foi possível agendar");
      } finally {
        travaClique.current = false;
        setProcessando(false);
      }
    }
  }

  const getEstiloBotao = () => {
    if (jaAgendado) return styles.botaoCancelar;
    if (aulaJaPassou) return styles.botaoPassou;
    if (lotado) return styles.botaoLotado;
    return styles.botaoReservar;
  };

  const getTextoBotao = () => {
    if (jaAgendado) return "Cancelar";
    if (aulaJaPassou) return "Encerrada";
    if (lotado) return "Lotado";
    return "Agendar";
  };

  return (
    <View
      style={[styles.card, aulaJaPassou && !jaAgendado && styles.cardPassou]}
    >
      <View style={styles.containerHorario}>
        <Text
          style={[
            styles.textoHorario,
            aulaJaPassou && !jaAgendado && styles.textoPassou,
          ]}
        >
          {horarioFormatado}
        </Text>
        <Text
          style={[
            styles.textoEspaco,
            aulaJaPassou && !jaAgendado && styles.textoPassou,
          ]}
        >
          {aula.espaco === "danca" ? "Dança" : "Funcional"}
        </Text>
      </View>

      <View style={styles.info}>
        <Text
          style={[
            styles.atividade,
            aulaJaPassou && !jaAgendado && styles.textoPassou,
          ]}
        >
          {aula.atividade}
        </Text>
        <Text style={styles.professor}>
          Prof. {aula.professores?.nome?.split(' ')[0] || 'Sem Professor'}
        </Text>
        
        <View style={styles.containerVagas}>
          <View style={styles.headerVagas}>
            {vagasRestantes === 1 && !aulaJaPassou ? (
              <Text style={styles.textoUltimaVaga}>🔥 Última vaga!</Text>
            ) : lotado ? (
              <Text style={styles.textoLotado}>Lotado</Text>
            ) : (
              <Text style={styles.textoVagas}>
                {vagasOcupadas}/{capacidadeReal} vagas ocupadas
              </Text>
            )}
          </View>
          <View style={styles.barraFundo}>
            <View
              style={[
                styles.barraPreenchimento,
                { 
                  width: `${ocupacaoPercentual}%`, 
                  backgroundColor: aulaJaPassou && !jaAgendado ? "#E5E5E5" : getCorVagas() 
                },
              ]}
            />
          </View>
        </View>

      </View>

      <TouchableOpacity
        style={[styles.botao, getEstiloBotao()]}
        onPress={handleAcao}
        disabled={((lotado || aulaJaPassou) && !jaAgendado) || processando}
      >
        {processando ? (
          <ActivityIndicator
            size="small"
            color={jaAgendado ? cores.primaria : "#FFF"}
          />
        ) : (
          <Text
            style={[
              styles.textoBotao,
              jaAgendado && styles.textoBotaoCancelar,
              aulaJaPassou && !jaAgendado && styles.textoBotaoPassou,
            ]}
          >
            {getTextoBotao()}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#F0E0D6",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  cardPassou: { backgroundColor: "#F9F9F9", borderColor: "#EEE", elevation: 0 },
  containerHorario: {
    paddingRight: 15,
    borderRightWidth: 1,
    borderRightColor: "#F0E0D6",
    alignItems: "center",
    minWidth: 80,
  },
  textoHorario: { fontSize: 18, fontWeight: "900", color: cores.primaria },
  textoEspaco: {
    fontSize: 10,
    color: cores.secundaria,
    fontWeight: "bold",
    textTransform: "uppercase",
    marginTop: 4,
  },
  textoPassou: { color: cores.textoSuave },
  info: { flex: 1, paddingLeft: 15, paddingRight: 10 },
  atividade: {
    fontSize: 16,
    fontWeight: "bold",
    color: cores.texto,
    marginBottom: 2,
  },
  professor: { fontSize: 12, color: cores.textoSuave },

  containerVagas: { marginTop: 8 },
  headerVagas: { flexDirection: "row", marginBottom: 4 },
  textoVagas: { fontSize: 11, color: cores.textoSuave, fontWeight: "500" },
  textoUltimaVaga: { fontSize: 11, color: cores.erro, fontWeight: "bold" },
  textoLotado: { fontSize: 11, color: cores.textoSuave, fontWeight: "bold" },
  barraFundo: { 
    height: 6, 
    backgroundColor: "#F0F0F0", 
    borderRadius: 3, 
    overflow: "hidden" 
  },
  barraPreenchimento: { 
    height: "100%", 
    borderRadius: 3 
  },

  botao: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    minWidth: 90,
    alignItems: "center",
    justifyContent: "center",
    height: 40,
  },
  botaoReservar: { backgroundColor: cores.primaria },
  botaoCancelar: {
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#E5E5E5",
  },
  botaoLotado: { backgroundColor: "#EEE" },
  botaoPassou: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#EEE",
  },

  textoBotao: { color: "#FFF", fontWeight: "bold", fontSize: 12 },
  textoBotaoCancelar: { color: "#888" },
  textoBotaoPassou: { color: "#CCC" },
});