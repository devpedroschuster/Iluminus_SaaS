import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { Save, RefreshCw, Calculator, Percent, DollarSign } from 'lucide-react';

import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import Surface from '../components/ui/Surface';

import {
  useConfiguracoesRepasse,
  useSalvarConfiguracoesRepasse,
} from '../hooks/useConfiguracoesRepasse';

const schema = yup.object().shape({
  valor_1_modalidade: yup.number().min(0).required("Campo obrigatório"),
  valor_multi_modalidade: yup.number().min(0).required("Campo obrigatório"),
  plano_livre_pct_casa: yup.number().min(0).max(100).required("Campo obrigatório"),
  plano_livre_pct_prof: yup.number().min(0).max(100).required("Campo obrigatório"),
  aula_experimental_valor: yup.number().min(0).required("Campo obrigatório"),
  aula_experimental_pct_prof: yup.number().min(0).max(100).required("Campo obrigatório"),
  aula_avulsa_valor: yup.number().min(0).required("Campo obrigatório"),
  aula_avulsa_pct_casa: yup.number().min(0).max(100).required("Campo obrigatório"),
  aula_avulsa_pct_prof: yup.number().min(0).max(100).required("Campo obrigatório"),
}).test('soma-livre', 'A soma do Plano Livre deve ser 100%', function(values) {
  return (Number(values.plano_livre_pct_casa) + Number(values.plano_livre_pct_prof)) === 100;
});

export default function ConfiguracoesRepasse() {
  const { data: configs, isLoading } = useConfiguracoesRepasse();
  const mutation = useSalvarConfiguracoesRepasse();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm({
    resolver: yupResolver(schema),
  });

  useEffect(() => {
    if (configs) reset(configs);
  }, [configs, reset]);

  const onSubmit = (data) => mutation.mutate(data);

  const Field = ({ label, name, suffix, icon: Icon }) => (
    <div className="space-y-1.5">
      <label className="text-xs font-black text-muted-foreground uppercase flex items-center gap-1.5">
        {Icon && <Icon size={12} />} {label}
      </label>
      <div className="relative">
        <Input
          type="number"
          step="0.01"
          error={!!errors[name]}
          {...register(name)}
          className={suffix ? "pr-10" : ""}
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
  );

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center p-20">
        <RefreshCw className="animate-spin text-primary" size={40} />
      </div>
    );
  }

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
        
        <Surface variant="card" padding="lg" className="space-y-6">
          <h2 className="font-black text-foreground flex items-center gap-2 border-b border-border pb-4">
            <Calculator className="text-primary" size={20} /> Valores de Mensalidade
          </h2>
          <div className="grid grid-cols-1 gap-6">
            <Field label="Valor 1 Modalidade" name="valor_1_modalidade" suffix="R$" icon={DollarSign} />
            <Field label="Valor Multi-Modalidade (Livre)" name="valor_multi_modalidade" suffix="R$" icon={DollarSign} />
          </div>
        </Surface>

        <Surface variant="card" padding="lg" className="space-y-6">
          <h2 className="font-black text-foreground flex items-center gap-2 border-b border-border pb-4">
            <Percent className="text-warning" size={20} /> Divisão Plano Livre
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="% Casa" name="plano_livre_pct_casa" suffix="%" />
            <Field label="% Professores" name="plano_livre_pct_prof" suffix="%" />
          </div>
          <p className="text-[10px] text-muted-foreground font-medium italic">
            * A soma das porcentagens do plano livre deve totalizar 100%.
          </p>
        </Surface>

        <Surface variant="card" padding="lg" className="space-y-6">
          <h2 className="font-black text-foreground flex items-center gap-2 border-b border-border pb-4">
             Experimental & Avulsa
          </h2>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Valor Experimental" name="aula_experimental_valor" suffix="R$" />
              <Field label="% Prof. Experimental" name="aula_experimental_pct_prof" suffix="%" />
            </div>
            <div className="border-t border-border/50 pt-6 grid grid-cols-3 gap-3">
              <Field label="Valor Avulsa" name="aula_avulsa_valor" suffix="R$" />
              <Field label="% Casa" name="aula_avulsa_pct_casa" suffix="%" />
              <Field label="% Prof." name="aula_avulsa_pct_prof" suffix="%" />
            </div>
          </div>
        </Surface>

        {errors[''] && (
          <Surface variant="subtle" className="md:col-span-2 border border-destructive/20 p-4 rounded-2xl">
             <p className="text-sm text-destructive font-black text-center">{errors[''].message}</p>
          </Surface>
        )}
      </form>
    </div>
  );
}