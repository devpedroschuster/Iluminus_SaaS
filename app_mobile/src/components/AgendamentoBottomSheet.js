import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Dimensions } from 'react-native';
import Modal from 'react-native-modal';
import { supabase } from '../services/supabase';

const { height } = Dimensions.get('window');

export default function AgendamentoBottomSheet({ isVisible, onClose, aulasDisponiveis, alunoId }) {
  const [step, setStep] = useState(1);
  const [aulaSelecionada, setAulaSelecionada] = useState(null);
  const [isAgendando, setIsAgendando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (isVisible) {
      setStep(1);
      setAulaSelecionada(null);
      setErro('');
    }
  }, [isVisible]);

  const confirmarAgendamento = async () => {
    if (!aulaSelecionada) return;
    
    setIsAgendando(true);
    setErro('');

    try {
      const dataAula = aulaSelecionada.data_especifica || new Date().toISOString().split('T')[0];

      const { data, error } = await supabase.rpc('agendar_aula', {
        p_aluno_id: alunoId,
        p_aula_id: aulaSelecionada.id,
        p_data: dataAula
      });

      if (error) throw error;

      setStep(3);
    } catch (err) {
      console.error(err);
      setErro(err.message || 'Erro ao garantir a vaga. Tente novamente.');
    } finally {
      setIsAgendando(false);
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

        {step === 1 && (
          <View>
            <Text style={styles.title}>Passo 1: Escolher a Aula</Text>
            <Text style={styles.subtitle}>Para que aula se quer inscrever hoje?</Text>
            
            <View style={styles.listContainer}>
              {aulasDisponiveis && aulasDisponiveis.length > 0 ? (
                aulasDisponiveis.map((aula) => (
                  <TouchableOpacity 
                    key={aula.id}
                    style={styles.cardAula} 
                    onPress={() => { setAulaSelecionada(aula); setStep(2); }}
                  >
                    <View>
                      <Text style={styles.aulaNome}>{aula.atividade}</Text>
                      <Text style={styles.aulaDetalhes}>
                        {aula.horario.slice(0, 5)} • {aula.espaco === 'funcional' ? 'Treino Funcional' : 'Dança'}
                      </Text>
                    </View>
                    <Text style={styles.btnSelecionar}>Selecionar</Text>
                  </TouchableOpacity>
                ))
              ) : (
                <Text style={styles.vazioTexto}>Não há aulas disponíveis para agendamento rápido hoje.</Text>
              )}
            </View>
          </View>
        )}

        {step === 2 && aulaSelecionada && (
          <View style={styles.centerContent}>
            <Text style={styles.title}>Passo 2: Confirmar Presença</Text>
            
            <View style={styles.resumoBox}>
              <Text style={styles.resumoAtividade}>{aulaSelecionada.atividade}</Text>
              <Text style={styles.resumoInfo}>Horário: {aulaSelecionada.horario.slice(0, 5)}</Text>
            </View>

            {erro ? <Text style={styles.erroTexto}>{erro}</Text> : null}

            <TouchableOpacity 
              style={[styles.btnPrincipal, isAgendando && styles.btnDesativado]} 
              onPress={confirmarAgendamento}
              disabled={isAgendando}
            >
              {isAgendando ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnPrincipalTexto}>Garantir a minha vaga</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.btnVoltar} onPress={() => setStep(1)} disabled={isAgendando}>
              <Text style={styles.btnVoltarTexto}>Voltar à lista</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 3 && (
          <View style={styles.centerContent}>
            <Text style={styles.iconeSucesso}>✅</Text>
            <Text style={styles.title}>Vaga Garantida!</Text>
            <Text style={styles.subtitle}>A sua presença foi confirmada com sucesso.</Text>
            
            <TouchableOpacity style={styles.btnPrincipal} onPress={onClose}>
              <Text style={styles.btnPrincipalTexto}>Concluir</Text>
            </TouchableOpacity>
          </View>
        )}
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
  aulaNome: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  aulaDetalhes: { fontSize: 13, color: '#888', marginTop: 4 },
  btnSelecionar: { color: '#007AFF', fontWeight: 'bold' },
  centerContent: { alignItems: 'center', paddingVertical: 10 },
  resumoBox: {
    backgroundColor: '#F0F7FF',
    padding: 20,
    borderRadius: 16,
    width: '100%',
    alignItems: 'center',
    marginBottom: 24,
  },
  resumoAtividade: { fontSize: 22, fontWeight: 'bold', color: '#0056b3', marginBottom: 8 },
  resumoInfo: { fontSize: 16, color: '#004085' },
  btnPrincipal: {
    backgroundColor: '#007AFF',
    width: '100%',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnDesativado: { opacity: 0.7 },
  btnPrincipalTexto: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  btnVoltar: { marginTop: 16, padding: 10 },
  btnVoltarTexto: { color: '#666', fontSize: 14, fontWeight: '600' },
  iconeSucesso: { fontSize: 60, marginBottom: 16 },
  erroTexto: { color: 'red', marginBottom: 16, textAlign: 'center' },
  vazioTexto: { textAlign: 'center', color: '#999', marginTop: 20 }
});