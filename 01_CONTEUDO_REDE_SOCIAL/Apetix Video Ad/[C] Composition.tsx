/**
 * Apetix — Video Ad Composition
 * Platform: Instagram Reels / TikTok / YouTube Shorts (9:16)
 * Duration: 15s @ 30fps = 450 frames
 * Strategy: problem_solution
 *
 * Root.tsx registration:
 *   <Composition id="AdVideo" component={AdVideo}
 *     durationInFrames={450} fps={30} width={1080} height={1920}
 *     defaultProps={AD_PROPS} />
 *
 * Scene 1 — Hook      0–2s    frames   0–60
 * Scene 2 — Problem   2–5s    frames  60–150
 * Scene 3 — Reframe   5–7s    frames 150–210
 * Scene 4 — Product   7–10s   frames 210–300
 * Scene 5 — Benefit  10–13s   frames 300–390
 * Scene 6 — CTA      13–15s   frames 390–450
 */

import React from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const FPS = 30;
const t = (seconds: number) => Math.round(seconds * FPS);

const SCENES = {
  hook:    { from: t(0),  dur: t(2)  },
  problem: { from: t(2),  dur: t(3)  },
  reframe: { from: t(5),  dur: t(2)  },
  product: { from: t(7),  dur: t(3)  },
  benefit: { from: t(10), dur: t(3)  },
  cta:     { from: t(13), dur: t(2)  },
};

