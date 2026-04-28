require("dotenv").config();
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const OUT = path.resolve(__dirname, "../outputs/appetix_launch/images");
fs.mkdirSync(OUT, { recursive: true });

const GREEN   = "#1A4731";
const GOLD    = "#B8962E";
const OFFWHITE= "#F8F6F1";
const BLACK   = "#0A0A0A";
const DARKRED = "#8B0000";

const FONTS = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700;1,900&family=Montserrat:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;}</style>`;

const grain = (op = 0.06) => `
<div style="position:absolute;inset:0;pointer-events:none;z-index:99;">
  <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
    <filter id="gr"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="4" seed="3"/>
    <feColorMatrix type="saturate" values="0"/></filter>
    <rect width="100%" height="100%" filter="url(#gr)" opacity="${op}"/>
  </svg>
</div>`;

const wm = `<div style="position:absolute;bottom:28px;right:32px;font-family:'Montserrat',sans-serif;font-size:13px;font-weight:500;color:rgba(255,255,255,0.25);letter-spacing:1px;z-index:100;">APPETIX 🌿</div>`;
const wmDark = `<div style="position:absolute;bottom:28px;right:32px;font-family:'Montserrat',sans-serif;font-size:13px;font-weight:500;color:rgba(26,71,49,0.28);letter-spacing:1px;z-index:100;">APPETIX 🌿</div>`;

const botanicSVG = `<svg width="300" height="56" viewBox="0 0 300 56" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M150 28 C110 10 65 14 18 6" stroke="${GOLD}" stroke-width="1.5" fill="none" opacity="0.65"/>
  <path d="M150 28 C190 10 235 14 282 6" stroke="${GOLD}" stroke-width="1.5" fill="none" opacity="0.65"/>
  <path d="M95 28 C82 16 66 11 50 20" stroke="${GOLD}" stroke-width="1" fill="none" opacity="0.5"/>
  <path d="M205 28 C218 16 234 11 250 20" stroke="${GOLD}" stroke-width="1" fill="none" opacity="0.5"/>
  <ellipse cx="150" cy="28" rx="7" ry="12" fill="${GOLD}" opacity="0.55" transform="rotate(-10 150 28)"/>
  <ellipse cx="122" cy="20" rx="5" ry="9" fill="${GOLD}" opacity="0.38" transform="rotate(-28 122 20)"/>
  <ellipse cx="178" cy="20" rx="5" ry="9" fill="${GOLD}" opacity="0.38" transform="rotate(28 178 20)"/>
  <circle cx="150" cy="28" r="3.5" fill="${GOLD}" opacity="0.85"/>
