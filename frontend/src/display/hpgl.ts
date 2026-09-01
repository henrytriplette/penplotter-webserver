declare type Paths = Array<Array<{ x: number; y: number; draw: boolean }>>;

export class HPGLViewer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  private paths: Paths;
  private color: string = "white"; // Default color for paths

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;

    this.paths = [];
    this.color = "white"; // Default color for paths

    this.canvas.height = window.innerHeight - 55;
    this.canvas.width = window.innerWidth / 3 - 55;
  }

  public loadHPGL(file: string): void {
    this.paths = this.parseHPGL(file);
    console.log("Parsed HPGL paths:", this.paths);

    this.drawOnCanvas(this.paths, this.ctx);
  }

  private parseHPGL(hpgl: string) {
    const commands = hpgl
      .split(/;|\n/)
      .map((cmd) => cmd.trim())
      .filter(Boolean);
    const paths = [];
    let currentPath = [];
    let penDown = false;
    let isAbsolute = true;
    let currX = 0,
      currY = 0;

    for (let cmd of commands) {
      const code = cmd.slice(0, 2);
      const args = cmd.slice(2).split(",").map(Number);

      switch (code) {
        case 'IN':
          // paths.length = 0;
          // currentPath = [];
          break;
        case "PA":
          isAbsolute = true;
          break;
        case "PR":
          isAbsolute = false;
          break;
        case "PU":
        case "PD":
          penDown = code === "PD";
          for (let i = 0; i < args.length; i += 2) {
            let x = args[i];
            let y = args[i + 1];
            if (!isAbsolute) {
              x += currX;
              y += currY;
            }
            currentPath.push({ x, y, draw: penDown });
            currX = x;
            currY = y;
          }
          break;
        case "SP":
          // Select Pen — typically ignored
          break;
        default:
          console.warn("Unknown command:", code);
      }
    }

    if (currentPath.length > 0) {
      paths.push(currentPath);
    }
    return paths;
  }

  private drawOnCanvas(
    paths: Paths,
    ctx: CanvasRenderingContext2D,
    scale = 0.05
  ) {
    let minX = this.paths[0][0].x;
    let minY = this.paths[0][0].y;
    let maxX = minX;
    let maxY = minY;

    for (let q = 1; q < this.paths.length; q++) {
      for (let i = 1; i < this.paths[q].length; i++) {
        if (this.paths[q][i].x < minX) {
          minX = this.paths[q][i].x;
        } else if (this.paths[q][i].x > maxX) {
          maxX = this.paths[q][i].x;
        }

        if (this.paths[q][i].y < minY) {
          minY = this.paths[q][i].y;
        } else if (this.paths[q][i].y > maxY) {
          maxY = this.paths[q][i].y;
        }
      }
    }

    // Calculate padding
    const dx = maxX - minX;
    const dy = maxY - minY;

    const sx = dx / (this.canvas.width - 100);
    const sy = dy / (this.canvas.height - 100);

    if (sx > sy) {
      scale = sx;
    } else {
      scale = sy;
    }

    // Clear the canvas before drawing
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.beginPath();
    for (let path of paths) {
      let penUp = true;
      for (let pt of path) {
        const x = pt.x * scale;
        const y = pt.y * scale;
        if (pt.draw) {
          ctx.lineTo(x, y);
        } else {
          ctx.moveTo(x, y);
        }
      }
    }
    ctx.stroke();
  }
}
