// A path is a polyline in plotter units: the first point is a move, the rest
// are drawn. Pen-up movement starts a new path rather than extending one.
type Point = { x: number; y: number };
type Path = Point[];
type Paths = Path[];
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

const CANVAS_PADDING = 20;
const DEFAULT_CANVAS_WIDTH = 400;
const MIN_CANVAS_WIDTH = 240;
const MIN_CANVAS_HEIGHT = 200;
// A preview taller than this share of the viewport would need scrolling.
const MAX_CANVAS_HEIGHT_RATIO = 0.6;

export class HPGLViewer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private paths: Paths;
  private color: string = "#222222"; // Stroke colour for plotted paths

  // Canvas size in CSS pixels. The backing store is this multiplied by the
  // device pixel ratio, so all drawing below works in CSS pixels.
  private viewWidth: number = DEFAULT_CANVAS_WIDTH;
  private viewHeight: number = MIN_CANVAS_HEIGHT;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;

    this.paths = [];
  }

  public loadHPGL(file: string): void {
    this.paths = this.parseHPGL(file);

    const points = this.paths.reduce((total, path) => total + path.length, 0);
    console.log(`HPGL: parsed ${this.paths.length} paths, ${points} points`);

    this.drawOnCanvas();
  }

  // Parse the numeric arguments of a single command. Returns an empty list for
  // argument-less commands (a bare "PU;") and for anything that does not parse
  // cleanly, so callers never have to deal with NaN or a missing pair member.
  private parseArgs(raw: string): number[] {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    const args: number[] = [];
    for (const part of trimmed.split(",")) {
      const value = Number(part.trim());
      if (!Number.isFinite(value)) return [];
      args.push(value);
    }
    return args;
  }

  private parseHPGL(hpgl: string): Paths {
    const commands = hpgl
      .split(/;|\n/)
      .map((cmd) => cmd.trim())
      .filter(Boolean);

    const paths: Paths = [];
    const unsupported = new Set<string>();

    let currentPath: Path | null = null;
    let penDown = false;
    let isAbsolute = true;
    let currX = 0;
    let currY = 0;

    // Move the pen to (x, y). With the pen down this extends the current path,
    // starting a new one from the pen's previous position when needed. With the
    // pen up it only relocates, which ends the current path.
    const moveTo = (x: number, y: number) => {
      if (penDown) {
        let path = currentPath;
        if (!path) {
          path = [{ x: currX, y: currY }];
          paths.push(path);
          currentPath = path;
        }
        path.push({ x, y });
      } else {
        currentPath = null;
      }
      currX = x;
      currY = y;
    };

    // PA, PR, PU and PD may all carry coordinate pairs. A trailing unpaired
    // value is not a position, so it is ignored.
    const applyCoordinates = (args: number[]) => {
      for (let i = 0; i + 1 < args.length; i += 2) {
        const x = isAbsolute ? args[i] : currX + args[i];
        const y = isAbsolute ? args[i + 1] : currY + args[i + 1];
        moveTo(x, y);
      }
    };

    for (const cmd of commands) {
      const code = cmd.slice(0, 2).toUpperCase();
      const args = this.parseArgs(cmd.slice(2));

      switch (code) {
        case "IN":
        case "DF":
          // Initialise / set defaults: absolute mode, pen up.
          isAbsolute = true;
          penDown = false;
          currentPath = null;
          break;
        case "PA":
          isAbsolute = true;
          applyCoordinates(args);
          break;
        case "PR":
          isAbsolute = false;
          applyCoordinates(args);
          break;
        case "PU":
          penDown = false;
          currentPath = null;
          applyCoordinates(args);
          break;
        case "PD":
          penDown = true;
          currentPath = null;
          applyCoordinates(args);
          break;
        case "SP":
          // Select pen: a pen change always breaks the current path.
          currentPath = null;
          break;
        default:
          unsupported.add(code);
      }
    }

    if (unsupported.size > 0) {
      console.warn(
        "HPGL: ignored unsupported commands:",
        [...unsupported].join(", ")
      );
    }

    return paths;
  }

  private getBounds(): Bounds | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const path of this.paths) {
      for (const pt of path) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }
    }

    if (minX === Infinity) return null;
    return { minX, minY, maxX, maxY };
  }

  // Fit the canvas to its container, giving it a height that matches the
  // drawing's own aspect ratio so the result is not letterboxed. Called before
  // every draw, so a resized window or a differently shaped drawing is picked
  // up on the next preview.
  private resizeCanvas(bounds: Bounds | null): void {
    let cssWidth = DEFAULT_CANVAS_WIDTH;

    // clientWidth includes the container's padding, which is not usable space.
    const container = this.canvas.parentElement;
    if (container) {
      const style = window.getComputedStyle(container);
      const padding =
        parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const available = container.clientWidth - padding;
      // Zero when the modal is still hidden; fall back to the default width.
      if (available > 0) cssWidth = available;
    }
    cssWidth = Math.max(cssWidth, MIN_CANVAS_WIDTH);

    const maxHeight = Math.max(
      window.innerHeight * MAX_CANVAS_HEIGHT_RATIO,
      MIN_CANVAS_HEIGHT
    );

    let cssHeight = maxHeight;
    if (bounds) {
      const dx = bounds.maxX - bounds.minX;
      const dy = bounds.maxY - bounds.minY;
      if (dx > 0 && dy > 0) {
        cssHeight = (cssWidth - 2 * CANVAS_PADDING) * (dy / dx) + 2 * CANVAS_PADDING;
      }
    }
    cssHeight = Math.min(Math.max(cssHeight, MIN_CANVAS_HEIGHT), maxHeight);

    this.viewWidth = Math.round(cssWidth);
    this.viewHeight = Math.round(cssHeight);

    // Draw at device resolution, then scale back down with CSS, so the preview
    // is not blurry on a HiDPI screen.
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.viewWidth * dpr);
    this.canvas.height = Math.round(this.viewHeight * dpr);
    this.canvas.style.display = "block";
    this.canvas.style.width = `${this.viewWidth}px`;
    this.canvas.style.height = `${this.viewHeight}px`;

    // Assigning width/height above resets the context, so apply the transform
    // that lets everything below work in CSS pixels afterwards.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private drawOnCanvas(): void {
    const bounds = this.getBounds();

    // Size first: changing the canvas dimensions clears it and resets the
    // context, so anything drawn beforehand would be discarded.
    this.resizeCanvas(bounds);

    const ctx = this.ctx;
    const width = this.viewWidth;
    const height = this.viewHeight;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, width, height);

    if (!bounds) {
      console.warn("HPGL: nothing to draw, the file contained no plotted paths");
      return;
    }

    const { minX, minY, maxX, maxY } = bounds;
    const dx = maxX - minX;
    const dy = maxY - minY;

    // Plotter units per pixel: the larger ratio wins so the whole drawing fits.
    // Falls back to 1 for a drawing with no extent, which would divide by zero.
    const usableWidth = Math.max(width - 2 * CANVAS_PADDING, 1);
    const usableHeight = Math.max(height - 2 * CANVAS_PADDING, 1);
    const scale = Math.max(dx / usableWidth, dy / usableHeight) || 1;

    // Centre the drawing on the canvas.
    const offsetX = (width - dx / scale) / 2;
    const offsetY = (height - dy / scale) / 2;

    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    for (const path of this.paths) {
      path.forEach((pt, index) => {
        const x = offsetX + (pt.x - minX) / scale;
        // Flip Y: HPGL's origin is bottom left, the canvas' is top left.
        const y = height - offsetY - (pt.y - minY) / scale;

        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
    }
    ctx.stroke();
  }
}
