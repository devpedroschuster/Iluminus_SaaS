import React from 'react';
import { useNavigate } from 'react-router-dom';
import './landing.css'; 

export default function Landing() {
  const navigate = useNavigate();

  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div id="page-landing">
      {/* Navbar */}
      <nav className="navbar">
        <a className="nav-logo">
          <div className="logo-mark">I</div>
          <span className="logo-name">ILUMINUS</span>
        </a>
        <div className="nav-links">
          <button className="nav-link" onClick={() => scrollTo('sec-aulas')}>Modalidades</button>
          <button className="nav-link" onClick={() => scrollTo('sec-planos')}>Planos</button>
          <button className="nav-link" onClick={() => scrollTo('sec-footer')}>Contato</button>
          <button 
            className="btn btn-primary" 
            onClick={() => navigate('/login')} 
            style={{ padding: '10px 24px', fontSize: '13px' }}
          >
            Área do Aluno
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="hero">
        <div className="hero-deco">
          <div className="hero-blob"></div>
          <div className="hero-circle" style={{ width: '600px', height: '600px', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}></div>
          <div className="hero-circle" style={{ width: '400px', height: '400px', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}></div>
          <div className="hero-circle" style={{ width: '220px', height: '220px', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: 'rgba(217,142,115,.05)' }}></div>
        </div>
        <div style={{ maxWidth: '680px', position: 'relative', zIndex: 1 }}>
          <div className="hero-tag anim-fade-up">
            <span className="hero-dot"></span>
            Funcional · Dança · Bem-estar
          </div>
          <h1 className="anim-fade-up s1">
            Mova-se,<br />expresse-se,<br /><em>ilumine-se.</em>
          </h1>
          <p className="hero-sub anim-fade-up s2">
            No Iluminus cada aula é uma experiência completa. Treinamento funcional e dança em um único espaço pensado para o seu corpo e sua alma.
          </p>
          <div className="hero-btns anim-fade-up s3">
            <button className="btn btn-primary" onClick={() => navigate('/login')} style={{ padding: '15px 40px', fontSize: '15px' }}>Acessar Minha Conta</button>
            <button className="btn btn-ghost" onClick={() => scrollTo('sec-aulas')} style={{ padding: '14px 32px', fontSize: '15px' }}>Conhecer as Aulas →</button>
          </div>
          <div className="hero-stats anim-fade-up s4">
            <div><div className="stat-num">500+</div><div className="stat-lbl">Alunos ativos</div></div>
            <div><div className="stat-num">8</div><div className="stat-lbl">Instrutores</div></div>
            <div><div className="stat-num">98%</div><div className="stat-lbl">Satisfação</div></div>
          </div>
        </div>
      </section>

      {/* Modalidades */}
      <section id="sec-aulas" className="section section-alt">
        <div className="section-header">
          <div className="section-tag">O que oferecemos</div>
          <h2 className="section-title">Nossas Modalidades</h2>
          <p className="section-sub">Duas práticas poderosas sob o mesmo teto, com instrutores apaixonados e metodologias que realmente funcionam.</p>
        </div>
        <div className="modality-grid">
          {/* Card Funcional */}
          <div className="modality-card funcional anim-fade-up">
            <div className="modality-icon" style={{ background: 'rgba(217,142,115,.15)', fontSize: '26px' }}>⚡</div>
            <h3 className="modality-title" style={{ color: 'var(--pri)' }}>Funcional</h3>
            <p className="modality-desc">Treinamento de alta performance que desenvolve força, equilíbrio e condicionamento completo...</p>
            <div className="schedule-label" style={{ color: 'var(--pri)' }}>Grade de horários</div>
            <div className="schedule-item">Seg / Qua / Sex — 07:00 e 09:00</div>
            <div className="schedule-item">Seg a Sex — 18:30</div>
            <div className="schedule-item">Sábados — 09:00</div>
            <div style={{ marginTop: '28px' }}>
              <button className="btn btn-outline btn-sm" onClick={() => navigate('/login')}>Reservar vaga</button>
            </div>
          </div>
          {/* Card Dança */}
          <div className="modality-card danca anim-fade-up s1">
            <div className="modality-icon" style={{ background: 'rgba(138,154,91,.15)', fontSize: '26px' }}>✦</div>
            <h3 className="modality-title" style={{ color: 'var(--sec-d)' }}>Dança</h3>
            <p className="modality-desc">Do samba ao contemporâneo, celebramos o movimento e a expressão artística...</p>
            <div className="schedule-label" style={{ color: 'var(--sec-d)' }}>Grade de horários</div>
            <div className="schedule-item">Terças e Quintas — 19:00 e 20:00</div>
            <div className="schedule-item">Quartas — 20:00</div>
            <div className="schedule-item">Sábados — 10:00</div>
            <div style={{ marginTop: '28px' }}>
              <button className="btn btn-sm" style={{ background: 'var(--sec)', color: '#fff' }} onClick={() => navigate('/login')}>Reservar vaga</button>
            </div>
          </div>
        </div>
      </section>

      <footer id="sec-footer">
        <div className="footer-bottom">
          <span className="footer-copy">© 2026 Iluminus · Todos os direitos reservados.</span>
        </div>
      </footer>
    </div>
  );
}