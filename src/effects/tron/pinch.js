// Pinch (thumb and index touching, the other fingers folded): pick up the
// light wall next to the pinch and drag the whole wall along while the pinch
// holds, or snatch a thrown disc out of the air into that hand.
//
// The OK sign is the same pinch with the other three fingers up, and it
// summons a disc instead. classify() in gestures.js tells the two apart; on
// top of that a pinch has to hold for a moment before it grabs (the hand
// passes through a pinch on its way into an OK), a held wall is let go the
// moment the hand turns into an OK, and a hand with a disc in it never grabs.
export const PINCH = {
  holdMs: 80,           // after the tracker's own debounce, before a pinch grabs
  pickUpMs: 450,        // a wall is picked up only in the first moments of a pinch ...
  wallReach: 0.5,       // ... within this many palm lengths of it
  discReach: 0.6,       // palm lengths from the pinch (past the disc's rim) that catch a disc
  graceMs: 120,         // a held wall survives a pinch dropping out for this long
};

// `log(name)` records an action for the stats.
export function createPinch({ view, walls, discs, flashes, teams, log }) {
  // per hand: the wall being dragged { trail, along, x, y, lastPinchMs }
  const holds = { left: null, right: null };
  const counts = { grabs: 0, catches: 0 };

  // the pinch point (between thumb and index tips) in view units
  const pinchPoint = (hand) => ({ x: (hand.x - 0.5) * view.aspect, y: 0.5 - hand.y });

  function drop(id, time) {
    const hold = holds[id];
    if (!hold) return;
    holds[id] = null;
    walls.grab(hold.trail, false);
    // a flash runs along the wall from where it was held
    walls.pulse(hold.trail, hold.along, time);
    log(`drop ${id[0].toUpperCase()}`);
  }

  // hand: from hands.js; holdsDisc: that hand has a disc in it. Returns the
  // disc a pinch snatched, if any.
  function update(hand, nowMs, time, dt, { holdsDisc = false } = {}) {
    const id = hand.id;
    const pinching = hand.visible && hand.gesture === 'pinch' && nowMs - hand.gestureSince >= PINCH.holdMs;
    const hold = holds[id];
    if (hold) {
      if (pinching) hold.lastPinchMs = nowMs;
      // an OK means a disc is wanted: let go at once
      const released = !hand.visible || hand.gesture === 'ok' || nowMs - hold.lastPinchMs > PINCH.graceMs;
      if (released) {
        drop(id, time);
        return null;
      }
      if (!pinching) return null;
      const point = pinchPoint(hand);
      walls.move(hold.trail, point.x - hold.x, point.y - hold.y, dt);
      hold.x = point.x;
      hold.y = point.y;
      return null;
    }
    if (!pinching || holdsDisc) return null;
    const point = pinchPoint(hand);
    const disc = discs.snatch(id, point, PINCH.discReach * hand.size);
    if (disc) {
      counts.catches++;
      log(`snatch ${id[0].toUpperCase()}`);
      return disc;
    }
    if (nowMs - hand.gestureSince > PINCH.holdMs + PINCH.pickUpMs) return null;
    const other = holds[id === 'left' ? 'right' : 'left'];
    const found = walls.nearest(point, PINCH.wallReach * hand.size, time);
    if (!found || found.trail === other?.trail) return null;
    holds[id] = { trail: found.trail, along: found.along, x: point.x, y: point.y, lastPinchMs: nowMs };
    walls.grab(found.trail, true, time);
    counts.grabs++;
    log(`grab wall ${id[0].toUpperCase()}`);
    flashes.spawn({ x: point.x, y: point.y, size: 0.07, duration: 0.35, color: teams[id].color, glint: 0.8 });
    return null;
  }

  return {
    counts,
    update,
    drop,
    // is this hand dragging a wall?
    holding(id) {
      return Boolean(holds[id]);
    },
    // a fresh Grid, or the Grid going down: let go of everything
    clear() {
      for (const id of ['left', 'right']) {
        if (holds[id]) walls.grab(holds[id].trail, false);
        holds[id] = null;
      }
    },
  };
}
