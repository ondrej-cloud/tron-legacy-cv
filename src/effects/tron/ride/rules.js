// Tuning for the light cycle duel. World units are roughly metres: x
// across, z along, y up, centred on the origin. The floor is at y = 0 apart
// from the ramps, decks and the bowl in terrain.js.

export const ARENA = {
  half: 160,              // the duel floor is a square 2 * half across
  wallHeight: 5,          // the boundary walls
  tile: 24,               // the floor's tile pattern repeats every this many units
  stadiumScale: 9,        // the race arena model around the floor (models.json)
  fog: 0.0022,            // exponential-squared fog density
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
  gravity: 28,            // m/s² in the air: stronger than Earth's, so jumps feel snappy
  hillPull: 11,           // m/s² of speed lost per unit of slope climbed (gained downhill)
  airborneAbove: 0.15,    // m of air under the wheels before it counts as flying
  maxLift: 13,            // m/s, the fastest the ground can carry it upwards (a steep bank
                          // taken at full speed is a hop, not a launch into the sky)
  hardLanding: 9,         // m/s coming down onto the ground: a hard landing
  height: 1.1,            // the bike's body, for bumping into the other one
};

export const MATCH = {
  winScore: 3,            // first to this many rounds
  demoWinScore: 1,        // a short match in demo mode: one round
  difficulty: 0.55,       // CLU, from 0 (slow to react, short-sighted) to 1 (sharp)
  demoDifficulty: 0.45,   // ... in demo mode
  countdown: 3.2,         // s: 3, 2, 1, then GO
  crashHold: 3.6,         // s after a derezz before the next round (the crash, then its replay)
  finalHold: 5.4,         // s after the deciding derezz: the crash, then a slow kill-cam replay
  demoResultHold: 3.5,    // s the TRON WINS / CLU WINS screen stays in demo mode (otherwise it
                          // waits for open palms (rematch) or END OF LINE)
  resultIdle: 30,         // s with no hands in view on that screen before it goes back to the Grid
  choiceHold: 0.7,        // s both palms have to stay open for a rematch
  hopOn: 0.95,            // s into the baton cycle's rezz when the camera starts to push in
  swoop: 1.15,            // s, the camera pushes in behind the bike, the room fading into the arena
  exit: 1.4,              // s, the arena derezzes back to the camera
  idleAfter: 1.5,         // s without a grip before the cycle cruises on its own
};

// The difficulties to choose from on the result screen (1, 2 or 3 fingers
// held up, or the keys): how sharp CLU rides at each (cluPersona, brain.js).
export const LEVELS = [
  { name: 'EASY', difficulty: 0.2 },
  { name: 'NORMAL', difficulty: MATCH.difficulty },
  { name: 'HARD', difficulty: 0.9 },
];

// Start positions: the player south of the centre facing north (+z), CLU
// north of it facing south, close enough to see each other rezz; the rest
// of the floor is room to manoeuvre.
export const STARTS = [
  { x: -8, z: -45, heading: Math.PI / 2 },
  { x: 8, z: 45, heading: -Math.PI / 2 },
];
