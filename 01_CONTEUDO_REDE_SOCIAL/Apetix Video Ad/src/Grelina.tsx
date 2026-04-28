/**
 * Appetix — Post 4 — Animação Científica Grelina
 * Sábado 19h — 8 segundos @ 30fps = 240 frames
 * 1080x1920 (9:16)
 *
 * Ato 1 (0–3s):   Moléculas de grelina dormindo no estômago → acordam → se multiplicam
 * Ato 2 (3–5.5s): Pulsos elétricos sobem pelo nervo → cérebro acende
 * Ato 3 (5.5–8s): Cápsula verde desce → grelina diminui → paz restaurada
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
const t = (s: number) => Math.round(s * FPS);

const DARK_BLUE  = "#080e1a";
const AMBER      = "#f5a623";
const AMBER_DIM  = "#6b4a0f";
const GREEN_GLOW = "#2dce6a";
const NERVE_COLOR= "#3a7bd5";

// ─── Grain overlay ───────────────────────────────────────────────────────────
function Grain({ opacity = 0.04 }: { opacity?: number }) {
  const frame = useCurrentFrame();
  const seed = (frame * 17) % 997;
  const id = `gr${seed}`;
  return (
    <AbsoluteFill style={{ pointerEvents: "none", zIndex: 99 }}>
      <svg width="100%" height="100%">
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

// ─── Molécula de Grelina ──────────────────────────────────────────────────────
interface MolProps {
  cx: number; cy: number;
  r: number;
  phase: number;   // fase de animação para stagger
  awakeAt: number; // frame em que acorda
  shrinkAt: number; // frame em que começa a sumir
  color?: string;
}

function GrelinaMol({ cx, cy, r, phase, awakeAt, shrinkAt, color = AMBER }: MolProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // dormindo → acorda
  const awakeFactor = interpolate(frame, [awakeAt, awakeAt + 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // pulse quando acordada
  const pulse = awakeFactor > 0.5
    ? 1 + 0.18 * Math.sin((frame - awakeAt) * 0.32 + phase)
    : 1;

  // sumir com cápsula
  const shrinkFactor = interpolate(frame, [shrinkAt, shrinkAt + 20], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });

  const scale = awakeFactor * pulse * shrinkFactor;
  const opacity = awakeFactor * shrinkFactor;

  // label "GRELINA" só aparece na 1ª molécula
  const showLabel = phase === 0;

  return (
    <g transform={`translate(${cx},${cy}) scale(${scale})`} opacity={opacity}>
      {/* glow */}
      <circle cx={0} cy={0} r={r * 2.2} fill={color} opacity={0.12} />
      <circle cx={0} cy={0} r={r * 1.5} fill={color} opacity={0.22} />
      {/* corpo */}
      <circle cx={0} cy={0} r={r} fill={color} opacity={0.9} />
      {/* olhos */}
      <circle cx={-r * 0.28} cy={-r * 0.12} r={r * 0.14} fill="#fff" />
      <circle cx={r * 0.28}  cy={-r * 0.12} r={r * 0.14} fill="#fff" />
      {/* boca sorriso malicioso */}
      <path
        d={`M${-r * 0.3} ${r * 0.22} Q0 ${r * 0.5} ${r * 0.3} ${r * 0.22}`}
        stroke="#fff"
        strokeWidth={r * 0.1}
        fill="none"
        strokeLinecap="round"
      />
      {showLabel && (
        <text
          y={r * 1.9}
          textAnchor="middle"
          fontSize={r * 0.7}
          fill={color}
          fontFamily="'Inter',sans-serif"
          fontWeight="700"
          letterSpacing="2"
        >
          GRELINA
        </text>
      )}
    </g>
  );
}

// ─── Nervo / pulso elétrico ───────────────────────────────────────────────────
function NervePath({ startFrame }: { startFrame: number }) {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [startFrame, startFrame + 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.quad),
  });

  // o caminho vai do estômago (y≈1100) até o cérebro (y≈280)
  const pathD = "M 540 1100 C 560 900, 520 700, 545 500 C 558 400, 540 340, 540 280";
  const totalLen = 840;
  const dashOffset = totalLen * (1 - progress);

  const sparkOpacity = interpolate(frame, [startFrame + 5, startFrame + 45, startFrame + 55], [0, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });

  return (
    <g>
      {/* track do nervo */}
      <path d={pathD} stroke={NERVE_COLOR} strokeWidth={4} fill="none" opacity={0.18} />
      {/* pulso animado */}
      <path
        d={pathD}
        stroke={NERVE_COLOR}
        strokeWidth={5}
        fill="none"
        opacity={sparkOpacity * 0.9}
        strokeDasharray={`${totalLen}`}
        strokeDashoffset={`${dashOffset}`}
        strokeLinecap="round"
      />
      {/* spark head */}
      {progress > 0.05 && progress < 0.98 && (
        <circle
          cx={540 + 5 * Math.sin(progress * 8)}
          cy={1100 - 820 * progress}
          r={8}
          fill={NERVE_COLOR}
          opacity={sparkOpacity * 0.95}
        />
      )}
    </g>
  );
}

