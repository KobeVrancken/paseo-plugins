import type { PluginTheme } from "@getpaseo/plugin";

/**
 * Paseo's own design scale, mirrored so the panel measures the same as the Agent window next to it.
 * The host hands plugins six flat colors and no metrics, so both have to be restated here.
 */
export const spacing = { 1: 4, 2: 8, 3: 12, 4: 16, 6: 24, 8: 32 } as const;
export const fontSize = { sm: 12, code: 12, base: 14, content: 15, lg: 16, xl: 18 } as const;
export const radius = { sm: 2, base: 4, md: 6, lg: 8, xl: 12, "2xl": 16, full: 9999 } as const;
export const controlHeight = { tight: 28, compact: 32, field: 44 } as const;
export const iconSize = { xs: 12, sm: 14, md: 16, lg: 20 } as const;

export const MAX_CONTENT_WIDTH = 820;
export const HEADER_HEIGHT = 36;
export const STATUS_DOT_SIZE = 6;

/** Paseo's `shadow.md`, the one every floating surface in its composer uses. */
export function shadowMd(isDark: boolean): {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowRadius: number;
  elevation: number;
} {
  return isDark
    ? { shadowColor: "rgba(0, 0, 0, 0.20)", shadowOffset: { width: 0, height: 4 }, shadowRadius: 8, elevation: 8 }
    : { shadowColor: "rgba(0, 0, 0, 0.04)", shadowOffset: { width: 0, height: 4 }, shadowRadius: 16, elevation: 4 };
}

/** Paseo derives every text line height from its font size this way. */
export function leading(size: number): number {
  return Math.round(size * 1.4);
}

export type Palette = {
  isDark: boolean;
  surface0: string;
  surface1: string;
  surface2: string;
  surface3: string;
  surface4: string;
  border: string;
  borderAccent: string;
  foreground: string;
  foregroundMuted: string;
  foregroundExtraMuted: string;
  accent: string;
  accentForeground: string;
  statusDanger: string;
};

type Rgb = { r: number; g: number; b: number };

/**
 * The surface ramp paseo's own themes are built on, measured off them as a fraction of the way from
 * surface0 to white on a dark theme and to black on a light one.
 */
const DARK_RAMP = { surface1: 0.03, surface2: 0.065, surface3: 0.17, surface4: 0.25, border: 0.065, borderAccent: 0.1 };
const LIGHT_RAMP = { surface1: 0.02, surface2: 0.043, surface3: 0.11, surface4: 0.16, border: 0.11, borderAccent: 0.075 };

export function parseColor(value: string): Rgb | null {
  const text = value.trim();
  const hex = text.startsWith("#") ? text.slice(1) : null;
  if (hex !== null && (hex.length === 3 || hex.length === 6 || hex.length === 8)) {
    const width = hex.length === 3 ? 1 : 2;
    const channel = (index: number) => {
      const part = hex.slice(index * width, index * width + width);
      const parsed = Number.parseInt(width === 1 ? part + part : part, 16);
      return Number.isNaN(parsed) ? null : parsed;
    };
    const r = channel(0);
    const g = channel(1);
    const b = channel(2);
    return r === null || g === null || b === null ? null : { r, g, b };
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (rgb) {
    const parts = rgb[1]!.split(/[\s,/]+/).filter((part) => part !== "");
    const [r, g, b] = parts.map((part) => Number.parseFloat(part));
    if ([r, g, b].some((part) => part === undefined || Number.isNaN(part))) return null;
    return { r: r!, g: g!, b: b! };
  }
  return null;
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return {
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
  };
}

export function isDarkColor({ r, g, b }: Rgb): boolean {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

/** A translucent version of a color, for tints that have to sit over content rather than replace it. */
export function alpha(value: string, amount: number): string {
  const rgb = parseColor(value);
  if (rgb === null) return value;
  return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${amount})`;
}

/**
 * Expands the six exposed tokens into the ramp paseo's components are written against, so a plugin
 * theme and a built-in theme land on the same shades instead of on stacked translucent overlays.
 */
export function derivePalette(theme: PluginTheme): Palette {
  const colors = theme.colors;
  const base = parseColor(colors.surface0);
  const muted = parseColor(colors.foregroundMuted);

  if (base === null) {
    return {
      isDark: true,
      surface0: colors.surface0,
      surface1: colors.surface0,
      surface2: colors.surface0,
      surface3: colors.surface0,
      surface4: colors.surface0,
      border: colors.foregroundMuted,
      borderAccent: colors.foregroundMuted,
      foreground: colors.foreground,
      foregroundMuted: colors.foregroundMuted,
      foregroundExtraMuted: colors.foregroundMuted,
      accent: colors.accent,
      accentForeground: colors.accentForeground,
      statusDanger: colors.statusDanger,
    };
  }

  const isDark = isDarkColor(base);
  const ramp = isDark ? DARK_RAMP : LIGHT_RAMP;
  const target: Rgb = isDark ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  const lift = (amount: number) => toHex(mix(base, target, amount));

  return {
    isDark,
    surface0: colors.surface0,
    surface1: lift(ramp.surface1),
    surface2: lift(ramp.surface2),
    surface3: lift(ramp.surface3),
    surface4: lift(ramp.surface4),
    border: lift(ramp.border),
    borderAccent: lift(ramp.borderAccent),
    foreground: colors.foreground,
    foregroundMuted: colors.foregroundMuted,
    foregroundExtraMuted: muted === null ? colors.foregroundMuted : toHex(mix(muted, base, 0.35)),
    accent: colors.accent,
    accentForeground: colors.accentForeground,
    statusDanger: colors.statusDanger,
  };
}
