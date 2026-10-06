// The ride's sounds: countdown beeps, the GO, an engine hum that follows
// the speed, a derezz crash (deeper and longer when a replay plays it in
// slow motion), a rush of air for a jump, a ping when CLU comes close, a
// chord for the winner and a rising tone for a rematch. They are made in
// src/sfx.js, on the app's one audio graph, so the mute (N) and the
// limiter cover them like everything else; until the page has had a click
// or a key (the browser's rule for audio) they are silently skipped.
//
// sfx: the host's sound effects (host.sfx, music.js)
export function createRideSound(sfx) {
  let engineOn = false;
  return {
    tick: (count) => sfx?.rideTick(count),
    crash: (speed = 1) => sfx?.rideCrash(speed),
    jump: () => sfx?.rideJump(),
    warn: () => sfx?.rideWarn(),
    rematch: () => sfx?.rideRematch(),
    win: (playerWon) => sfx?.rideWin(playerWon),
    // every frame while riding (speed in m/s), 0 to stop
    engine(speed) {
      // stopping only needs saying once
      if (speed <= 0 && !engineOn) return;
      engineOn = speed > 0;
      sfx?.rideEngine(speed);
    },
  };
}
