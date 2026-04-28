/**
 * Apartamento de Luxo — Bairro X
 * Platform: Instagram Reels / YouTube Shorts (9:16)
 * Duration: 15s @ 30fps = 450 frames
 * Strategy: lifestyle
 * Aesthetic: Quiet Luxury / Dark Editorial
 *
 * Scene 1 — Hook      0–2.5s    frames   0–75
 * Scene 2 — Problem   2.5–5.5s  frames  75–165
 * Scene 3 — Reframe   5.5–7.5s  frames 165–225
 * Scene 4 — Product   7.5–10.5s frames 225–315
 * Scene 5 — Benefit   10.5–13s  frames 315–390
 * Scene 6 — CTA       13–15s    frames 390–450
 */

import React from "react";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const FPS = 30;
const t = (seconds: number) => Math.round(seconds * FPS);

const SCENES = {
  hook:    { from: t(0),    dur: t(2.5) },
  problem: { from: t(2.5),  dur: t(3)   },
  reframe: { from: t(5.5),  dur: t(2)   },
  product: { from: t(7.5),  dur: t(3)   },
  benefit: { from: t(10.5), dur: t(2.5) },
  cta:     { from: t(13),   dur: t(2)   },
};

const GOLD = "#C9A84C";
const CREAM = "#F5F0E8";
const DARK = "#0B0B0B";

const SERIF: React.CSSProperties = {
  fontFamily: "'Cormorant Garamond', 'Didot', 'Georgia', serif",
  margin: 0,
  lineHeight: 1.05,
};

