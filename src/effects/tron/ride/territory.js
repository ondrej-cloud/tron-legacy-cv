// A coarse map of the floor for CLU's late game: which cells the jetwalls
// run through, which of the others a rider can still get to (a flood fill
// from its nose), and how far each cell is from the nearest wall or the
// boundary. From that: whether the two riders are still on the same open
// floor, and where the roomiest part of a rider's own floor is.
import { ARENA } from './rules.js';

const CELL = 10;          // m

export function createTerritory() {
  const half = ARENA.half;
  const size = Math.ceil((2 * half) / CELL);
  const count = size * size;
  const blocked = new Uint8Array(count);
  const reached = new Int32Array(count);      // the fill's number when a cell was reached
  const clearance = new Int16Array(count);    // cells to the nearest wall or the boundary
  const route = new Int16Array(count);        // cells from the place last routed to (-1: no way)
  const queue = new Int32Array(count);
  let fill = 0;
  const cellOf = (value) => Math.min(size - 1, Math.max(0, Math.floor((value + half) / CELL)));
  const neighbours = new Int32Array(4);

  // the cells beside `index` (up to four), into `neighbours`; returns how many
  function around(index) {
    const x = index % size;
    let count = 0;
    if (x > 0) neighbours[count++] = index - 1;
    if (x < size - 1) neighbours[count++] = index + 1;
    if (index >= size) neighbours[count++] = index - size;
    if (index < size * (size - 1)) neighbours[count++] = index + size;
    return count;
  }

  // Marks the cells the walls run through (`skip` leaves some out, like a
  // rider's own newest wall), then how far every cell is from them.
  function build(segments, skip = null) {
    blocked.fill(0);
    for (const segment of segments) {
      if (skip && skip(segment)) continue;
      // walk the segment in steps shorter than a cell
      const length = Math.hypot(segment.bx - segment.ax, segment.bz - segment.az);
      const steps = Math.max(1, Math.ceil(length / (CELL * 0.5)));
      for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        blocked[cellOf(segment.az + (segment.bz - segment.az) * t) * size
          + cellOf(segment.ax + (segment.bx - segment.ax) * t)] = 1;
      }
    }
    // breadth first from the walls and the cells along the boundary
    let head = 0;
    let tail = 0;
    for (let index = 0; index < count; index++) {
      const x = index % size;
      const z = (index / size) | 0;
      const edge = x === 0 || z === 0 || x === size - 1 || z === size - 1;
      clearance[index] = blocked[index] ? 0 : edge ? 1 : -1;
      if (clearance[index] >= 0) queue[tail++] = index;
    }
    while (head < tail) {
      const index = queue[head++];
      for (let k = around(index) - 1; k >= 0; k--) {
        const next = neighbours[k];
        if (clearance[next] >= 0) continue;
        clearance[next] = clearance[index] + 1;
        queue[tail++] = next;
      }
    }
  }

  // Floods the open cells reachable from (x, z) (its own cell counts as
  // open). Returns the number of cells reached.
  function flood(x, z) {
    fill++;
    const start = cellOf(z) * size + cellOf(x);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    reached[start] = fill;
    while (head < tail) {
      const index = queue[head++];
      for (let k = around(index) - 1; k >= 0; k--) {
        const next = neighbours[k];
        if (blocked[next] || reached[next] === fill) continue;
        reached[next] = fill;
        queue[tail++] = next;
      }
    }
    return tail;
  }

  // The way to (x, z) over the open floor: how many cells from there each
  // open cell is (stepsTo()).
  function routeTo(x, z) {
    route.fill(-1);
    const start = cellOf(z) * size + cellOf(x);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    route[start] = 0;
    while (head < tail) {
      const index = queue[head++];
      for (let k = around(index) - 1; k >= 0; k--) {
        const next = neighbours[k];
        if (blocked[next] || route[next] >= 0) continue;
        route[next] = route[index] + 1;
        queue[tail++] = next;
      }
    }
  }

  return {
    build,
    flood,
    routeTo,
    // after routeTo(): cells from (x, z) to there over the open floor (its
    // own cell or the nearest of the ones around it), Infinity if no way
    stepsTo(x, z) {
      const cx = cellOf(x);
      const cz = cellOf(z);
      let best = Infinity;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= size || nz >= size) continue;
          const steps = route[nz * size + nx];
          if (steps >= 0) best = Math.min(best, steps + (dx || dz ? 1 : 0));
        }
      }
      return best;
    },
    // m from (x, z) to the nearest wall or the boundary, roughly
    roomAt(x, z) {
      return clearance[cellOf(z) * size + cellOf(x)] * CELL;
    },
    cell: CELL,
    // after flood(): can (x, z) be reached? (its cell, or one next to it)
    reaches(x, z) {
      const cx = cellOf(x);
      const cz = cellOf(z);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx >= 0 && nz >= 0 && nx < size && nz < size && reached[nz * size + nx] === fill) return true;
        }
      }
      return false;
    },
    // After flood() from (x, z): the middle of the roomiest part of the
    // floor reached, the nearer of equally roomy places, as { x, z, room }
    // (room: m to the nearest wall or the boundary).
    roomiest(x, z, out = { x: 0, z: 0, room: 0 }) {
      let best = -Infinity;
      for (let index = 0; index < count; index++) {
        if (reached[index] !== fill) continue;
        const cx = (index % size + 0.5) * CELL - half;
        const cz = (((index / size) | 0) + 0.5) * CELL - half;
        const score = clearance[index] * CELL - Math.hypot(cx - x, cz - z) * 0.1;
        if (score > best) {
          best = score;
          out.x = cx;
          out.z = cz;
          out.room = clearance[index] * CELL;
        }
      }
      return out;
    },
  };
}
