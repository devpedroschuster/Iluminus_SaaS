import { useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { Save, RefreshCw, Calculator, Percent, DollarSign, Info } from 'lucide-react';

import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Surface from '../components/ui/Surface';

import {
  useConfiguracoesRepasse,
  useSalvarConfiguracoesRepasse,
} from '../hooks/useConfiguracoesRepasse';

// ─── CR1 FIX: soma-avulsa agora valida aula_avulsa igual ao soma-livre ────────
const schema = yup.object().shape({
  valor_1_modalidade: yup.number().min(0).required('Campo obrigatório'),
  valor_multi_modalidade: yup.number().min(0).required('Campo obrigatório'),
  plano_livre_pct_casa: yup.number().min(0).max(100).required('Campo obrigatório'),
  plano_livre_pct_prof: yup.number().min(0).max(100).required('Campo obrigatório'),
  aula_experimental_valor: yup
    .number()
    .min(0)
    .required('Campo obrigatório'),
  aula_experimental_pct_prof: yup.number().min(0).max(100).required('Campo obrigatório'),
  aula_avulsa_valor: yup
    .number()
    .min(0)
    .required('Campo obrigatório'),
  aula_avulsa_pct_casa: yup.number().min(0).max(100).required('Campo obrigatório'),
  aula_avulsa_pct_prof: yup.number().min(0).max(100).required('Campo obrigatório'),
})
  .test('soma-livre', 'A soma do Plano Livre deve ser 100%', (values) => {
    return (Number(values.plano_livre_pct_casa) + Number(values.plano_livre_pct_prof)) === 100;
  })
  // CR1 FIX: validação de soma para aula avulsa
  .test('soma-avulsa', 'A soma da Aula Avulsa (% Casa + % Prof.) deve ser 100%', (values) => {
    return (Number(values.aula_avulsa_pct_casa) + Number(values.aula_avulsa_pct_prof)) === 100;
  });

// ─── Tooltip simples ──────────────────────────────────────────────────────────
function Tooltip({ text }) {
  return (
    <span className="group relative inline-flex items-center cursor-help">
      <Info size={13} className="text-muted-foreground/50 hover:text-primary transition-colors" />
      <span className="
        pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50
        w-56 rounded-xl bg-foreground/90 text-background text-[11px] font-medium leading-snug
        px-3 py-2 shadow-lg
        opacity-0 group-hover:opacity-100 transition-opacity duration-150
      ">
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-foreground/90" />
      </span>
    </span>
  );
}

// ─── Simulador de divisão em R$ ───────────────────────────────────────────────
function DivisaoSimulada({ label, valor, pctProf, pctCasa, pctCasaLabel = '% Casa' }) {
  if (!valor || valor <= 0) return null;
  const prof = ((pctProf / 100) * valor).toFixed(2);
  const casa = pctCasa != null ? ((pctCasa / 100) * valor).toFixed(2) : null;

  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px] font-semibold text-muted-foreground bg-muted/40 rounded-xl px-3 py-2 mt-1">
      <Calculator size={12} className="text-primary shrink-0" />
      <span>Exemplo com <span className="text-foreground">R$ {Number(valor).toFixed(2)}</span>:</span>
      <span className="text-emerald-600">Prof. → R$ {prof}</span>
      {casa != null && <span className="text-amber-600">Casa → R$ {casa}</span>}
    </div>
  );
}

