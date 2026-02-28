import { format } from "date-fns";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
};

export default function CardAula({
  aula,
  alunoId,
  dataSelecionada,
  onAgendamentoSucesso,
}) {
  const [processando, setProcessando] = useState(false);

  if (!aula) return null;

  // Monta dados
  const dataIso = format(dataSelecionada, "yyyy-MM-dd");
  const dataAulaCompleta = `${dataIso}T${aula.horario}`;
  const dataAulaObj = new Date(dataAulaCompleta);
  const dataLimite = new Date(dataAulaObj.getTime() + 20 * 60000);
  const aulaJaPassou = new Date() > dataLimite;

  // Verificações locais
  const jaAgendado = aula.presencas?.some((p) => {
    const dataPresenca = p.data_checkin.split("T")[0];
    return p.aluno_id === alunoId && dataPresenca === dataIso;
  });

  const vagasOcupadas =
    aula.presencas?.filter((p) => p.data_checkin.startsWith(dataIso)).length ||
    0;
  const lotado = vagasOcupadas >= (aula.capacidade || 15);
  const horarioFormatado = aula.horario
    ? aula.horario.substring(0, 5)
    : "--:--";

  // --- TRATAMENTO DE ERROS CENTRALIZADO ---
  const tratarErro = (erro, titulo = "Erro") => {
    console.error(erro); // Mantém log para debug do dev
    let mensagem = "Ocorreu uma falha inesperada. Tente novamente.";

    if (erro.message) {
      if (erro.message.includes("Network request failed"))
        mensagem = "Verifique sua conexão com a internet.";
      else if (erro.message.includes("JWT"))
        mensagem = "Sua sessão expirou. Saia e entre novamente.";
      else if (erro.message.includes("acabou de ser preenchida"))
        mensagem = "A última vaga foi preenchida agora mesmo.";
      else if (erro.message.includes("já está agendado"))
        mensagem = "Você já está na lista desta aula.";
      else if (erro.message.includes("policy"))
        mensagem = "Operação não permitida pelas regras de segurança.";
      else mensagem = erro.message; // Mensagem direta do banco se for amigável
    }

    Alert.alert(titulo, mensagem);
  };

  async function handleAcao() {
    if (processando) return; // Evita duplo clique

    // Bloqueios de UX
    if (aulaJaPassou && !jaAgendado) {
      Alert.alert("Encerrada", "O horário desta aula já passou.");
      return;
    }

    if (jaAgendado) {
      // --- FLUXO DE CANCELAR ---
      Alert.alert("Cancelar", "Deseja liberar sua vaga?", [
        { text: "Manter", style: "cancel" },
        {
          text: "Sim, cancelar",
          style: "destructive",
          onPress: async () => {
            try {
              setProcessando(true);
              const inicioDia = `${dataIso}T00:00:00`;
              const fimDia = `${dataIso}T23:59:59`;

              const { error } = await supabase
                .from("presencas")
                .delete()
                .eq("aula_id", aula.id)
                .eq("aluno_id", alunoId)
                .gte("data_checkin", inicioDia)
                .lte("data_checkin", fimDia);

              if (error) throw error;
              onAgendamentoSucesso();
            } catch (err) {
              tratarErro(err, "Falha ao Cancelar");
            } finally {
              setProcessando(false);
            }
          },
        },
      ]);
    } else {
      // --- FLUXO DE AGENDAR ---
      try {
        setProcessando(true);
        const { error } = await supabase.rpc("agendar_aula", {
          p_aluno_id: alunoId,
          p_aula_id: aula.id,
          p_data_checkin: dataAulaCompleta,
        });

        if (error) throw error;

        Alert.alert(
          "Sucesso!",
          `Vaga garantida para ${horarioFormatado}. Bom treino!`,
        );
        onAgendamentoSucesso();
      } catch (err) {
        tratarErro(err, "Não foi possível agendar");
      } finally {
        setProcessando(false);
      }
    }
  }

  // Estilos do botão
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
          Vagas: {vagasOcupadas}/{aula.capacidade}
        </Text>
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
  info: { flex: 1, paddingLeft: 15 },
  atividade: {
    fontSize: 16,
    fontWeight: "bold",
    color: cores.texto,
    marginBottom: 4,
  },
  professor: { fontSize: 12, color: cores.textoSuave },

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
