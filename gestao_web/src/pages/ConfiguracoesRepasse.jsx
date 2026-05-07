import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { Save } from 'lucide-react';
import {
  useConfiguracoesRepasse,
  useSalvarConfiguracoesRepasse,
} from '../hooks/useConfiguracoesRepasse';
//* import { Loading } from '../components/shared/Loading';

const schema = yup.object().shape({
  valor_1_modalidade: yup.number().min(0).required(),
  valor_multi_modalidade: yup.number().min(0).required(),
  plano_livre_pct_casa: yup.number().min(0).max(100).required(),
  plano_livre_pct_prof: yup.number().min(0).max(100).required(),
  aula_experimental_valor: yup.number().min(0).required(),
  aula_experimental_pct_prof: yup.number().min(0).max(100).required(),
  aula_avulsa_valor: yup.number().min(0).required(),
  aula_avulsa_pct_casa: yup.number().min(0).max(100).required(),
  aula_avulsa_pct_prof: yup.number().min(0).max(100).required(),
}).test('soma-livre', 'Plano Livre: % Casa + % Professor deve = 100', (v) =>
  Math.round((v.plano_livre_pct_casa + v.plano_livre_pct_prof) * 100) === 10000
).test('soma-avulsa', 'Avulsa: % Casa + % Professor deve = 100', (v) =>
  Math.round((v.aula_avulsa_pct_casa + v.aula_avulsa_pct_prof) * 100) === 10000
);

export default function ConfiguracoesRepasse() {
  const { data, isLoading } = useConfiguracoesRepasse();
  const salvar = useSalvarConfiguracoesRepasse();
  const { register, handleSubmit, reset, formState: { errors } } = useForm({
    resolver: yupResolver(schema),
  });

  useEffect(() => { if (data) reset(data); }, [data, reset]);

  if (isLoading) return <div className="p-6 text-gray-500 font-medium animate-pulse">Carregando configurações...</div>;

  const onSubmit = (values) => salvar.mutate({ id: data.id, ...values });

  const Field = ({ label, name, suffix }) => (
    <label className="block">
      <span className="text-sm text-gray-700">{label}</span>
      <div className="relative">
        <input
          type="number" step="0.01"
          {...register(name, { valueAsNumber: true })}
          className="mt-1 w-full border rounded px-3 py-2 pr-10"
        />
        {suffix && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">{suffix}</span>}
      </div>
      {errors[name] && <span className="text-xs text-red-600">{errors[name].message}</span>}
    </label>
  );

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-6">Configurações de Repasse</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
        <section className="bg-white rounded-lg p-5 shadow-sm">
          <h2 className="font-medium mb-4">Aulas Regulares</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Repasse com 1 modalidade" name="valor_1_modalidade" suffix="R$" />
            <Field label="Repasse por modalidade (2+)" name="valor_multi_modalidade" suffix="R$" />
          </div>
        </section>

        <section className="bg-white rounded-lg p-5 shadow-sm">
          <h2 className="font-medium mb-4">Plano Livre</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="% Casa" name="plano_livre_pct_casa" suffix="%" />
            <Field label="% Professores" name="plano_livre_pct_prof" suffix="%" />
          </div>
        </section>

        <section className="bg-white rounded-lg p-5 shadow-sm">
          <h2 className="font-medium mb-4">Aula Experimental</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Valor da aula" name="aula_experimental_valor" suffix="R$" />
            <Field label="% para o professor" name="aula_experimental_pct_prof" suffix="%" />
          </div>
        </section>

        <section className="bg-white rounded-lg p-5 shadow-sm">
          <h2 className="font-medium mb-4">Aula Avulsa</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Valor da aula" name="aula_avulsa_valor" suffix="R$" />
            <Field label="% Casa" name="aula_avulsa_pct_casa" suffix="%" />
            <Field label="% Professor" name="aula_avulsa_pct_prof" suffix="%" />
          </div>
        </section>

        {errors[''] && <p className="text-sm text-red-600">{errors[''].message}</p>}

        <button
          type="submit"
          disabled={salvar.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 rounded bg-[#D98E73] text-white hover:opacity-90"
        >
          <Save size={16} /> Salvar
        </button>
      </form>
    </div>
  );
}
