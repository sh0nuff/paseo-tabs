// The panel's status colours, drawn rather than emoji so they show on every
// machine. Each palette has a dark and a light variant, picked to match the
// Paseo theme's surface colour.

export type Status = "overdue" | "waiting" | "next" | "done";
export type PaletteName = "default" | "catppuccin" | "gruvbox" | "nord";
type Colours = Record<Status, string>;

const PALETTES: Record<PaletteName, { dark: Colours; light: Colours }> = {
  default: {
    dark: { overdue: "#EF4444", waiting: "#F97316", next: "#3B82F6", done: "#22C55E" },
    light: { overdue: "#DC2626", waiting: "#EA580C", next: "#2563EB", done: "#16A34A" },
  },
  // Mocha and Latte.
  catppuccin: {
    dark: { overdue: "#f38ba8", waiting: "#fab387", next: "#89b4fa", done: "#a6e3a1" },
    light: { overdue: "#d20f39", waiting: "#fe640b", next: "#1e66f5", done: "#40a02b" },
  },
  gruvbox: {
    dark: { overdue: "#fb4934", waiting: "#fe8019", next: "#83a598", done: "#b8bb26" },
    light: { overdue: "#9d0006", waiting: "#af3a03", next: "#076678", done: "#79740e" },
  },
  // Aurora for the warm colours, Frost for blue.
  nord: {
    dark: { overdue: "#bf616a", waiting: "#d08770", next: "#81a1c1", done: "#a3be8c" },
    light: { overdue: "#bf616a", waiting: "#d08770", next: "#5e81ac", done: "#a3be8c" },
  },
};

export const PALETTE_OPTIONS: { label: string; value: PaletteName }[] = [
  { label: "Standard", value: "default" },
  { label: "Catppuccin", value: "catppuccin" },
  { label: "Gruvbox", value: "gruvbox" },
  { label: "Nord", value: "nord" },
];

function channels(colour: string): [number, number, number] | null {
  const hex = colour.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = colour.trim().match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

/** True for a light colour. Anything unreadable counts as dark. */
export function isLight(colour: string): boolean {
  const rgb = channels(colour);
  if (!rgb) return false;
  const [r, g, b] = rgb.map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5;
}

export function statusColours(palette: string, surface: string): Colours {
  const chosen = PALETTES[palette as PaletteName] ?? PALETTES.default;
  return isLight(surface) ? chosen.light : chosen.dark;
}
