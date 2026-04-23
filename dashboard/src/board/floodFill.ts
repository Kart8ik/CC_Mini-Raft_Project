function hexToRgb(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  return [
    parseInt(c.substring(0, 2), 16),
    parseInt(c.substring(2, 4), 16),
    parseInt(c.substring(4, 6), 16),
  ];
}

function colorsMatch(
  data: Uint8ClampedArray,
  idx: number,
  r: number,
  g: number,
  b: number,
  tolerance: number,
): boolean {
  return (
    Math.abs(data[idx] - r) <= tolerance &&
    Math.abs(data[idx + 1] - g) <= tolerance &&
    Math.abs(data[idx + 2] - b) <= tolerance
  );
}

/**
 * Scanline flood fill. Reads current canvas pixels, fills connected region
 * from (startX, startY) with `fillHex`. Operates on the raw ImageData so
 * it works correctly during sequential stroke replay.
 */
export function floodFill(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  fillHex: string,
): void {
  const canvas = ctx.canvas;
  const w = canvas.width;
  const h = canvas.height;

  const transform = ctx.getTransform();
  const px = Math.round(startX * transform.a + transform.e);
  const py = Math.round(startY * transform.d + transform.f);

  if (px < 0 || px >= w || py < 0 || py >= h) return;

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const startIdx = (py * w + px) * 4;
  const targetR = data[startIdx];
  const targetG = data[startIdx + 1];
  const targetB = data[startIdx + 2];
  const targetA = data[startIdx + 3];

  const [fillR, fillG, fillB] = hexToRgb(fillHex);

  if (
    Math.abs(targetR - fillR) < 3 &&
    Math.abs(targetG - fillG) < 3 &&
    Math.abs(targetB - fillB) < 3 &&
    targetA > 250
  ) {
    return;
  }

  const tolerance = 20;
  const isTarget = (idx: number) =>
    colorsMatch(data, idx, targetR, targetG, targetB, tolerance) &&
    Math.abs(data[idx + 3] - targetA) <= tolerance;

  const setPixel = (idx: number) => {
    data[idx] = fillR;
    data[idx + 1] = fillG;
    data[idx + 2] = fillB;
    data[idx + 3] = 255;
  };

  const stack: [number, number][] = [[px, py]];

  while (stack.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    let [x, y] = stack.pop()!;
    let idx = (y * w + x) * 4;

    while (y >= 0 && isTarget(idx)) {
      y--;
      idx -= w * 4;
    }
    y++;
    idx += w * 4;

    let reachLeft = false;
    let reachRight = false;

    while (y < h && isTarget(idx)) {
      setPixel(idx);

      if (x > 0) {
        if (isTarget(idx - 4)) {
          if (!reachLeft) {
            stack.push([x - 1, y]);
            reachLeft = true;
          }
        } else {
          reachLeft = false;
        }
      }

      if (x < w - 1) {
        if (isTarget(idx + 4)) {
          if (!reachRight) {
            stack.push([x + 1, y]);
            reachRight = true;
          }
        } else {
          reachRight = false;
        }
      }

      y++;
      idx += w * 4;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}