export default function ConfiguracoesRepasse() {
  const { data: configs, isLoading } = useConfiguracoesRepasse();
  const mutation = useSalvarConfiguracoesRepasse();

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isDirty },
  } = useForm({
    resolver: yupResolver(schema),
  });

  // ─── CR3 FIX: bloquear navegação com alterações não salvas ────────────────
  // useBlocker requer data router; usamos beforeunload + navegação imperativa.
  const navigate = useNavigate();
  const isDirtyRef = useRef(isDirty);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);

  // Bloqueia reload/fechar aba
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Helper para navegar com confirmação (use em links/botões internos desta página)
  // eslint-disable-next-line no-unused-vars
  const navegarComConfirmacao = useCallback((destino) => {
    if (isDirtyRef.current) {
      const confirmar = window.confirm('Você tem alterações não salvas. Deseja sair sem salvar?');
      if (!confirmar) return;
    }
    navigate(destino);
  }, [navigate]);

  useEffect(() => {
    if (configs) reset(configs);
  }, [configs, reset]);

  const onSubmit = (data) => mutation.mutate(data);

  // Watch dos valores para o simulador em tempo real
  const watched = useWatch({ control });

  // ─── Field component (definido fora do render para evitar re-mount) ───────
  const Field = useCallback(({ label, name, suffix, icon: Icon, tooltip }) => (
    <div className="space-y-1.5">
      <label className="text-xs font-black text-muted-foreground uppercase flex items-center gap-1.5">
        {Icon && <Icon size={12} />}
        {label}
        {tooltip && <Tooltip text={tooltip} />}
      </label>
      <div className="relative">
        <Input
          type="number"
          step="0.01"
          error={!!errors[name]}
          {...register(name)}
          className={suffix ? 'pr-10' : ''}
        />
        {suffix && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-muted-foreground/60 select-none">
            {suffix}
          </span>
        )}
      </div>
      {errors[name] && (
        <p className="text-[10px] font-bold text-destructive animate-in fade-in slide-in-from-top-1">
          {errors[name].message}
        </p>
      )}
    </div>
  ), [errors, register]);

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center p-20">
        <RefreshCw className="animate-spin text-primary" size={40} />
      </div>
    );
  }

  // CR2: avisos de valor zero
  const avisoExperimental = Number(watched.aula_experimental_valor) === 0;
  const avisoAvulsa = Number(watched.aula_avulsa_valor) === 0;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-foreground tracking-tight">Configurações de Repasse</h1>
          <p className="text-muted-foreground">Defina as regras financeiras e valores padrão do espaço.</p>
        </div>

        <Button
          onClick={handleSubmit(onSubmit)}
          variant="brand"
          size="lg"
          disabled={!isDirty || mutation.isPending}
          className="shadow-lg shadow-primary/20 min-w-[200px]"
        >
          {mutation.isPending ? (
            <RefreshCw className="animate-spin" size={20} />
          ) : (
            <><Save size={20} /> Salvar Alterações</>
          )}
        </Button>
      </header>

      <form className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Mensalidade */}
        <Surface variant="card" padding="lg" className="space-y-6">
          <h2 className="font-black text-foreground flex items-center gap-2 border-b border-border pb-4">
            <Calculator className="text-primary" size={20} /> Valores de Mensalidade
          </h2>
          <div className="grid grid-cols-1 gap-6">
            <Field
              label="Valor 1 Modalidade"
              name="valor_1_modalidade"
              suffix="R$"
              icon={DollarSign}
              tooltip="Mensalidade padrão para alunos matriculados em uma única modalidade."
            />
            <Field
              label="Valor Multi-Modalidade (Livre)"
              name="valor_multi_modalidade"
              suffix="R$"
              icon={DollarSign}
              tooltip="Mensalidade para alunos no Plano Livre, que frequentam múltiplas modalidades sem restrição de turma."
            />
          </div>
        </Surface>

        {/* Plano Livre */}
        <Surface variant="card" padding="lg" className="space-y-6">
          <h2 className="font-black text-foreground flex items-center gap-2 border-b border-border pb-4">
            <Percent className="text-warning" size={20} /> Divisão Plano Livre
            <Tooltip text="No Plano Livre, a mensalidade é dividida proporcionalmente entre a casa e os professores com base nas aulas frequentadas. A soma deve ser 100%." />
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="% Casa" name="plano_livre_pct_casa" suffix="%" />
            <Field label="% Professores" name="plano_livre_pct_prof" suffix="%" />
          </div>
          {/* Simulador em tempo real */}
          <DivisaoSimulada
            valor={watched.valor_multi_modalidade}
            pctProf={watched.plano_livre_pct_prof}
            pctCasa={watched.plano_livre_pct_casa}
          />
          <p className="text-[10px] text-muted-foreground font-medium italic">
            * A soma das porcentagens do plano livre deve totalizar 100%.
          </p>
        </Surface>

        {/* Experimental & Avulsa */}
        <Surface variant="card" padding="lg" className="space-y-6 md:col-span-2">
          <h2 className="font-black text-foreground flex items-center gap-2 border-b border-border pb-4">
             Experimental &amp; Avulsa
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

            {/* Experimental */}
            <div className="space-y-4">
              <p className="text-xs font-black text-muted-foreground uppercase flex items-center gap-1.5">
                Aula Experimental
                <Tooltip text="Aula única para novos alunos conhecerem a turma. O valor aqui define quanto é cobrado e qual percentual fica com o professor." />
              </p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Valor" name="aula_experimental_valor" suffix="R$" icon={DollarSign} />
                <Field label="% Prof." name="aula_experimental_pct_prof" suffix="%" />
              </div>
              {/* CR2: aviso de valor zero */}
              {avisoExperimental && (
                <p className="text-[11px] text-warning font-semibold flex items-center gap-1.5">
                  <Info size={12} /> Valor R$ 0,00 — os repasses desta aula serão zerados.
                </p>
              )}
              {/* Simulador */}
              <DivisaoSimulada
                valor={watched.aula_experimental_valor}
                pctProf={watched.aula_experimental_pct_prof}
              />
            </div>

            {/* Avulsa */}
            <div className="space-y-4">
              <p className="text-xs font-black text-muted-foreground uppercase flex items-center gap-1.5">
                Aula Avulsa
                <Tooltip text="Aula paga de forma avulsa, sem vínculo com plano. O valor total é dividido entre casa e professor. A soma % Casa + % Prof. deve ser 100%." />
              </p>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Valor" name="aula_avulsa_valor" suffix="R$" />
                <Field label="% Casa" name="aula_avulsa_pct_casa" suffix="%" />
                <Field label="% Prof." name="aula_avulsa_pct_prof" suffix="%" />
              </div>
              {/* CR2: aviso de valor zero */}
              {avisoAvulsa && (
                <p className="text-[11px] text-warning font-semibold flex items-center gap-1.5">
                  <Info size={12} /> Valor R$ 0,00 — os repasses desta aula serão zerados.
                </p>
              )}
              {/* Simulador */}
              <DivisaoSimulada
                valor={watched.aula_avulsa_valor}
                pctProf={watched.aula_avulsa_pct_prof}
                pctCasa={watched.aula_avulsa_pct_casa}
              />
            </div>
          </div>
        </Surface>

        {/* Erros de validação de soma (nível do schema) */}
        {(errors[''] || errors['soma-livre'] || errors['soma-avulsa']) && (
          <Surface variant="subtle" className="md:col-span-2 border border-destructive/20 p-4 rounded-2xl">
            {errors[''] && (
              <p className="text-sm text-destructive font-black text-center">{errors[''].message}</p>
            )}
            {errors['soma-livre'] && (
              <p className="text-sm text-destructive font-black text-center">{errors['soma-livre'].message}</p>
            )}
            {errors['soma-avulsa'] && (
              <p className="text-sm text-destructive font-black text-center">{errors['soma-avulsa'].message}</p>
            )}
          </Surface>
        )}
      </form>
    </div>
  );
}