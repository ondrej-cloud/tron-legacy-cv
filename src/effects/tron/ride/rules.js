// Tuning for the light cycle duel. World units are roughly metres: the
// arena floor is the plane y = 0, x across, z along, centred on the origin.

export const ARENA = {
  half: 64,               // the duel floor is a square 2 * half across
  wallHeight: 5,          // the boundary walls
  gridCell: 4,            // floor grid lines every this many units ...
  gridMajor: 5,           // ... and a brighter one every this many cells
  stadiumScale: 3.6,      // the race arena model around the floor (models.json)
  fog: 0.0042,            // exponential-squared fog density
};

export const BIKE = {
  length: 2.8,            // the light cycle's length
  cruise: 30,             // units/s with the handlebars at neutral
  boost: 46,              // full throttle
  brake: 17,              // pulled back
  idle: 24,               // nobody holding on for a while: cruising, a bit slower
  accel: 1.6,             // s, time constant towards the wanted speed
  turnRate: 1.7,          // rad/s at full lock and cruising speed ...
  turnAtBoost: 1.05,      // ... at boost speed ...
  turnAtBrake: 2.3,       // ... and braking
  steerEase: 0.12,        // s, how quickly the bars reach the wanted lock
  maxLean: 0.42,          // rad, the bike leans into a turn
  wallHeight: 1.5,        // the jetwall behind it
  sampleSpacing: 0.6,     // units between stored points of a jetwall
  ownTailGap: 4,          // its own newest wall this close behind doesn't count
  collideRadius: 1.1,     // two bikes this close crash into each other
  paceAfter: 6,           // s into a round before the Grid starts speeding up ...
  paceRate: 0.045,        // ... by this fraction of the speed per second
};

export const MATCH = {
  winScore: 3,            // first to this many rounds
  demoWinScore: 1,        // a short match in demo mode: one round
  countdown: 3.2,         // s: 3, 2, 1, then GO
  crashHold: 2.2,         // s after a derezz before the next round
  resultHold: 3.2,        // s the TRON WINS / CLU WINS screen stays
  swoop: 1.3,             // s, the camera dives in behind the bike
  exit: 1.4,              // s, the arena derezzes back to the camera
  idleAfter: 1.5,         // s without a grip before the cycle cruises on its own
};

// Start positions: the player at the south end facing north (+z), CLU at
// the north end facing south.
export const STARTS = [
  { x: -8, z: -ARENA.half + 18, heading: Math.PI / 2 },
  { x: 8, z: ARENA.half - 18, heading: -Math.PI / 2 },
];