</svg>`;

const images = [

  // ════════════════════════════════════════
  // POST 1 — Feed "Chegou." — Quinta 19h
  // ════════════════════════════════════════
  {
    file: "01_post1_feed_chegou_quinta_19h.png",
    w: 1080, h: 1080,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1080px;background:${GREEN};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;gap:36px;">
      ${grain(0.065)} ${wm}
      <h1 style="font-family:'Playfair Display',serif;font-size:148px;font-weight:900;color:#fff;letter-spacing:-4px;line-height:0.95;position:relative;">Chegou.</h1>
      <p style="font-family:'Montserrat',sans-serif;font-size:28px;font-weight:400;color:rgba(255,255,255,0.78);text-align:center;letter-spacing:0.5px;line-height:1.75;position:relative;">Depois de meses. Depois de testes.<br>Depois de espera.</p>
      <p style="font-family:'Montserrat',sans-serif;font-size:22px;font-weight:500;color:${GOLD};letter-spacing:1.5px;position:absolute;bottom:58px;">🌿 Appetix — em breve.</p>
    </div></body></html>`
  },

  // ════════════════════════════════════════
  // STORY 1 Dia 1 — "Depois de muito tempo..."
  // ════════════════════════════════════════
  {
    file: "02_story1_dia1_quinta_20h.png",
    w: 1080, h: 1920,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1920px;background:${GREEN};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;gap:32px;">
      ${grain(0.06)}
      <p style="font-family:'Montserrat',sans-serif;font-size:56px;font-weight:700;color:#fff;text-align:center;padding:0 90px;line-height:1.4;position:relative;">Depois de muito tempo...</p>
      <p style="font-family:'Montserrat',sans-serif;font-size:38px;color:rgba(255,255,255,0.4);letter-spacing:8px;position:relative;">• • •</p>
    </div></body></html>`
  },

  // ════════════════════════════════════════
  // STORY 2 Dia 1 — "...o Appetix está ficando pronto."
  // ════════════════════════════════════════
  {
    file: "03_story2_dia1_quinta_20h.png",
    w: 1080, h: 1920,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1920px;background:${GREEN};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;gap:36px;">
      ${grain(0.06)}
      <p style="font-family:'Montserrat',sans-serif;font-size:52px;font-weight:700;color:#fff;text-align:center;padding:0 80px;line-height:1.45;position:relative;">...o Appetix finalmente<br>está ficando pronto.</p>
      <div style="width:300px;height:3px;background:${GOLD};position:relative;"></div>
    </div></body></html>`
  },

  // ════════════════════════════════════════
  // STORY 3 Dia 1 — Enquete (estática)
  // ════════════════════════════════════════
  {
    file: "04_story3_dia1_enquete_quinta_20h.png",
    w: 1080, h: 1920,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1920px;background:${GREEN};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;gap:44px;">
      ${grain(0.06)}
      <p style="font-family:'Montserrat',sans-serif;font-size:44px;font-weight:700;color:#fff;text-align:center;padding:0 80px;line-height:1.45;position:relative;">Você ainda está<br>esperando o Appetix?</p>
      <div style="display:flex;flex-direction:column;gap:20px;width:780px;position:relative;">
        <div style="background:rgba(255,255,255,0.13);border:2px solid rgba(255,255,255,0.38);border-radius:18px;padding:30px 44px;text-align:center;">
          <p style="font-family:'Montserrat',sans-serif;font-size:32px;font-weight:600;color:#fff;">Tô aqui desde o início ✅</p>
        </div>
        <div style="background:rgba(255,255,255,0.13);border:2px solid rgba(255,255,255,0.38);border-radius:18px;padding:30px 44px;text-align:center;">
          <p style="font-family:'Montserrat',sans-serif;font-size:32px;font-weight:600;color:#fff;">Me conta mais 🔥</p>
        </div>
      </div>
      <p style="font-family:'Montserrat',sans-serif;font-size:19px;color:rgba(255,255,255,0.35);position:absolute;bottom:38px;letter-spacing:1px;">Adicionar enquete nativa no Instagram</p>
    </div></body></html>`
  },

  // ════════════════════════════════════════
  // SLIDE 1 Carrossel — Capa — Sexta 19h
  // ════════════════════════════════════════
  {
    file: "05_post2_slide1_capa_sexta_19h.png",
    w: 1080, h: 1350,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1350px;background:${BLACK};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;gap:38px;padding:80px;">
      ${grain(0.06)} ${wm}
      <h2 style="font-family:'Playfair Display',serif;font-size:86px;font-weight:900;color:#fff;text-align:center;line-height:1.1;letter-spacing:-2px;position:relative;">Por que você sente fome mesmo depois de jantar?</h2>
      <p style="font-family:'Montserrat',sans-serif;font-size:30px;font-weight:400;color:rgba(255,255,255,0.55);text-align:center;letter-spacing:2px;position:relative;">A resposta muda tudo.</p>
    </div></body></html>`
  },

  // ════════════════════════════════════════
  // SLIDE 2 — Grelina
  // ════════════════════════════════════════
  {
    file: "06_post2_slide2_grelina_sexta_19h.png",
    w: 1080, h: 1350,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1350px;background:${OFFWHITE};display:flex;flex-direction:column;justify-content:center;position:relative;padding:88px;gap:30px;">
      ${wmDark}
      <div style="width:100%;height:2px;background:${GOLD};"></div>
      <h2 style="font-family:'Playfair Display',serif;font-size:66px;font-weight:900;color:#111;line-height:1.15;letter-spacing:-1px;">Às 22h seu corpo<br>produz mais grelina.</h2>
      <div style="width:64px;height:4px;background:${GOLD};border-radius:2px;"></div>
      <p style="font-family:'Montserrat',sans-serif;font-size:30px;font-weight:600;color:#1a1a1a;line-height:1.4;">Grelina é o hormônio da fome.</p>
      <p style="font-family:'Montserrat',sans-serif;font-size:25px;font-weight:400;color:#555;line-height:1.8;">Ele não sabe que você jantou.<br>Não sabe que você está de dieta.<br>Ele só sabe acordar e gritar:</p>
      <p style="font-family:'Playfair Display',serif;font-size:72px;font-weight:900;color:#111;letter-spacing:-2px;line-height:1;">COME.</p>
      <div style="width:100%;height:1px;background:rgba(0,0,0,0.1);"></div>
    </div></body></html>`
  },

  // ════════════════════════════════════════
  // SLIDE 3 — Não é fraqueza
  // ════════════════════════════════════════
  {
    file: "07_post2_slide3_biologia_sexta_19h.png",
    w: 1080, h: 1350,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1350px;background:${GREEN};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;gap:20px;padding:80px;">
      ${grain(0.06)} ${wm}
      <div style="width:14px;height:14px;background:${GOLD};border-radius:50%;position:absolute;top:80px;left:80px;"></div>
      <div style="width:8px;height:8px;background:${GOLD};border-radius:50%;position:absolute;top:106px;left:106px;opacity:0.5;"></div>
      <h2 style="font-family:'Playfair Display',serif;font-size:118px;font-weight:900;font-style:italic;color:#fff;text-align:center;line-height:1.0;letter-spacing:-3px;position:relative;">Não é<br>fraqueza.</h2>
      <h2 style="font-family:'Playfair Display',serif;font-size:118px;font-weight:900;font-style:italic;color:${GOLD};text-align:center;line-height:1.0;letter-spacing:-3px;position:relative;">É biologia.</h2>
      <p style="font-family:'Montserrat',sans-serif;font-size:28px;font-weight:400;color:rgba(255,255,255,0.72);text-align:center;margin-top:24px;line-height:1.65;position:relative;">E é exatamente aí que o Appetix age.</p>
    </div></body></html>`
  },

  // ════════════════════════════════════════
  // SLIDE 4 — Controle real do sinal
  // ════════════════════════════════════════
  {
    file: "08_post2_slide4_controle_sexta_19h.png",
    w: 1080, h: 1350,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1350px;background:${OFFWHITE};display:flex;flex-direction:column;justify-content:center;position:relative;padding:88px;gap:28px;">
      ${wmDark}
      <div style="border-left:5px solid ${GOLD};padding-left:32px;">
        <p style="font-family:'Montserrat',sans-serif;font-size:26px;font-weight:400;color:#444;line-height:1.7;">A fórmula foi otimizada para agir<br>nesse mecanismo específico.</p>
      </div>
      <div style="height:1px;background:rgba(0,0,0,0.08);margin:12px 0;"></div>
      <h2 style="font-family:'Playfair Display',serif;font-size:88px;font-weight:900;color:#111;line-height:1.05;letter-spacing:-2px;">Não só<br>saciedade.</h2>
      <h2 style="font-family:'Playfair Display',serif;font-size:72px;font-weight:900;color:${GREEN};line-height:1.05;letter-spacing:-2px;">Controle real<br>do sinal.</h2>
      <div style="width:88px;height:4px;background:${GOLD};border-radius:2px;margin-top:8px;"></div>
    </div></body></html>`
  },

  // ════════════════════════════════════════
  // SLIDE 5 — CTA Lançamento
  // ════════════════════════════════════════
  {
    file: "09_post2_slide5_cta_sexta_19h.png",
    w: 1080, h: 1350,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1350px;background:${GREEN};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;gap:32px;padding:80px;">
      ${grain(0.06)} ${wm}
      <div style="width:340px;height:2px;background:${GOLD};"></div>
      <h2 style="font-family:'Playfair Display',serif;font-size:76px;font-weight:900;color:${GOLD};text-align:center;line-height:1.15;letter-spacing:-1px;position:relative;">Lançamento na<br>segunda-feira.</h2>
      <p style="font-family:'Montserrat',sans-serif;font-size:34px;font-weight:500;color:#fff;text-align:center;line-height:1.5;position:relative;">Garanta sua pré-reserva agora.</p>
      <p style="font-family:'Montserrat',sans-serif;font-size:26px;font-weight:400;color:rgba(255,255,255,0.55);text-align:center;letter-spacing:2px;position:relative;">Link na bio.</p>
      <div style="width:340px;height:2px;background:${GOLD};"></div>
    </div></body></html>`
  },

  // ════════════════════════════════════════
  // STORY 1 Dia 2 — Bastidor
  // ════════════════════════════════════════
  {
    file: "10_story1_dia2_bastidor_sexta_20h.png",
    w: 1080, h: 1920,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1920px;background:${GREEN};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;gap:28px;">
      ${grain(0.06)}
      <div style="width:130px;height:4px;background:${GOLD};position:relative;"></div>
      <p style="font-family:'Montserrat',sans-serif;font-size:20px;font-weight:600;color:rgba(255,255,255,0.45);letter-spacing:5px;text-transform:uppercase;position:relative;">BASTIDORES</p>
      <p style="font-family:'Montserrat',sans-serif;font-size:58px;font-weight:700;color:#fff;text-align:center;padding:0 72px;line-height:1.3;position:relative;">Amanhã ele<br>chega aqui.</p>
      <div style="width:130px;height:4px;background:${GOLD};position:relative;"></div>
      <p style="font-family:'Montserrat',sans-serif;font-size:22px;color:rgba(255,255,255,0.3);margin-top:32px;text-align:center;padding:0 80px;position:relative;font-style:italic;">📦 Substituir por foto/vídeo real dos bastidores</p>
    </div></body></html>`
  },

  // ════════════════════════════════════════
  // STORY 2 Dia 2 — Caixa de perguntas
  // ════════════════════════════════════════
  {
    file: "11_story2_dia2_caixa_perguntas_sexta_20h.png",
    w: 1080, h: 1920,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1920px;background:${GREEN};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;gap:44px;">
      ${grain(0.06)}
      <p style="font-family:'Montserrat',sans-serif;font-size:46px;font-weight:700;color:#fff;text-align:center;padding:0 80px;line-height:1.45;position:relative;">Me conta: qual é o seu maior inimigo na dieta?</p>
      <div style="background:rgba(255,255,255,0.13);border:2px solid rgba(255,255,255,0.32);border-radius:20px;padding:32px 60px;width:780px;text-align:center;position:relative;">
        <p style="font-family:'Montserrat',sans-serif;font-size:28px;color:rgba(255,255,255,0.62);letter-spacing:1px;">✏️ Responder...</p>
      </div>
      <p style="font-family:'Montserrat',sans-serif;font-size:19px;color:rgba(255,255,255,0.3);position:absolute;bottom:38px;">Adicionar caixa de perguntas nativa</p>
    </div></body></html>`
  },

  // ════════════════════════════════════════
  // POST 3 — Antes/Depois PLACEHOLDER
  // ════════════════════════════════════════
  {
    file: "12_post3_antes_depois_MIDJOURNEY_sabado_10h.png",
    w: 1080, h: 1080,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1080px;background:#0f1a13;display:flex;position:relative;overflow:hidden;">
      <div style="flex:1;background:linear-gradient(135deg,#1a1005,#0d1408);display:flex;flex-direction:column;justify-content:space-between;padding:36px;border-right:1px solid rgba(255,255,255,0.15);">
        <p style="font-family:'Montserrat',sans-serif;font-size:22px;font-weight:600;color:rgba(255,255,255,0.55);letter-spacing:3px;text-transform:uppercase;">antes</p>
        <div style="background:rgba(0,0,0,0.5);border-radius:12px;padding:20px;margin-bottom:8px;">
          <p style="font-family:'Montserrat',sans-serif;font-size:13px;color:rgba(255,255,255,0.4);line-height:1.7;font-style:italic;">Mulher ~32a, morena clara, cabelo cacheado escuro, levemente acima do peso, cansaço sutil, sofá real, lamparina, apartamento br</p>
        </div>
      </div>
      <div style="flex:1;background:linear-gradient(135deg,#0d1a0d,#071305);display:flex;flex-direction:column;justify-content:space-between;align-items:flex-end;padding:36px;">
        <p style="font-family:'Montserrat',sans-serif;font-size:22px;font-weight:600;color:rgba(255,255,255,0.55);letter-spacing:3px;text-transform:uppercase;">depois</p>
        <div style="background:rgba(0,0,0,0.5);border-radius:12px;padding:20px;margin-bottom:8px;text-align:right;">
          <p style="font-family:'Montserrat',sans-serif;font-size:13px;color:rgba(255,255,255,0.4);line-height:1.7;font-style:italic;">Mesma mulher, corpo slim, mesmo sofá, luz natural janela, sorriso genuíno, confiança sutil, mesmo ambiente</p>
        </div>
      </div>
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(184,150,46,0.15);border:2px solid ${GOLD};border-radius:16px;padding:28px 44px;text-align:center;width:660px;">
        <p style="font-family:'Montserrat',sans-serif;font-size:18px;font-weight:800;color:${GOLD};letter-spacing:2px;margin-bottom:10px;">⚠ GERAR COM MIDJOURNEY OU DALL-E 3</p>
        <p style="font-family:'Montserrat',sans-serif;font-size:12px;color:rgba(255,255,255,0.55);line-height:1.7;">Prompt completo disponível em<br>outputs/appetix_launch/copy/post3_antes_depois_prompt.txt</p>
      </div>
      <div style="position:absolute;bottom:28px;right:32px;font-family:'Montserrat',sans-serif;font-size:13px;color:rgba(255,255,255,0.22);">APPETIX 🌿</div>
    </div></body></html>`
  },

  // ════════════════════════════════════════
  // STORY 1 Dia 3 — Estoque limitado
  // ════════════════════════════════════════
  {
    file: "13_story1_dia3_estoque_sabado_20h.png",
    w: 1080, h: 1920,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1920px;background:${DARKRED};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;gap:24px;">
      ${grain(0.065)}
      <h1 style="font-family:'Montserrat',sans-serif;font-size:100px;font-weight:900;color:#fff;text-align:center;letter-spacing:-3px;line-height:0.95;position:relative;">Estoque<br>limitado.</h1>
      <p style="font-family:'Montserrat',sans-serif;font-size:30px;font-weight:400;color:rgba(255,255,255,0.65);text-align:center;padding:0 80px;line-height:1.6;position:relative;">Próximo lote disponível em breve.</p>
    </div></body></html>`
  },

  // ════════════════════════════════════════
  // STORY 2 Dia 3 — Pré-reserva
  // ════════════════════════════════════════
  {
    file: "14_story2_dia3_pre_reserva_sabado_20h.png",
    w: 1080, h: 1920,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1920px;background:${GREEN};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;gap:28px;padding:80px;">
      ${grain(0.06)}
      <p style="font-family:'Montserrat',sans-serif;font-size:34px;font-weight:400;color:rgba(255,255,255,0.75);text-align:center;line-height:1.5;position:relative;">Quem fizer pré-reserva até domingo</p>
      <h1 style="font-family:'Playfair Display',serif;font-size:98px;font-weight:900;color:#fff;text-align:center;letter-spacing:-3px;line-height:1.0;position:relative;">recebe<br>primeiro.</h1>
      <div style="width:300px;height:3px;background:${GOLD};position:relative;"></div>
      <p style="font-family:'Montserrat',sans-serif;font-size:27px;font-weight:400;color:rgba(255,255,255,0.62);text-align:center;line-height:1.65;position:relative;">Você só paga quando<br>o produto chegar.</p>
    </div></body></html>`
  },

  // ════════════════════════════════════════
  // STORY 3 Dia 3 — Countdown
  // ════════════════════════════════════════
  {
    file: "15_story3_dia3_countdown_sabado_20h.png",
    w: 1080, h: 1920,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1920px;background:${GREEN};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;gap:36px;">
      ${grain(0.06)}
      <p style="font-family:'Montserrat',sans-serif;font-size:30px;font-weight:600;color:rgba(255,255,255,0.65);letter-spacing:3px;text-transform:uppercase;position:relative;">Appetix chega em:</p>
      <div style="display:flex;gap:20px;align-items:center;position:relative;">
        <div style="text-align:center;">
          <div style="background:rgba(255,255,255,0.1);border:2px solid rgba(184,150,46,0.55);border-radius:16px;padding:22px 34px;"><p style="font-family:'Playfair Display',serif;font-size:84px;font-weight:900;color:#fff;line-height:1;">01</p></div>
          <p style="font-family:'Montserrat',sans-serif;font-size:18px;color:rgba(255,255,255,0.45);margin-top:10px;letter-spacing:1px;">dias</p>
        </div>
        <p style="font-family:'Playfair Display',serif;font-size:76px;color:${GOLD};margin-bottom:24px;">:</p>
        <div style="text-align:center;">
          <div style="background:rgba(255,255,255,0.1);border:2px solid rgba(184,150,46,0.55);border-radius:16px;padding:22px 34px;"><p style="font-family:'Playfair Display',serif;font-size:84px;font-weight:900;color:#fff;line-height:1;">08</p></div>
          <p style="font-family:'Montserrat',sans-serif;font-size:18px;color:rgba(255,255,255,0.45);margin-top:10px;letter-spacing:1px;">horas</p>
        </div>
        <p style="font-family:'Playfair Display',serif;font-size:76px;color:${GOLD};margin-bottom:24px;">:</p>
        <div style="text-align:center;">
          <div style="background:rgba(255,255,255,0.1);border:2px solid rgba(184,150,46,0.55);border-radius:16px;padding:22px 34px;"><p style="font-family:'Playfair Display',serif;font-size:84px;font-weight:900;color:#fff;line-height:1;">00</p></div>
          <p style="font-family:'Montserrat',sans-serif;font-size:18px;color:rgba(255,255,255,0.45);margin-top:10px;letter-spacing:1px;">min</p>
        </div>
      </div>
      <p style="font-family:'Montserrat',sans-serif;font-size:19px;color:rgba(255,255,255,0.3);position:absolute;bottom:38px;">Substituir por contagem regressiva nativa do Instagram</p>
    </div></body></html>`
  },

  // ════════════════════════════════════════
  // POST 5 — "Amanhã." — Domingo 18h
  // ════════════════════════════════════════
  {
    file: "16_post5_amanha_domingo_18h.png",
    w: 1080, h: 1080,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1080px;background:${GREEN};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;gap:24px;padding:70px;">
      ${grain(0.065)} ${wm}
      <div style="width:260px;height:2px;background:${GOLD};position:relative;"></div>
      <h1 style="font-family:'Playfair Display',serif;font-size:168px;font-weight:900;color:#fff;text-align:center;letter-spacing:-5px;line-height:0.9;position:relative;">Amanhã.</h1>
      <div style="position:relative;">${botanicSVG}</div>
      <p style="font-family:'Montserrat',sans-serif;font-size:25px;font-weight:500;color:rgba(255,255,255,0.82);text-align:center;letter-spacing:2.5px;position:relative;">Appetix — controle real do apetite.</p>
      <p style="font-family:'Montserrat',sans-serif;font-size:19px;font-weight:400;color:rgba(255,255,255,0.48);text-align:center;letter-spacing:1px;position:relative;">Pré-reserva encerra hoje à meia-noite. Link na bio.</p>
      <div style="width:260px;height:2px;background:${GOLD};position:relative;"></div>
    </div></body></html>`
  },

  // ════════════════════════════════════════
  // STORY Manhã Dia 4 — Domingo 09h
  // ════════════════════════════════════════
  {
    file: "17_story_manha_dia4_domingo_9h.png",
    w: 1080, h: 1920,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1920px;background:${GREEN};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;gap:28px;padding:80px;">
      ${grain(0.06)}
      <h1 style="font-family:'Montserrat',sans-serif;font-size:74px;font-weight:900;color:#fff;text-align:center;line-height:1.2;letter-spacing:-2px;position:relative;">Último dia<br>de pré-reserva.</h1>
      <p style="font-family:'Montserrat',sans-serif;font-size:36px;font-weight:600;color:${GOLD};text-align:center;line-height:1.4;position:relative;">Garante o seu agora.</p>
      <div style="display:flex;align-items:center;gap:16px;margin-top:16px;position:relative;">
        <div style="width:44px;height:2px;background:rgba(255,255,255,0.3);"></div>
        <p style="font-family:'Montserrat',sans-serif;font-size:22px;color:rgba(255,255,255,0.5);letter-spacing:1px;">↑ Link na bio</p>
        <div style="width:44px;height:2px;background:rgba(255,255,255,0.3);"></div>
      </div>
    </div></body></html>`
  },

  // ════════════════════════════════════════
  // STORY Tarde Dia 4 — Domingo 15h
  // ════════════════════════════════════════
  {
    file: "18_story_tarde_dia4_domingo_15h.png",
    w: 1080, h: 1920,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1920px;background:${OFFWHITE};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;gap:20px;padding:80px;">
      <p style="font-family:'Montserrat',sans-serif;font-size:28px;font-weight:400;color:#666;text-align:center;line-height:1.55;position:relative;">pessoas já garantiram<br>o frasco.</p>
      <h1 style="font-family:'Playfair Display',serif;font-size:172px;font-weight:900;color:${GREEN};line-height:1;letter-spacing:-5px;position:relative;">[X]</h1>
      <div style="width:220px;height:3px;background:${GOLD};position:relative;"></div>
      <p style="font-family:'Montserrat',sans-serif;font-size:38px;font-weight:700;color:#111;text-align:center;position:relative;">Você ainda não?</p>
      <p style="font-family:'Montserrat',sans-serif;font-size:17px;color:rgba(26,71,49,0.35);position:absolute;bottom:44px;font-style:italic;">Substituir [X] pelo número real de pré-reservas</p>
      ${wmDark}
    </div></body></html>`
  },

  // ════════════════════════════════════════
  // STORY Noite Dia 4 — Domingo 22h
  // ════════════════════════════════════════
  {
    file: "19_story_noite_dia4_domingo_22h.png",
    w: 1080, h: 1920,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1920px;background:${GREEN};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;gap:24px;padding:80px;">
      ${grain(0.065)}
      <h1 style="font-family:'Playfair Display',serif;font-size:82px;font-weight:900;font-style:italic;color:#fff;text-align:center;line-height:1.2;letter-spacing:-2px;position:relative;">Amanhã<br>a fórmula chega.</h1>
      <div style="width:200px;height:2px;background:${GOLD};position:relative;opacity:0.6;"></div>
      <h1 style="font-family:'Playfair Display',serif;font-size:82px;font-weight:900;font-style:italic;color:rgba(255,255,255,0.65);text-align:center;line-height:1.2;letter-spacing:-2px;position:relative;">Amanhã<br>o controle começa.</h1>
      <p style="font-family:'Montserrat',sans-serif;font-size:32px;font-weight:500;color:${GOLD};margin-top:20px;letter-spacing:2px;position:relative;">🌿 Appetix</p>
      <p style="font-family:'Montserrat',sans-serif;font-size:18px;color:rgba(255,255,255,0.3);position:absolute;bottom:38px;">Adicionar contagem regressiva nativa — segunda 08h</p>
    </div></body></html>`
  },

  // ════════════════════════════════════════
  // POST 6 — CHEGOU Lançamento — Segunda 08h
  // ════════════════════════════════════════
  {
    file: "20_post6_chegou_lancamento_segunda_8h.png",
    w: 1080, h: 1080,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1080px;background:${GREEN};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;gap:20px;padding:60px;overflow:hidden;">
      <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:700px;height:700px;background:radial-gradient(circle,rgba(184,150,46,0.16) 0%,transparent 68%);pointer-events:none;"></div>
      ${grain(0.06)} ${wm}
      <!-- confetti particles -->
      <div style="position:absolute;top:90px;left:130px;width:9px;height:9px;border-radius:50%;background:${GOLD};opacity:0.38;"></div>
      <div style="position:absolute;top:155px;right:170px;width:6px;height:6px;border-radius:50%;background:${GOLD};opacity:0.28;"></div>
      <div style="position:absolute;top:220px;left:280px;width:5px;height:5px;border-radius:2px;background:rgba(255,255,255,0.25);transform:rotate(45deg);"></div>
      <div style="position:absolute;bottom:190px;left:190px;width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,0.22);"></div>
      <div style="position:absolute;bottom:130px;right:250px;width:8px;height:8px;border-radius:50%;background:${GOLD};opacity:0.32;"></div>
      <div style="position:absolute;top:300px;right:100px;width:5px;height:5px;border-radius:2px;background:${GOLD};opacity:0.3;transform:rotate(30deg);"></div>
      <h1 style="position:relative;font-family:'Playfair Display',serif;font-size:162px;font-weight:900;color:#fff;text-align:center;letter-spacing:-5px;line-height:0.92;">CHEGOU.</h1>
      <div style="position:relative;">${botanicSVG}</div>
      <p style="position:relative;font-family:'Montserrat',sans-serif;font-size:27px;font-weight:500;color:rgba(255,255,255,0.82);text-align:center;letter-spacing:3px;">Appetix — Controle real do apetite.</p>
      <p style="position:relative;font-family:'Montserrat',sans-serif;font-size:20px;font-weight:400;color:rgba(255,255,255,0.5);text-align:center;letter-spacing:1px;">Link na bio para garantir o seu.</p>
    </div></body></html>`
  },

  // ════════════════════════════════════════
  // POST 7 — Oferta 48h — Segunda 12h
  // ════════════════════════════════════════
  {
    file: "21_post7_oferta_48h_segunda_12h.png",
    w: 1080, h: 1080,
    html: `<!DOCTYPE html><html><head>${FONTS}</head><body>
    <div style="width:1080px;height:1080px;background:${OFFWHITE};display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;gap:22px;padding:60px;overflow:hidden;">
      <div style="position:absolute;inset:0;pointer-events:none;">
        <svg width="1080" height="1080" viewBox="0 0 1080 1080" fill="none" xmlns="http://www.w3.org/2000/svg">
          <filter id="gr4"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="4" seed="7"/>
          <feColorMatrix type="saturate" values="0"/></filter>
          <rect width="1080" height="1080" filter="url(#gr4)" opacity="0.04"/>
          <!-- leaf TL -->
          <path d="M0 0 C50 25,25 70,70 48 C95 36,50 85,95 98" stroke="${GREEN}" stroke-width="1.5" fill="none" opacity="0.2"/>
          <ellipse cx="42" cy="42" rx="14" ry="22" fill="${GREEN}" opacity="0.1" transform="rotate(-35 42 42)"/>
          <ellipse cx="78" cy="68" rx="11" ry="18" fill="${GREEN}" opacity="0.08" transform="rotate(-18 78 68)"/>
          <!-- leaf BR -->
          <path d="M1080 1080 C1030 1055,1055 1010,1010 1032 C985 1044,1030 995,985 982" stroke="${GREEN}" stroke-width="1.5" fill="none" opacity="0.2"/>
          <ellipse cx="1038" cy="1038" rx="14" ry="22" fill="${GREEN}" opacity="0.1" transform="rotate(145 1038 1038)"/>
        </svg>
      </div>
      ${wmDark}
      <h2 style="position:relative;font-family:'Playfair Display',serif;font-size:54px;font-weight:900;color:${GREEN};text-align:center;letter-spacing:-1px;">Oferta de Lançamento</h2>
      <div style="width:300px;height:3px;background:${GOLD};position:relative;"></div>
      <h1 style="position:relative;font-family:'Playfair Display',serif;font-size:108px;font-weight:900;color:${GREEN};line-height:1;letter-spacing:-4px;text-align:center;">48 horas<br>apenas.</h1>
      <div style="position:relative;background:#fff;border:2px solid ${GREEN};border-radius:18px;padding:28px 44px;width:820px;text-align:center;">
        <p style="font-family:'Montserrat',sans-serif;font-size:22px;font-weight:600;color:${GREEN};line-height:2;">✅ 60 cápsulas | 500mg&nbsp;&nbsp;&nbsp;✅ Frete grátis<br>✅ Fórmula otimizada para a grelina&nbsp;&nbsp;&nbsp;✅ Preço especial</p>
      </div>
    </div></body></html>`
  },

];

async function run() {
  const browser = await chromium.launch();

  for (const img of images) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: img.w, height: img.h });
    await page.setContent(img.html, { waitUntil: "networkidle" });
    // extra wait for webfonts
    await page.waitForTimeout(1800);
    const outPath = path.join(OUT, img.file);
    await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: img.w, height: img.h } });
    await page.close();
    console.log(`✅ ${img.file}`);
  }

  await browser.close();
  console.log(`\n🌿 Todos os ${images.length} assets gerados em outputs/appetix_launch/images/`);
}

run().catch(console.error);
