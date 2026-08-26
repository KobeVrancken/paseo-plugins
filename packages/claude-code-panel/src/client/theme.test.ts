import assert from "node:assert/strict";
import test from "node:test";
import { derivePalette, isDarkColor, leading, mix, parseColor } from "./theme.client.ts";

function themeOf(surface0: string, foregroundMuted: string) {
  return {
    colors: {
      surface0,
      foreground: "#fafafa",
      foregroundMuted,
      accent: "#20744A",
      accentForeground: "#ffffff",
      statusDanger: "#c44a4a",
    },
  };
}

/**
 * Distance in 0-255 channel steps, so a ramp can be checked against the shade paseo itself ships.
 * The ramp keeps the hue of surface0, while paseo's zinc shades drift towards blue as they lighten,
 * so the higher surfaces are expected to land near their counterpart rather than on it.
 */
function distance(left: string, right: string): number {
  const a = parseColor(left)!;
  const b = parseColor(right)!;
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

test("parses the color notations a theme can use", () => {
  assert.deepEqual(parseColor("#18181b"), { r: 24, g: 24, b: 27 });
  assert.deepEqual(parseColor("#abc"), { r: 170, g: 187, b: 204 });
  assert.deepEqual(parseColor("rgb(1, 2, 3)"), { r: 1, g: 2, b: 3 });
  assert.equal(parseColor("papayawhip"), null);
});

test("reproduces the surface ramp of paseo's dark theme", () => {
  const palette = derivePalette(themeOf("#18181b", "#a1a1aa"));
  assert.equal(palette.isDark, true);
  assert.ok(distance(palette.surface1, "#1f1f22") <= 8);
  assert.ok(distance(palette.surface2, "#27272a") <= 8);
  assert.ok(distance(palette.surface3, "#3f3f46") <= 8);
  assert.ok(distance(palette.surface4, "#52525b") <= 8);
  assert.ok(distance(palette.border, "#27272a") <= 8);
  assert.ok(distance(palette.borderAccent, "#303036") <= 8);
  assert.ok(distance(palette.foregroundExtraMuted, "#71717a") <= 4);
});

test("reproduces the surface ramp of paseo's light theme", () => {
  const palette = derivePalette(themeOf("#ffffff", "#71717a"));
  assert.equal(palette.isDark, false);
  assert.ok(distance(palette.surface1, "#fafafa") <= 8);
  assert.ok(distance(palette.surface2, "#f4f4f5") <= 8);
  assert.ok(distance(palette.surface3, "#e4e4e7") <= 8);
  assert.ok(distance(palette.border, "#e4e4e7") <= 8);
  assert.ok(distance(palette.foregroundExtraMuted, "#a1a1aa") <= 4);
});

test("falls back to flat surfaces when a color cannot be read", () => {
  const palette = derivePalette(themeOf("var(--surface)", "#71717a"));
  assert.equal(palette.surface3, "var(--surface)");
  assert.equal(palette.border, "#71717a");
});

test("mixes and measures", () => {
  assert.deepEqual(mix({ r: 0, g: 0, b: 0 }, { r: 100, g: 200, b: 40 }, 0.5), { r: 50, g: 100, b: 20 });
  assert.equal(isDarkColor({ r: 24, g: 24, b: 27 }), true);
  assert.equal(isDarkColor({ r: 250, g: 250, b: 250 }), false);
  assert.equal(leading(15), 21);
});
