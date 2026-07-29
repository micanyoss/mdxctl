import logUpdate from "log-update";
import pc from "picocolors";

/**
 * Full-width purple gradient "boot screen" shown while the dev server starts.
 * Renders in place via log-update; replaced by the status card on ready.
 * Degrades to plain status lines on non-TTY output.
 */

// orange-950 → orange-900 → orange-600 → orange-400 → orange-300
const STOPS: [number, number, number][] = [
  [67, 20, 7],
  [124, 45, 18],
  [234, 88, 12],
  [251, 146, 60],
  [253, 186, 116],
];

const BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BOOT_TEXT = "mdxctl";
const FRAME_MS = 80;

function colorAt(t: number): [number, number, number] {
  const n = STOPS.length - 1;
  const pos = Math.min(Math.max(t, 0), 1) * n;
  const i = Math.min(Math.floor(pos), n - 1);
  const f = pos - i;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

const bg = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;
const RESET = "\x1b[0m";
const TEXT_FG = "\x1b[1m\x1b[38;2;255;255;255m";
const TEXT_FG_RESET = "\x1b[22m\x1b[39m";
const AMBER = (s: string) => `\x1b[38;2;253;186;116m${s}\x1b[39m`;

export class BootScreen {
  #timer: NodeJS.Timeout | undefined;
  #milestone = "Starting dev server";
  #startedAt = Date.now();
  #lastPrintedMilestone = "";
  readonly #isTTY = process.stdout.isTTY === true;

  start(): void {
    if (!this.#isTTY) return;
    logUpdate(""); // reserve the region
    this.#timer = setInterval(() => this.#render(), FRAME_MS);
  }

  setMilestone(text: string): void {
    this.#milestone = text;
    if (!this.#isTTY && text !== this.#lastPrintedMilestone) {
      this.#lastPrintedMilestone = text;
      console.log(pc.dim(`  · ${text}…`));
    }
  }

  /** Stops the animation and clears the boot screen from the terminal. */
  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    if (this.#isTTY) {
      logUpdate.clear();
    }
  }

  get running(): boolean {
    return this.#timer !== undefined;
  }

  #render(): void {
    const now = Date.now();
    const t = (now - this.#startedAt) / 1000;
    const width = Math.max(20, process.stdout.columns ?? 80);

    const band = [0, 1, 2].map((row) => this.#renderBandRow(row, width, t));
    const glyph = BRAILLE[Math.floor(t * 1000 / 80) % BRAILLE.length];
    const elapsed = Math.floor(t);
    const milestoneLine =
      "  " +
      AMBER(glyph) +
      " " +
      AMBER(this.#milestone + "…") +
      pc.dim(`  ${elapsed}s`);

    logUpdate("\n" + band.join("\n") + "\n\n" + milestoneLine);
  }

  #renderBandRow(row: number, width: number, t: number): string {
    // highlight sweeping left → right, faded out near both edges so cells
    // don't pop when the sweep enters/leaves (that pop read as flicker)
    const shineX = ((t * 42) % (width + 40)) - 20;
    const edgeFade = (x: number) =>
      Math.max(0, Math.min(1, x / 24, (width - 1 - x) / 24));
    const textStart = Math.floor((width - BOOT_TEXT.length) / 2);
    const showText = row === 1 && width >= BOOT_TEXT.length + 4;

    let line = "";
    let inText = false;
    for (let x = 0; x < width; x++) {
      // gentle breathing wave, offset per row
      const wave = 0.08 * Math.sin(t * 0.9 + x / 9 + row * 1.7);
      let [r, g, b] = colorAt(x / width + wave);
      // soft gaussian shine bump toward #ffedd5
      const d = (x - shineX) / 9;
      const boost = Math.exp(-d * d) * 0.55 * edgeFade(x);
      r = Math.round(r + (255 - r) * boost);
      g = Math.round(g + (237 - g) * boost);
      b = Math.round(b + (213 - b) * boost);

      line += bg(r, g, b);
      if (showText && x >= textStart && x < textStart + BOOT_TEXT.length) {
        const ch = BOOT_TEXT[x - textStart];
        if (!inText) {
          line += TEXT_FG;
          inText = true;
        }
        line += ch;
        if (x === textStart + BOOT_TEXT.length - 1) {
          line += TEXT_FG_RESET;
          inText = false;
        }
      } else {
        line += " ";
      }
    }
    return line + RESET;
  }
}
