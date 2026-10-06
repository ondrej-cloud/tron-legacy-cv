// A coarse grid over the floor with the jetwall segments sorted into its
// cells, so that a ray is only tested against the walls in the cells it
// passes through. Late in a round there are thousands of segments and CLU
// casts hundreds of rays each time it thinks; this gives the same answers
// as castRay() (rider.js) for a fraction of the work.
import { ARENA } from './rules.js';
import { castRay } from './rider.js';

const CELL = 16;          // m
const MARGIN = 0.01;      // m: a segment this close to a cell's edge is filed in the next cell too

export function createRayGrid() {
  const half = ARENA.half;
  const size = Math.ceil((2 * half) / CELL);
  const cells = Array.from({ length: size * size }, () => []);
  const filled = [];      // the cells in use, to empty them quickly
  const cellOf = (value) => Math.min(size - 1, Math.max(0, Math.floor((value + half) / CELL)));

  // Sorts `segments` ({ ax, az, bx, bz }) into the cells. They are kept by
  // reference: build again whenever they change.
  function build(segments) {
    for (const index of filled) cells[index].length = 0;
    filled.length = 0;
    for (const segment of segments) {
      const x0 = cellOf(Math.min(segment.ax, segment.bx) - MARGIN);
      const x1 = cellOf(Math.max(segment.ax, segment.bx) + MARGIN);
      const z0 = cellOf(Math.min(segment.az, segment.bz) - MARGIN);
      const z1 = cellOf(Math.max(segment.az, segment.bz) + MARGIN);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) {
          const cell = cells[cz * size + cx];
          if (!cell.length) filled.push(cz * size + cx);
          cell.push(segment);
        }
      }
    }
  }

  // castRay() against the segments last built: the distance from (x, z)
  // along the unit direction (dx, dz) to the first wall or the boundary,
  // up to `reach`. The cells are visited in the ray's order, and it stops
  // once the nearest hit so far comes before the next cell.
  function cast(x, z, dx, dz, reach, skip = null) {
    let nearest = castRay(x, z, dx, dz, NONE, reach);
    if (nearest <= 0) return nearest;
    let cx = cellOf(x);
    let cz = cellOf(z);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const deltaX = Math.abs(dx) > 1e-12 ? CELL / Math.abs(dx) : Infinity;
    const deltaZ = Math.abs(dz) > 1e-12 ? CELL / Math.abs(dz) : Infinity;
    // the ray's distance to the next cell edge across x and across z
    let nextX = deltaX === Infinity ? Infinity : ((cx + (dx > 0 ? 1 : 0)) * CELL - half - x) / dx;
    let nextZ = deltaZ === Infinity ? Infinity : ((cz + (dz > 0 ? 1 : 0)) * CELL - half - z) / dz;
    for (;;) {
      for (const segment of cells[cz * size + cx]) {
        if (skip && skip(segment)) continue;
        // as in castRay()
        const ex = segment.bx - segment.ax;
        const ez = segment.bz - segment.az;
        const denominator = dx * ez - dz * ex;
        if (Math.abs(denominator) < 1e-9) continue;
        const wx = segment.ax - x;
        const wz = segment.az - z;
        const t = (wx * ez - wz * ex) / denominator;
        const u = (wx * dz - wz * dx) / denominator;
        if (t >= 0 && t < nearest && u >= 0 && u <= 1) nearest = t;
      }
      const exit = Math.min(nextX, nextZ);
      if (exit >= nearest) return nearest;
      if (nextX < nextZ) {
        cx += stepX;
        nextX += deltaX;
      } else {
        cz += stepZ;
        nextZ += deltaZ;
      }
      if (cx < 0 || cx >= size || cz < 0 || cz >= size) return nearest;
    }
  }

  return { build, cast };
}

const NONE = [];