// ─── Cérebro (simplificado) ───────────────────────────────────────────────────
function Brain({ activateAt, calmAt }: { activateAt: number; calmAt: number }) {
  const frame = useCurrentFrame();

  const activate = interpolate(frame, [activateAt, activateAt + 18], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const calm = interpolate(frame, [calmAt, calmAt + 25], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });

  const glowIntensity = activate * (1 - calm * 0.85);
  const pulse = 1 + 0.06 * glowIntensity * Math.sin(frame * 0.4);
  const brainColor = `rgba(${Math.round(80 + 170 * glowIntensity)},${Math.round(50 + 20 * (1 - glowIntensity))},${Math.round(10 + 10 * (1 - glowIntensity))},${0.3 + 0.65 * activate})`;

  return (
    <g transform={`translate(540,280) scale(${pulse})`}>
      {/* glow anel */}
      <circle cx={0} cy={0} r={95} fill={brainColor} />
      <circle cx={0} cy={0} r={70} fill={`rgba(${Math.round(200 * glowIntensity)},60,20,${0.18 + 0.55 * glowIntensity})`} />
      {/* hemisférios */}
      <ellipse cx={-22} cy={0} rx={44} ry={52} fill={`rgba(${Math.round(60 + 140 * glowIntensity)},${Math.round(20 + 10 * (1-glowIntensity))},10,0.9)`} />
      <ellipse cx={22}  cy={0} rx={44} ry={52} fill={`rgba(${Math.round(55 + 140 * glowIntensity)},${Math.round(18 + 10 * (1-glowIntensity))},10,0.9)`} />
      <line x1={0} y1={-52} x2={0} y2={52} stroke="rgba(0,0,0,0.35)" strokeWidth={2} />
      {/* sulcos */}
      <path d="M -30 -20 Q 0 -10 30 -20" stroke="rgba(0,0,0,0.3)" strokeWidth={2} fill="none" />
      <path d="M -35 10 Q 0 20 35 10" stroke="rgba(0,0,0,0.3)" strokeWidth={2} fill="none" />
    </g>
  );
}

