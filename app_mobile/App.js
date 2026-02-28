import React, { useEffect, useState } from "react";
import {
    FlatList,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import CardAula from "../src/components/CardAula";
import { supabase } from "../src/services/supabase";
console.log(CardAula, React);

export default function App() {
  // '1' para Funcional, '2' para Dança (ajuste conforme seus IDs no banco)
  const [agendaSelecionada, setAgendaSelecionada] = useState(1);
  const [aulas, setAulas] = useState([]);

  async function buscarAulas() {
    const { data, error } = await supabase
      .from("agendas")
      .select("*")
      .eq("espaco_id", agendaSelecionada); // Aqui o filtro acontece!

    if (error) console.error(error);
    else setAulas(data);
  }

  // Toda vez que 'agendaSelecionada' mudar, ele busca no banco de novo
  useEffect(() => {
    buscarAulas();
  }, [agendaSelecionada]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <Text style={styles.titulo}>Agendamentos</Text>

        {/* Seletores de Agenda */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tab, agendaSelecionada === 1 && styles.tabAtiva]}
            onPress={() => setAgendaSelecionada(1)}
          >
            <Text
              style={
                agendaSelecionada === 1
                  ? styles.textoAtivo
                  : styles.textoInativo
              }
            >
              Funcional
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tab, agendaSelecionada === 2 && styles.tabAtiva]}
            onPress={() => setAgendaSelecionada(2)}
          >
            <Text
              style={
                agendaSelecionada === 2
                  ? styles.textoAtivo
                  : styles.textoInativo
              }
            >
              Dança
            </Text>
          </TouchableOpacity>
        </View>

        {/* Lista de Aulas Reais */}
        <FlatList
          data={aulas}
          keyExtractor={(item) => item.id.toString()}
          renderItem={({ item }) => (
            <CardAula aula={item} onAgendamentoSucesso={() => buscarAulas()} />
          )}
          ListEmptyComponent={
            <Text style={styles.vazio}>Nenhuma aula nesta agenda.</Text>
          }
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8F9FA", padding: 20 },
  titulo: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 20,
    color: "#1A1A1A",
  },
  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#E9ECEF",
    borderRadius: 10,
    padding: 5,
    marginBottom: 20,
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 8 },
  tabAtiva: {
    backgroundColor: "#FFF",
    elevation: 3,
    shadowColor: "#000",
    shadowOpacity: 0.1,
  },
  textoAtivo: { fontWeight: "bold", color: "#000" },
  textoInativo: { color: "#6C757D" },
  vazio: { textAlign: "center", marginTop: 50, color: "#999" },
});