export const AD_PROPS = {
  style: "problem_solution",
  duration: 15,
  platform: "instagram_reels",
  aspect_ratio: "9:16",
  aesthetic: "ugc_realistic",
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared typography
// ─────────────────────────────────────────────────────────────────────────────

const BLACK: React.CSSProperties = {
  fontFamily: "'Inter', 'Helvetica Neue', 'Arial Black', sans-serif",
  fontWeight: 900,
  letterSpacing: -2,
  lineHeight: 1.05,
  margin: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// Grain overlay — animates grain seed per frame for UGC texture
// ─────────────────────────────────────────────────────────────────────────────

function Grain({ opacity = 0.045 }: { opacity?: number }) {
  const frame = useCurrentFrame();
  const seed = (frame * 13) % 997;
  const id = `g${seed}`;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 99 }}>
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <filter id={id}>
          <feTurbulence type="fractalNoise" baseFrequency="0.78" numOctaves="4" seed={seed} />
          <feColorMatrix type="saturate" values="0" />
          <feBlend in="SourceGraphic" mode="overlay" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${id})`} opacity={opacity} />
      </svg>
    </AbsoluteFill>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Camera shake — deterministic per frame, simulates handheld UGC
// ─────────────────────────────────────────────────────────────────────────────

function useShake(intensity = 2) {
  const frame = useCurrentFrame();
  return {
    x: Math.sin(frame * 1.4 + 0.3) * intensity,
    y: Math.cos(frame * 0.9 + 0.8) * intensity,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene 1 — Hook (0–2s)
// "Você não tem fome." — impacto máximo, texto agressivo, shake leve
// ─────────────────────────────────────────────────────────────────────────────

function HookScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { x, y } = useShake(2.5);

  const mainScale = spring({
    frame,
    fps,
    config: { damping: 7, stiffness: 240, mass: 0.9 },
    from: 1.4,
    to: 1.0,
  });

  const mainOpacity  = interpolate(frame, [0, 4],   [0, 1], { extrapolateRight: "clamp" });
  const subOpacity   = interpolate(frame, [12, 22], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        background: "radial-gradient(ellipse at 50% 40%, #200808 0%, #000000 100%)",
        transform: `translate(${x}px, ${y}px)`,
      }}
    >
      {/* Red vignette */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 35%, rgba(140,0,0,0.65) 100%)",
          pointerEvents: "none",
        }}
      />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 64px",
          gap: 32,
        }}
      >
        {/* Main hook text */}
        <p
          style={{
            ...BLACK,
            fontSize: 110,
            color: "#FFFFFF",
            textAlign: "center",
            textTransform: "uppercase",
            textShadow:
              "0 0 70px rgba(255,40,40,0.75), 0 6px 32px rgba(0,0,0,0.95)",
            opacity: mainOpacity,
            transform: `scale(${mainScale})`,
          }}
        >
          Você não tem fome.
        </p>

        {/* Subtext */}
        <p
          style={{
            ...BLACK,
            fontWeight: 700,
            fontSize: 50,
            color: "#FF3B30",
            textAlign: "center",
            letterSpacing: 1,
            textTransform: "uppercase",
            opacity: subOpacity,
          }}
        >
          Você está sendo controlado.
        </p>
      </AbsoluteFill>

      <Grain opacity={0.065} />
    </AbsoluteFill>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene 2 — Problem (2–5s)
// Cortes rápidos, 1 problema por segundo, zoom progressivo
// ─────────────────────────────────────────────────────────────────────────────

const PROBLEMS = [
  "Vontade de comer toda hora",
  "Ansiedade à noite",
  "Compulsão fora de controle",
];

const PROBLEM_BG = ["#0d0d0d", "#08080f", "#100808"];

function ProblemScene() {
  const frame = useCurrentFrame();
  const seg   = t(1); // 1 second per problem = 30 frames

  const idx      = Math.min(Math.floor(frame / seg), PROBLEMS.length - 1);
  const segFrame = frame - idx * seg;

  const zoom    = interpolate(segFrame, [0, seg], [1.0, 1.07], { extrapolateRight: "clamp" });
  const opacity = interpolate(
    segFrame,
    [0, 5, seg - 6, seg],
    [0, 1, 1, 0],
    { extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: PROBLEM_BG[idx], overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 64px",
          transform: `scale(${zoom})`,
        }}
      >
        <p
          style={{
            ...BLACK,
            fontSize: 84,
            color: "#FFFFFF",
            textAlign: "center",
            textTransform: "uppercase",
            textShadow: "0 2px 28px rgba(0,0,0,0.95)",
            opacity,
          }}
        >
          {PROBLEMS[idx]}
        </p>
      </AbsoluteFill>
      <Grain opacity={0.075} />
    </AbsoluteFill>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene 3 — Reframe (5–7s)
// Tela limpa, pausa intencional, quebra de culpa
// ─────────────────────────────────────────────────────────────────────────────

function ReframeScene() {
  const frame = useCurrentFrame();

  const mainOpacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  // Subtext entra após pausa longa (~1.3s)
  const subOpacity  = interpolate(frame, [40, 52], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 72px",
          gap: 40,
        }}
      >
        <p
          style={{
            ...BLACK,
            fontSize: 84,
            color: "#FFFFFF",
            textAlign: "center",
            textTransform: "uppercase",
            opacity: mainOpacity,
          }}
        >
          O problema não é você.
        </p>

        <p
          style={{
            ...BLACK,
            fontWeight: 600,
            fontSize: 56,
            color: "#999999",
            textAlign: "center",
            lineHeight: 1.3,
            opacity: subOpacity,
          }}
        >
          É o seu apetite desregulado.
        </p>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene 4 — Product (7–10s)
// Frasco Apetix centralizado, zoom spring + glow pulsante
// ─────────────────────────────────────────────────────────────────────────────

function ProductScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Fade in da cena inteira
  const sceneOpacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });

  // Ken Burns — zoom lento e suave na foto (1.0 → 1.08 ao longo de 90 frames)
  const kenBurns = interpolate(frame, [0, 90], [1.0, 1.08], { extrapolateRight: "clamp" });

  // Texto entra com spring
  const nameSlide = spring({ frame: Math.max(0, frame - 18), fps, config: { damping: 16, stiffness: 90 }, from: 40, to: 0 });
  const nameOpacity = interpolate(frame, [18, 32], [0, 1], { extrapolateRight: "clamp" });
  const subOpacity  = interpolate(frame, [32, 46], [0, 1], { extrapolateRight: "clamp" });
  const lineOpacity = interpolate(frame, [26, 40], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000", opacity: sceneOpacity }}>

      {/*
       * Foto lifestyle do Appetix — full-bleed, Ken Burns lento.
       * Salve em: public/appetix-lifestyle.jpg
       */}
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <Img
          src={staticFile("appetix-lifestyle.jpg")}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center 30%",
            transform: `scale(${kenBurns})`,
            transformOrigin: "center 35%",
          }}
        />
      </AbsoluteFill>

      {/* Gradient overlay — escurece o bottom para texto legível */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.1) 40%, rgba(0,0,0,0.75) 72%, rgba(0,0,0,0.92) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Vignette nas bordas — UGC feel */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.45) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Texto no rodapé */}
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: 120,
          gap: 0,
        }}
      >
        {/* Nome do produto */}
        <p
          style={{
            ...BLACK,
            fontSize: 120,
            color: "#C9A84C",
            textTransform: "uppercase",
            letterSpacing: -3,
            opacity: nameOpacity,
            transform: `translateY(${nameSlide}px)`,
            textShadow: "0 4px 32px rgba(0,0,0,0.9), 0 0 60px rgba(201,168,76,0.35)",
            margin: 0,
          }}
        >
          Apetix
        </p>

        {/* Linha dourada decorativa */}
        <div
          style={{
            width: interpolate(frame, [26, 52], [0, 280], { extrapolateRight: "clamp" }),
            height: 2,
            backgroundColor: "#C9A84C",
            opacity: lineOpacity,
            marginTop: 4,
            marginBottom: 16,
          }}
        />

        {/* Subtítulo */}
        <p
          style={{
            ...BLACK,
            fontWeight: 500,
            fontSize: 36,
            color: "#FFFFFF",
            textTransform: "uppercase",
            letterSpacing: 5,
            opacity: subOpacity,
            textShadow: "0 2px 16px rgba(0,0,0,0.95)",
            margin: 0,
          }}
        >
          Controle real do apetite
        </p>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene 5 — Benefit (10–13s)
// Lista acumulativa de benefícios + âncora de preço
// ─────────────────────────────────────────────────────────────────────────────

const BENEFITS = ["Menos fome", "Mais controle", "Clareza mental"];
const SUBTEXTS = [
  "Efeito parecido com canetas emagrecedoras",
  "Por menos da metade do preço",
];
const BENEFIT_SEG = t(0.8); // ~24 frames cada

function BenefitScene() {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 64px",
          gap: 28,
        }}
      >
        {/* Benefits */}
        {BENEFITS.map((text, i) => {
          const appearsAt = i * BENEFIT_SEG;
          const opacity = interpolate(frame, [appearsAt, appearsAt + 8], [0, 1], {
            extrapolateRight: "clamp",
          });
          const y = interpolate(frame, [appearsAt, appearsAt + 14], [22, 0], {
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.cubic),
          });

          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 22,
                opacity,
                transform: `translateY(${y}px)`,
              }}
            >
              <span style={{ color: "#4CAF50", fontSize: 64, lineHeight: 1, flexShrink: 0 }}>
                ✓
              </span>
              <p style={{ ...BLACK, fontSize: 76, color: "#FFFFFF", textTransform: "uppercase" }}>
                {text}
              </p>
            </div>
          );
        })}

        {/* Price anchor */}
        <div
          style={{
            marginTop: 36,
            borderLeft: "6px solid #FF3B30",
            paddingLeft: 28,
            opacity: interpolate(frame, [t(2.5), t(2.8)], [0, 1], {
              extrapolateRight: "clamp",
            }),
          }}
        >
          {SUBTEXTS.map((text, i) => (
            <p
              key={i}
              style={{
                ...BLACK,
                fontWeight: 600,
                fontSize: 38,
                color: i === 0 ? "#FFFFFF" : "#FF3B30",
                lineHeight: 1.35,
                margin: "6px 0",
              }}
            >
              {text}
            </p>
          ))}
        </div>
      </AbsoluteFill>

      <Grain opacity={0.05} />
    </AbsoluteFill>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene 6 — CTA (13–15s)
// Linha final + botão CTA + fade to black
// ─────────────────────────────────────────────────────────────────────────────

function CTAScene() {
  const frame = useCurrentFrame();
  const { dur } = SCENES.cta; // 60 frames

  const mainOpacity = interpolate(frame, [0, 10],       [0, 1], { extrapolateRight: "clamp" });
  const ctaOpacity  = interpolate(frame, [24, 36],      [0, 1], { extrapolateRight: "clamp" });
  const fadeOut     = interpolate(frame, [dur - 14, dur],[0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{ background: "linear-gradient(180deg, #0e0005 0%, #000000 100%)" }}
    >
      {/* Vignette */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 28%, rgba(0,0,0,0.72) 100%)",
          pointerEvents: "none",
        }}
      />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 64px",
          gap: 44,
        }}
      >
        <p
          style={{
            ...BLACK,
            fontSize: 80,
            color: "#FFFFFF",
            textAlign: "center",
            textTransform: "uppercase",
            whiteSpace: "pre-line",
            opacity: mainOpacity,
          }}
        >
          {"Ou você controla\na fome...\n...ou ela\ncontrola você."}
        </p>

        <div
          style={{
            backgroundColor: "#FF3B30",
            borderRadius: 20,
            paddingTop: 26,
            paddingBottom: 26,
            paddingLeft: 56,
            paddingRight: 56,
            opacity: ctaOpacity,
          }}
        >
          <p
            style={{
              ...BLACK,
              fontSize: 52,
              color: "#FFFFFF",
              textAlign: "center",
              textTransform: "uppercase",
            }}
          >
            Comece hoje com Apetix
          </p>
        </div>
      </AbsoluteFill>

      {/* Fade to black */}
      <AbsoluteFill style={{ backgroundColor: "#000000", opacity: fadeOut }} />
      <Grain opacity={0.055} />
    </AbsoluteFill>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Composition
// ─────────────────────────────────────────────────────────────────────────────

export interface AdVideoProps {
  style: string;
  duration: number;
  platform: string;
  aspect_ratio: string;
  aesthetic: string;
}

export const AdVideo: React.FC<Partial<AdVideoProps>> = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      <Sequence from={SCENES.hook.from}    durationInFrames={SCENES.hook.dur}>
        <HookScene />
      </Sequence>

      <Sequence from={SCENES.problem.from} durationInFrames={SCENES.problem.dur}>
        <ProblemScene />
      </Sequence>

      <Sequence from={SCENES.reframe.from} durationInFrames={SCENES.reframe.dur}>
        <ReframeScene />
      </Sequence>

      <Sequence from={SCENES.product.from} durationInFrames={SCENES.product.dur}>
        <ProductScene />
      </Sequence>

      <Sequence from={SCENES.benefit.from} durationInFrames={SCENES.benefit.dur}>
        <BenefitScene />
      </Sequence>

      <Sequence from={SCENES.cta.from}     durationInFrames={SCENES.cta.dur}>
        <CTAScene />
      </Sequence>
    </AbsoluteFill>
  );
};