// ─── Estômago ─────────────────────────────────────────────────────────────────
function Stomach({ exciteAt, calmAt }: { exciteAt: number; calmAt: number }) {
  const frame = useCurrentFrame();
  const excite = interpolate(frame, [exciteAt, exciteAt + 20], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const calm = interpolate(frame, [calmAt, calmAt + 30], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const intensity = excite * (1 - calm * 0.9);

  return (
    <g transform="translate(540,1100)">
      {/* glow aura */}
      <ellipse cx={0} cy={0} rx={180} ry={130} fill={`rgba(${Math.round(245 * intensity)},${Math.round(166 * intensity)},35,${0.08 + 0.25 * intensity})`} />
      {/* corpo do estômago */}
      <path
        d="M -110 -60 C -130 -80, -110 -140, -40 -130 C 10 -125, 60 -145, 110 -100 C 150 -65, 140 0, 100 50 C 60 90, -60 90, -100 50 C -135 10, -130 -20, -110 -60 Z"
        fill={`rgb(${Math.round(90 + 40 * intensity)},${Math.round(38 + 10 * intensity)},${Math.round(45 - 10 * intensity)})`}
        opacity={0.92}
      />
      {/* rugas */}
      <path d="M -60 -80 Q -20 -60 40 -80" stroke="rgba(255,255,255,0.12)" strokeWidth={2} fill="none" />
      <path d="M -40 -30 Q 20 -10 70 -30" stroke="rgba(255,255,255,0.1)" strokeWidth={2} fill="none" />
    </g>
  );
}

// ─── Cápsula verde ────────────────────────────────────────────────────────────
function GreenCapsule({ startFrame }: { startFrame: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const appear = interpolate(frame, [startFrame, startFrame + 10], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const yDrop = interpolate(frame, [startFrame, startFrame + 35], [300, 1000], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
    easing: Easing.in(Easing.quad),
  });
  const rotation = interpolate(frame, [startFrame, startFrame + 35], [-15, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const glowPulse = 1 + 0.15 * Math.sin(frame * 0.5);

  return (
    <g opacity={appear} transform={`translate(540,${yDrop}) rotate(${rotation})`}>
      {/* glow */}
      <ellipse cx={0} cy={0} rx={55 * glowPulse} ry={28 * glowPulse} fill={GREEN_GLOW} opacity={0.18} />
      {/* cápsula body */}
      <rect x={-22} y={-38} width={44} height={76} rx={22} fill="#1a4731" />
      <rect x={-22} y={-38} width={44} height={38} rx={22} fill={GREEN_GLOW} opacity={0.9} />
      {/* brilho */}
      <ellipse cx={-8} cy={-22} rx={6} ry={10} fill="rgba(255,255,255,0.35)" />
    </g>
  );
}

// ─── Composição Principal ─────────────────────────────────────────────────────
export const GrelinaVideo: React.FC = () => {
  const molConfigs = [
    { cx: 500, cy: 1080, r: 32, phase: 0,   awakeAt: t(1.2), shrinkAt: t(5.8) },
    { cx: 580, cy: 1120, r: 26, phase: 2.1, awakeAt: t(1.5), shrinkAt: t(5.9) },
    { cx: 450, cy: 1130, r: 22, phase: 1.1, awakeAt: t(1.8), shrinkAt: t(6.0) },
    { cx: 620, cy: 1070, r: 20, phase: 3.2, awakeAt: t(2.0), shrinkAt: t(6.0) },
    { cx: 530, cy: 1155, r: 24, phase: 0.8, awakeAt: t(2.2), shrinkAt: t(6.1) },
    { cx: 470, cy: 1060, r: 18, phase: 1.8, awakeAt: t(2.4), shrinkAt: t(6.1) },
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: DARK_BLUE }}>
      <Grain opacity={0.045} />

      {/* Background nebula glow */}
      <AbsoluteFill>
        <svg width="1080" height="1920" viewBox="0 0 1080 1920">
          <defs>
            <radialGradient id="nebulaTop" cx="50%" cy="20%" r="40%">
              <stop offset="0%" stopColor="#1a0a2e" stopOpacity="0.6" />
              <stop offset="100%" stopColor={DARK_BLUE} stopOpacity="0" />
            </radialGradient>
            <radialGradient id="nebulaBot" cx="50%" cy="75%" r="40%">
              <stop offset="0%" stopColor="#0d1a08" stopOpacity="0.5" />
              <stop offset="100%" stopColor={DARK_BLUE} stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="1080" height="1920" fill={DARK_BLUE} />
          <rect width="1080" height="1920" fill="url(#nebulaTop)" />
          <rect width="1080" height="1920" fill="url(#nebulaBot)" />
          {/* subtle stars */}
          {[...Array(24)].map((_, i) => (
            <circle
              key={i}
              cx={(i * 137 + 40) % 1060}
              cy={(i * 211 + 60) % 1860}
              r={1 + (i % 2)}
              fill="#fff"
              opacity={0.06 + (i % 4) * 0.03}
            />
          ))}
        </svg>
      </AbsoluteFill>

      {/* Main SVG scene */}
      <AbsoluteFill>
        <svg width="1080" height="1920" viewBox="0 0 1080 1920">

          {/* Estômago */}
          <Stomach exciteAt={t(1.5)} calmAt={t(5.6)} />

          {/* Moléculas de grelina */}
          {molConfigs.map((m, i) => (
            <GrelinaMol key={i} {...m} />
          ))}

          {/* Caminho do nervo */}
          <Sequence from={t(2.8)} durationInFrames={t(3)}>
            <NervePath startFrame={0} />
          </Sequence>

          {/* Cérebro */}
          <Brain activateAt={t(3.8)} calmAt={t(5.8)} />

          {/* Cápsula verde */}
          <Sequence from={t(5.3)}>
            <GreenCapsule startFrame={0} />
          </Sequence>
        </svg>
      </AbsoluteFill>

      {/* Vignette */}
      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <svg width="100%" height="100%">
          <defs>
            <radialGradient id="vig" cx="50%" cy="50%" r="70%">
              <stop offset="0%" stopColor="transparent" />
              <stop offset="100%" stopColor="rgba(0,0,0,0.65)" />
            </radialGradient>
          </defs>
          <rect width="100%" height="100%" fill="url(#vig)" />
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
