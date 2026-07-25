// Team colours, one team per hand. Everything a hand creates (its light
// walls, its disc, its light cycles, its HUD accent) takes that hand's
// colour; the rock gesture switches the hand between TRON and CLU.
import * as THREE from 'three';

export const TEAMS = [
  { name: 'TRON', color: '#19d4ff' },
  { name: 'CLU', color: '#ff8a1f' },
];

// How quickly a hand's colour slides over to its new team (seconds).
const COLOR_EASE = 0.18;

// Returns { left, right, colors }: a team per screen-side hand slot, and the
// fixed team colours (indexed by team) for shaders that store a team index.
export function createTeams() {
  const colors = TEAMS.map((team) => new THREE.Color(team.color));
  const createTeam = () => {
    const srgb = { r: 0, g: 0, b: 0 };
    return {
      index: 0,
      color: colors[0].clone(),   // eases towards the active team's colour
      changedAt: -Infinity,       // seconds
      get name() {
        return TEAMS[this.index].name;
      },
      toggle(now) {
        this.index = 1 - this.index;
        this.changedAt = now;
      },
      update(dt) {
        this.color.lerp(colors[this.index], 1 - Math.exp(-dt / COLOR_EASE));
      },
      // "r, g, b" of the current colour for canvas styles
      cssRgb() {
        this.color.getRGB(srgb, THREE.SRGBColorSpace);
        return `${Math.round(srgb.r * 255)}, ${Math.round(srgb.g * 255)}, ${Math.round(srgb.b * 255)}`;
      },
    };
  };
  return { left: createTeam(), right: createTeam(), colors };
}
