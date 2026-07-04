// Effects the app can run. The first one starts by default; ?effect=<id> picks another.
// Each module exports `meta` and `createEffect` (see src/main.js for the contract).
export const EFFECTS = [
  { id: 'tron', title: 'Tron', load: () => import('./tron/index.js') },
];