const SANS: React.CSSProperties = {
  fontFamily: "'Inter', 'Helvetica Neue', Arial, sans-serif",
  margin: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// Grain overlay — textura editorial sutil
// ─────────────────────────────────────────────────────────────────────────────

function Grain({ opacity = 0.035 }: { opacity?: number }) {
  const frame = useCurrentFrame();
  const seed = (frame * 11) % 997;
  const id = `g${seed}`;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 99 }}>
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <filter id={id}>
          <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="4" seed={seed} />
          <feColorMatrix type="saturate" values="0" />
          <feBlend in="SourceGraphic" mode="overlay" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${id})`} opacity={opacity} />
      </svg>
    </AbsoluteFill>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene 1 — Hook (0–2.5s)
// "Quantas horas você perde por dia por morar no lugar errado?"
// ─────────────────────────────────────────────────────────────────────────────

function HookScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({
    frame,
    fps,
    config: { damping: 8, stiffness: 200, mass: 1.0 },
    from: 1.15,
    to: 1.0,
  });

  const opacity = interpolate(frame, [0, 6], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: DARK }}>
      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 72px",
        }}
      >
        <p
          style={{
            ...SERIF,
            fontSize: 80,
            fontWeight: 700,
            color: CREAM,
            textAlign: "center",
            opacity,
            transform: `scale(${scale})`,
            textShadow: `0 0 80px rgba(201,168,76,0.25)`,
          }}
        >
          Quantas horas você perde por dia por morar no lugar errado?
        </p>
      </AbsoluteFill>
      <Grain opacity={0.04} />
    </AbsoluteFill>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene 2 — Problem (2.5–5.5s)
// Três dores em cards sequenciais
// ─────────────────────────────────────────────────────────────────────────────

const PROBLEMS = ["Trânsito.", "Vizinhança errada.", "Prédio que não te representa."];
const PROBLEM_COLORS = ["#1a0a0a", "#0a0a1a", "#0a1a0a"];

function ProblemScene() {
  const frame = useCurrentFrame();
  const seg = t(1);
  const idx = Math.min(Math.floor(frame / seg), PROBLEMS.length - 1);
  const segFrame = frame - idx * seg;

  const opacity = interpolate(segFrame, [0, 5, seg - 5, seg], [0, 1, 1, 0], {
    extrapolateRight: "clamp",
  });
  const y = interpolate(segFrame, [0, 10], [20, 0], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill style={{ backgroundColor: PROBLEM_COLORS[idx] }}>
      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 80px",
        }}
      >
        <p
          style={{
            ...SERIF,
            fontSize: 96,
            fontWeight: 300,
            color: CREAM,
            textAlign: "center",
            fontStyle: "italic",
            opacity,
            transform: `translateY(${y}px)`,
          }}
        >
          {PROBLEMS[idx]}
        </p>
      </AbsoluteFill>
      <Grain opacity={0.05} />
    </AbsoluteFill>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene 3 — Reframe (5.5–7.5s)
// ─────────────────────────────────────────────────────────────────────────────

function ReframeScene() {
  const frame = useCurrentFrame();

  const mainOpacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  const subOpacity  = interpolate(frame, [30, 44], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000000" }}>
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 80px",
          gap: 36,
        }}
      >
        <p
          style={{
            ...SERIF,
            fontSize: 76,
            fontWeight: 700,
            color: CREAM,
            textAlign: "center",
            opacity: mainOpacity,
          }}
        >
          O problema não é onde você mora.
        </p>
        <p
          style={{
            ...SERIF,
            fontSize: 52,
            fontWeight: 300,
            fontStyle: "italic",
            color: "#777777",
            textAlign: "center",
            lineHeight: 1.3,
            opacity: subOpacity,
          }}
        >
          É que você ainda não encontrou o endereço certo.
        </p>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene 4 — Product (7.5–10.5s)
// Nome dourado + linha animada — fundo escuro com vignette
// ─────────────────────────────────────────────────────────────────────────────

function ProductScene() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const sceneOpacity = interpolate(frame, [0, 8], [0, 1], { extrapolateRight: "clamp" });

  const eyebrowOpacity = interpolate(frame, [8, 20], [0, 1], { extrapolateRight: "clamp" });
  const lineWidth      = interpolate(frame, [14, 46], [0, 220], { extrapolateRight: "clamp" });

  const nameSlide   = spring({ frame: Math.max(0, frame - 16), fps, config: { damping: 14, stiffness: 100 }, from: 50, to: 0 });
  const nameOpacity = interpolate(frame, [16, 30], [0, 1], { extrapolateRight: "clamp" });
  const subOpacity  = interpolate(frame, [32, 46], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: DARK, opacity: sceneOpacity }}>
      <AbsoluteFill
        style={{
          background: "radial-gradient(ellipse at center, rgba(201,168,76,0.08) 0%, transparent 65%)",
          pointerEvents: "none",
        }}
      />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingBottom: 140,
        }}
      >
        <p
          style={{
            ...SANS,
            fontSize: 20,
            fontWeight: 400,
            color: GOLD,
            letterSpacing: 5,
            textTransform: "uppercase",
            opacity: eyebrowOpacity,
            marginBottom: 20,
          }}
        >
          Bairro X · Lançamento Exclusivo
        </p>

        <div
          style={{
            width: lineWidth,
            height: 1.5,
            backgroundColor: GOLD,
            marginBottom: 28,
            opacity: eyebrowOpacity,
          }}
        />

        <p
          style={{
            ...SERIF,
            fontSize: 128,
            fontWeight: 700,
            color: GOLD,
            letterSpacing: -2,
            opacity: nameOpacity,
            transform: `translateY(${nameSlide}px)`,
            textShadow: `0 4px 40px rgba(201,168,76,0.4)`,
          }}
        >
          Bairro X
        </p>

        <p
          style={{
            ...SANS,
            fontSize: 30,
            fontWeight: 300,
            color: CREAM,
            letterSpacing: 6,
            textTransform: "uppercase",
            opacity: subOpacity,
            marginTop: 12,
          }}
        >
          Apartamento de Luxo
        </p>
      </AbsoluteFill>
      <Grain opacity={0.04} />
    </AbsoluteFill>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene 5 — Benefit (10.5–13s)
// ─────────────────────────────────────────────────────────────────────────────

const BENEFITS = [
  "Localização que otimiza seu tempo",
  "Design personalizado para o seu estilo",
  "Valorização consistente",
];

function BenefitScene() {
  const frame = useCurrentFrame();
  const seg = t(0.7);

  return (
    <AbsoluteFill style={{ backgroundColor: "#080808" }}>
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 72px",
          gap: 36,
        }}
      >
        {BENEFITS.map((text, i) => {
          const at = i * seg;
          const opacity = interpolate(frame, [at, at + 8], [0, 1], { extrapolateRight: "clamp" });
          const y = interpolate(frame, [at, at + 14], [18, 0], {
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.cubic),
          });

          return (
            <div
              key={i}
              style={{ display: "flex", alignItems: "center", gap: 24, opacity, transform: `translateY(${y}px)` }}
            >
              <span style={{ color: GOLD, fontSize: 52, lineHeight: 1, flexShrink: 0 }}>✦</span>
              <p style={{ ...SERIF, fontSize: 62, fontWeight: 400, color: CREAM }}>
                {text}
              </p>
            </div>
          );
        })}
      </AbsoluteFill>
      <Grain opacity={0.04} />
    </AbsoluteFill>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene 6 — CTA (13–15s)
// ─────────────────────────────────────────────────────────────────────────────

function CTAScene() {
  const frame = useCurrentFrame();
  const dur = SCENES.cta.dur;

  const mainOpacity = interpolate(frame, [0, 10],        [0, 1], { extrapolateRight: "clamp" });
  const btnOpacity  = interpolate(frame, [22, 34],       [0, 1], { extrapolateRight: "clamp" });
  const fadeOut     = interpolate(frame, [dur - 12, dur], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, #0a0800 0%, ${DARK} 100%)` }}>
      <AbsoluteFill
        style={{
          background: "radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.70) 100%)",
          pointerEvents: "none",
        }}
      />

      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 72px",
          gap: 48,
        }}
      >
        <p
          style={{
            ...SERIF,
            fontSize: 72,
            fontWeight: 700,
            color: CREAM,
            textAlign: "center",
            whiteSpace: "pre-line",
            opacity: mainOpacity,
          }}
        >
          {"Ou você escolhe\no endereço...\n...ou ele\nescolhe por você."}
        </p>

        <div
          style={{
            border: `2px solid ${GOLD}`,
            borderRadius: 4,
            paddingTop: 22,
            paddingBottom: 22,
            paddingLeft: 52,
            paddingRight: 52,
            opacity: btnOpacity,
          }}
        >
          <p
            style={{
              ...SANS,
              fontSize: 28,
              fontWeight: 400,
              color: GOLD,
              textAlign: "center",
              letterSpacing: 4,
              textTransform: "uppercase",
            }}
          >
            Conheça o Bairro X
          </p>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ backgroundColor: "#000000", opacity: fadeOut }} />
      <Grain opacity={0.045} />
    </AbsoluteFill>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Composition
// ─────────────────────────────────────────────────────────────────────────────

export const LuxuryAptVideo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: DARK }}>
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
