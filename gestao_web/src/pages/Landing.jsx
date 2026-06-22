import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import './landing.css';

export default function Landing() {
  const navigate = useNavigate();

  // ── Lead form state ─────────────────────────────────────────────────
  const [leadNome, setLeadNome] = useState('');
  const [leadTel, setLeadTel] = useState('');
  const [leadLoading, setLeadLoading] = useState(false);
  const [leadStatus, setLeadStatus] = useState(null); // 'ok' | 'err' | null
  const [leadErro, setLeadErro] = useState('');

  // ── Plans from Supabase ──────────────────────────────────────────────
  const [planos, setPlanos] = useState([]);
  const [planosLoading, setPlanosLoading] = useState(true);

  useEffect(() => {
    async function carregarPlanos() {
      try {
        const { data, error } = await supabase
          .from('planos')
          .select('id, nome, preco, duracao_meses, frequencia_semanal, regras_acesso')
          .order('preco', { ascending: true });
        if (!error && data) setPlanos(data);
      } catch (_) {
        // Silently fail — planos section will be hidden
      } finally {
        setPlanosLoading(false);
      }
    }
    carregarPlanos();
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────
  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  function formatTelefone(val) {
    // Format as (99) 99999-9999
    const digits = val.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  async function handleLeadSubmit(e) {
    e.preventDefault();
    if (!leadNome.trim() || !leadTel.trim()) return;
    setLeadLoading(true);
    setLeadStatus(null);
    setLeadErro('');
    try {
      // Insere o lead da landing diretamente na tabela `leads`
      // (correção: antes apontava para 'presencas_agenda', tabela que não
      // existe — esse formulário estava falhando silenciosamente).
      const { error } = await supabase
        .from('leads')
        .insert([{
          nome: leadNome.trim(),
          telefone: leadTel.replace(/\D/g, ''),
          status_conversao: 'pendente',
          // data_checkin e created_at default para now() server-side
        }]);

      if (error) throw error;
      setLeadStatus('ok');
      setLeadNome('');
      setLeadTel('');
    } catch (err) {
      console.error(err);
      setLeadStatus('err');
      setLeadErro('Não conseguimos registrar agora. Tente novamente ou fale pelo WhatsApp.');
    } finally {
      setLeadLoading(false);
    }
  }

  // ── Plan helpers ─────────────────────────────────────────────────────
  const isFeatured = (plano, todos) => {
    if (todos.length === 0) return false;
    const mid = Math.floor(todos.length / 2);
    return todos.indexOf(plano) === mid;
  };

  const WHATSAPP_NUM = '5551994424348';
  const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUM}?text=Olá!%20Vi%20o%20site%20do%20Iluminus%20e%20quero%20saber%20mais.`;
  const INSTAGRAM_URL = 'https://instagram.com/espacoiluminus';
  const MAPS_URL = 'https://maps.google.com/?q=Espaço+Iluminus';

  return (
    <div id="page-landing">

      {/* ── Navbar ─────────────────────────────────────────────────── */}
      <nav className="navbar">
        <a className="nav-logo" href="/">
          <div className="logo-mark">I</div>
          <span className="logo-name">ILUMINUS</span>
        </a>
        <div className="nav-links">
          <button className="nav-link" onClick={() => scrollTo('sec-aulas')}>Modalidades</button>
          <button className="nav-link" onClick={() => scrollTo('sec-planos')}>Planos</button>
          <button className="nav-link" onClick={() => scrollTo('sec-footer')}>Contato</button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => navigate('/login')}
          >
            Já sou aluno →
          </button>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <section className="hero">
        <div className="hero-deco">
          <div className="hero-blob"></div>
          <div className="hero-circle" style={{ width: '600px', height: '600px', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}></div>
          <div className="hero-circle" style={{ width: '400px', height: '400px', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}></div>
          <div className="hero-circle" style={{ width: '220px', height: '220px', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'rgba(217,142,115,.05)' }}></div>
        </div>

        <div className="hero-content" style={{ maxWidth: '680px', position: 'relative', zIndex: 1 }}>
          <div className="hero-tag anim-fade-up">
            <span className="hero-dot"></span>
            Funcional · Dança · Bem-estar
          </div>

          <h1 className="anim-fade-up s1">
            Mova-se,<br />expresse-se,<br /><em>ilumine-se.</em>
          </h1>

          <p className="hero-sub anim-fade-up s2">
            Treinamento funcional e dança para quem quer resultado e não abre mão de se sentir bem.
            Primeira aula grátis — sem compromisso.
          </p>

          {/* ── Inline Lead Form ──────────────────────────────────── */}
          <div className="hero-form-wrap anim-fade-up s3">
            {leadStatus === 'ok' ? (
              <div className="lead-success anim-scale-in">
                <span className="lead-success-icon">✓</span>
                <div>
                  <strong>Perfeito! Aguarde nosso contato.</strong>
                  <span>Nossa equipe vai chamar você em breve pelo WhatsApp.</span>
                </div>
              </div>
            ) : (
              <form className="hero-form" onSubmit={handleLeadSubmit}>
                <div className="hero-form-fields">
                  <div className="inp-group" style={{ marginBottom: 0 }}>
                    <input
                      className={`inp${leadStatus === 'err' ? ' error' : ''}`}
                      type="text"
                      placeholder="Seu nome"
                      value={leadNome}
                      onChange={e => setLeadNome(e.target.value)}
                      required
                      autoComplete="given-name"
                    />
                  </div>
                  <div className="inp-group" style={{ marginBottom: 0 }}>
                    <input
                      className={`inp${leadStatus === 'err' ? ' error' : ''}`}
                      type="tel"
                      placeholder="WhatsApp (com DDD)"
                      value={leadTel}
                      onChange={e => setLeadTel(formatTelefone(e.target.value))}
                      required
                      autoComplete="tel"
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn btn-primary hero-form-submit"
                    disabled={leadLoading}
                  >
                    {leadLoading
                      ? <><span className="spinner"></span> Enviando…</>
                      : 'Quero uma aula experimental'}
                  </button>
                </div>
                {leadStatus === 'err' && (
                  <p className="inp-err" style={{ marginTop: '10px' }}>{leadErro}</p>
                )}
                <p className="hero-form-hint">
                  Gratuito, sem cartão, sem compromisso. Ou{' '}
                  <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="hero-form-link">
                    fale direto no WhatsApp →
                  </a>
                </p>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* ── Modalidades ────────────────────────────────────────────── */}
      <section id="sec-aulas" className="section section-alt">
        <div className="section-header">
          <div className="section-tag">O que oferecemos</div>
          <h2 className="section-title">Nossas Modalidades</h2>
          <p className="section-sub">
            Duas práticas poderosas sob o mesmo teto, com instrutores apaixonados
            e metodologias que realmente funcionam.
          </p>
        </div>
        <div className="modality-grid">
          {/* Card Funcional */}
          <div className="modality-card funcional anim-fade-up">
            <div className="modality-icon" style={{ background: 'rgba(217,142,115,.15)', fontSize: '26px' }}>⚡</div>
            <h3 className="modality-title" style={{ color: 'var(--pri)' }}>Funcional</h3>
            <p className="modality-desc">
              Treinamento de alta performance que desenvolve força, equilíbrio e
              condicionamento completo — para todos os níveis.
            </p>
            <div className="schedule-label" style={{ color: 'var(--pri)' }}>Grade de horários</div>
            <div className="schedule-item">Seg / Qua / Sex — 07:00 e 09:00</div>
            <div className="schedule-item">Seg a Sex — 18:30</div>
            <div className="schedule-item">Sábados — 09:00</div>
            <div style={{ marginTop: '28px' }}>
              <button className="btn btn-outline btn-sm" onClick={() => scrollTo('hero-form-anchor')}>
                Quero experimentar
              </button>
            </div>
          </div>

          {/* Card Dança */}
          <div className="modality-card danca anim-fade-up s1">
            <div className="modality-icon" style={{ background: 'rgba(138,154,91,.15)', fontSize: '26px' }}>✦</div>
            <h3 className="modality-title" style={{ color: 'var(--sec-d)' }}>Dança</h3>
            <p className="modality-desc">
              Do samba ao contemporâneo, celebramos o movimento e a expressão
              artística em aulas que energizam corpo e mente.
            </p>
            <div className="schedule-label" style={{ color: 'var(--sec-d)' }}>Grade de horários</div>
            <div className="schedule-item">Terças e Quintas — 19:00 e 20:00</div>
            <div className="schedule-item">Quartas — 20:00</div>
            <div className="schedule-item">Sábados — 10:00</div>
            <div style={{ marginTop: '28px' }}>
              <button
                className="btn btn-sm"
                style={{ background: 'var(--sec)', color: '#fff' }}
                onClick={() => scrollTo('hero-form-anchor')}
              >
                Quero experimentar
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Planos (Supabase) ──────────────────────────────────────── */}
      {(planosLoading || planos.length > 0) && (
        <section id="sec-planos" className="section">
          <div className="section-header">
            <div className="section-tag">Invista em você</div>
            <h2 className="section-title">Nossos Planos</h2>
            <p className="section-sub">
              Escolha o plano que encaixa na sua rotina. Sem taxa de adesão.
            </p>
          </div>

          {planosLoading ? (
            <div className="plans-loading">
              <div className="plans-skeleton"></div>
              <div className="plans-skeleton"></div>
              <div className="plans-skeleton"></div>
            </div>
          ) : (
            <div
              className="plans-grid"
              style={planos.length === 1 ? { gridTemplateColumns: '1fr', maxWidth: '360px' } :
                     planos.length === 2 ? { gridTemplateColumns: 'repeat(2,1fr)', maxWidth: '660px' } : {}}
            >
              {planos.map((plano, idx) => {
                const featured = isFeatured(plano, planos);
                const regras = Array.isArray(plano.regras_acesso) ? plano.regras_acesso : [];
                return (
                  <div key={plano.id} className={`plan-card${featured ? ' featured' : ''}`}>
                    {featured && <div className="plan-popular">Mais escolhido</div>}
                    <div className="plan-name">{plano.nome}</div>
                    <div className="plan-price">
                      <span style={{ fontSize: '18px', color: 'var(--muted)', alignSelf: 'flex-start', paddingTop: '8px' }}>R$</span>
                      <span className="plan-price-num">
                        {Number(plano.preco).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                      <span className="plan-price-per">/mês</span>
                    </div>
                    <div className="plan-features">
                      {plano.duracao_meses && (
                        <div className="plan-feat">
                          <span className="feat-check">✓</span>
                          <span>{plano.duracao_meses} {plano.duracao_meses === 1 ? 'mês' : 'meses'} de acesso</span>
                        </div>
                      )}
                      {plano.frequencia_semanal && (
                        <div className="plan-feat">
                          <span className="feat-check">✓</span>
                          <span>{plano.frequencia_semanal}× por semana</span>
                        </div>
                      )}
                      {regras.map((r, i) => (
                        <div key={i} className="plan-feat">
                          <span className="feat-check">✓</span>
                          <span>{r}</span>
                        </div>
                      ))}
                    </div>
                    <button
                      className={`btn btn-full${featured ? ' btn-primary' : ' btn-outline'}`}
                      onClick={() => scrollTo('hero-form-anchor')}
                    >
                      Começar agora
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ── Anchor for "Quero experimentar" scrolls ────────────────── */}
      <div id="hero-form-anchor" style={{ height: 0 }}></div>

      {/* ── Second CTA strip ───────────────────────────────────────── */}
      <section className="cta-strip">
        <div className="cta-strip-inner">
          <div>
            <div className="cta-strip-title">Primeira aula é por nossa conta.</div>
            <div className="cta-strip-sub">Venha conhecer o espaço sem compromisso algum.</div>
          </div>
          <div className="cta-strip-btns">
            <button
              className="btn btn-primary"
              onClick={() => scrollTo('hero-form-anchor')}
              style={{ padding: '14px 36px', fontSize: '15px' }}
            >
              Agendar aula grátis
            </button>
            <a
              href={WHATSAPP_URL}
              target="_blank"
              rel="noreferrer"
              className="btn btn-wa"
              style={{ padding: '14px 28px', fontSize: '15px' }}
            >
              💬 WhatsApp
            </a>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer id="sec-footer">
        <div className="footer-grid">
          {/* Brand col */}
          <div>
            <div className="nav-logo" style={{ marginBottom: '18px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div className="logo-mark">I</div>
              <span className="logo-name">ILUMINUS</span>
            </div>
            <p style={{ fontSize: '14px', color: 'var(--muted)', lineHeight: '1.75', maxWidth: '260px' }}>
              Espaço de treinamento funcional e dança criado para quem quer resultado real e se sentir bem no processo.
            </p>
          </div>

          {/* Contato col */}
          <div>
            <div className="footer-col-title">Contato</div>
            <a href={WHATSAPP_URL} target="_blank" rel="noreferrer" className="footer-link">
              📱 WhatsApp
            </a>
            <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer" className="footer-link">
              📷 Instagram
            </a>
            <a href={MAPS_URL} target="_blank" rel="noreferrer" className="footer-link">
              📍 Como chegar
            </a>
          </div>

          {/* Endereço col */}
          <div>
            <div className="footer-col-title">Endereço</div>
            <p style={{ fontSize: '14px', color: 'var(--muted)', lineHeight: '1.9' }}>
              Rua La Plata, 576<br />
              Jardim Botânico — Porto Alegre/RS<br />
              CEP 90670-040
            </p>
            <a
              href={MAPS_URL}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost btn-sm"
              style={{ marginTop: '14px', display: 'inline-flex' }}
            >
              Abrir no Maps →
            </a>
          </div>

          {/* Links col */}
          <div>
            <div className="footer-col-title">Navegação</div>
            <button className="footer-link" onClick={() => scrollTo('sec-aulas')}>Modalidades</button>
            <button className="footer-link" onClick={() => scrollTo('sec-planos')}>Planos</button>
            <button className="footer-link" onClick={() => navigate('/login')}>Área do Aluno</button>
          </div>
        </div>

        {/* Google Maps embed placeholder */}
        <div className="footer-map">
          <iframe
            title="Localização Iluminus"
            src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3453.5126442791016!2d-51.19411002444605!3d-30.05083667492024!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x951979000f710575%3A0x51c193485284f702!2sEspa%C3%A7o%20Iluminus!5e0!3m2!1spt-BR!2sbr!4v1779569994095!5m2!1spt-BR!2sbr"
            width="100%"
            height="200"
            style={{ border: 0, borderRadius: '12px', filter: 'grayscale(20%)' }}
            allowFullScreen=""
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          ></iframe>
        </div>

        <div className="footer-bottom">
          <span className="footer-copy">© 2026 Espaço Iluminus · Todos os direitos reservados.</span>
          <span className="footer-copy">
            <a href={INSTAGRAM_URL} target="_blank" rel="noreferrer" style={{ color: 'var(--pri)', fontWeight: 700, textDecoration: 'none' }}>
              @espacoiluminus
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}