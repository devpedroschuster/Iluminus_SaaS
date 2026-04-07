import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Dimensions, Animated } from 'react-native';
import Modal from 'react-native-modal';
import * as Haptics from 'expo-haptics';
import { supabase } from '../services/supabase';

const { height } = Dimensions.get('window');

// COMPONENTE
const SkeletonCard = () => {
  const opacidade = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacidade, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(opacidade, { toValue: 0.3, duration: 800, useNativeDriver: true })
      ])
    ).start();
  }, [opacidade]);

  return (
    <Animated.View style={[styles.skeletonContainer, { opacity: opacidade }]}>
      <View style={styles.skeletonContent}>
        <View style={styles.skeletonLineFull} />
        <View style={styles.skeletonLineHalf} />
      </View>
      <View style={styles.skeletonBoxRight} />
    </Animated.View>
  );
};

export default function AgendamentoBottomSheet({ 
  isVisible, 
  onClose, 
  aulasDisponiveis, 
  alunoId, 
  isLoading = false,
  isError = false,
  onRefresh
}) {
  const [processandoId, setProcessandoId] = useState(null);
  const [sucessoId, setSucessoId] = useState(null);
  
  const travaClique = useRef(false);

  useEffect(() => {
    if (isVisible) {
      setProcessandoId(null);
      setSucessoId(null);
      travaClique.current = false;
    }
  }, [isVisible]);

  const realizarAgendamentoInline = async (aula) => {
    if (travaClique.current) return;
    
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    travaClique.current = true;
    setProcessandoId(aula.id);

    try {
      const { error } = await supabase.rpc('agendar_aula', {
        p_aluno_id: alunoId,
        p_agenda_id: aula.id
      });

      if (error) {
        let msgErro = error.message;
        if (msgErro.includes(":")) msgErro = msgErro.split(":").pop().trim();
        throw new Error(msgErro);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSucessoId(aula.id);

      setTimeout(() => {
        onClose();
        if(onRefresh) onRefresh();
      }, 1500);

    } catch (err) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      alert(err.message || 'Erro ao garantir a vaga. Tente novamente.');
      travaClique.current = false;
    } finally {
      setProcessandoId(null);
    }
  };

  return (
    <Modal
      isVisible={isVisible}
      onBackdropPress={onClose}
      onSwipeComplete={onClose}
      swipeDirection="down"
      style={styles.modalContainer}
      propagateSwipe={true}
    >
      <View style={styles.content}>
        <View style={styles.dragHandle} />

        <View>
          <Text style={styles.title}>Agendamento Rápido</Text>
          <Text style={styles.subtitle}>Toque na aula para garantir sua vaga</Text>
          
          <View style={styles.listContainer}>
            
            {isLoading ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : 
            
            isError ? (
              <View style={styles.centerContainer}>
                <Text style={styles.errorTitle}>Ops! Algo deu errado.</Text>
                <Text style={styles.errorSub}>Não conseguimos carregar as aulas de hoje.</Text>
                <TouchableOpacity style={styles.btnTentar} onPress={onRefresh}>
                  <Text style={styles.btnTentarTexto}>Tentar Novamente</Text>
                </TouchableOpacity>
              </View>
            ) : 
            
            aulasDisponiveis && aulasDisponiveis.length > 0 ? (
              aulasDisponiveis.map((aula) => {
                const isProcessando = processandoId === aula.id;
                const isSucesso = sucessoId === aula.id;

                return (
                  <TouchableOpacity 
                    key={aula.id}
                    style={[
                      styles.cardAula, 
                      isSucesso && styles.cardAulaSucesso
                    ]} 
                    onPress={() => realizarAgendamentoInline(aula)}
                    disabled={processandoId !== null || sucessoId !== null}
                  >
                    <View>
                      <Text style={[styles.aulaNome, isSucesso && styles.textoBranco]}>
                        {aula.atividade}
                      </Text>
                      <Text style={[styles.aulaDetalhes, isSucesso && styles.textoBrancoTransparente]}>
                        {aula.horario ? aula.horario.slice(0, 5) : '--:--'} • {aula.espaco === 'funcional' ? 'Funcional' : 'Dança'}
                      </Text>
                    </View>
                    
                    <View style={styles.actionContainer}>
                      {isProcessando ? (
                        <ActivityIndicator color="#D98E73" />
                      ) : isSucesso ? (
                        <Text style={styles.iconeSucessoInline}>✅</Text>
                      ) : (
                        <Text style={styles.btnSelecionar}>Agendar</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })
            ) : (
              <Text style={styles.vazioTexto}>Não há aulas disponíveis para hoje.</Text>
            )}

          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    justifyContent: 'flex-end',
    margin: 0,
  },
  content: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    minHeight: height * 0.4,
    maxHeight: height * 0.8,
  },
  dragHandle: {
    width: 40,
    height: 5,
    backgroundColor: '#E0E0E0',
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 5, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 20 },
  listContainer: { marginTop: 10 },
  
  // Estilos da Lista Inline
  cardAula: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F1F3F5',
  },
  cardAulaSucesso: {
    backgroundColor: '#8A9A5B',
    borderColor: '#8A9A5B',
  },
  aulaNome: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  aulaDetalhes: { fontSize: 13, color: '#888', marginTop: 4 },
  textoBranco: { color: '#FFF' },
  textoBrancoTransparente: { color: 'rgba(255, 255, 255, 0.8)' },
  
  actionContainer: {
    minWidth: 70,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  btnSelecionar: { color: '#D98E73', fontWeight: 'bold' },
  iconeSucessoInline: { fontSize: 18 },
  
  vazioTexto: { textAlign: 'center', color: '#999', marginTop: 20 },

  // Estilos UX
  skeletonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F1F3F5',
  },
  skeletonContent: { flex: 1 },
  skeletonLineFull: { height: 16, backgroundColor: '#E0E0E0', borderRadius: 8, width: '70%', marginBottom: 8 },
  skeletonLineHalf: { height: 12, backgroundColor: '#E0E0E0', borderRadius: 6, width: '40%' },
  skeletonBoxRight: { width: 70, height: 16, backgroundColor: '#E0E0E0', borderRadius: 8 },
  
  centerContainer: { padding: 30, alignItems: 'center', justifyContent: 'center' },
  errorTitle: { fontSize: 18, fontWeight: 'bold', color: '#E07A5F', marginBottom: 4 },
  errorSub: { fontSize: 14, color: '#8E8E8E', marginBottom: 20, textAlign: 'center' },
  btnTentar: { backgroundColor: '#F8F9FA', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, borderWidth: 1, borderColor: '#E5E5E5' },
  btnTentarTexto: { color: '#333', fontWeight: 'bold' },
});