// The intro's words: the camera gate's screens, the system log and the enter
// prompt, worded from the hand tracker's real state.

// Each gate screen: [action, label] for its buttons, null for none.
export const GATE = {
  ask: {
    label: 'Camera access',
    heading: 'Your hands are the controller',
    text: 'Tron Legacy CV follows your hands through the webcam. Hand tracking runs locally in '
      + 'your browser. No video is uploaded or stored.',
    note: '',
    primary: ['camera', 'Enable camera'],
    secondary: ['demo', 'Watch the demo without a camera'],
  },
  waiting: {
    label: 'Camera access',
    heading: 'Your hands are the controller',
    text: 'Waiting for camera permission…',
    note: 'Answer your browser’s prompt to continue.',
    primary: ['camera', 'Enable camera'],
    secondary: ['demo', 'Watch the demo without a camera'],
  },
  starting: {
    label: 'Camera online',
    heading: 'Starting hand tracking',
    text: 'Loading the hand tracking model. The first visit can take a few seconds.',
    note: '',
    primary: null,
    secondary: null,
  },
  denied: {
    label: 'Camera unavailable',
    heading: 'The Grid can still run',
    text: 'The camera was blocked or isn’t available. To play with your hands, allow the camera '
      + 'for this site (usually from the icon in the address bar), then try again.',
    note: '',
    primary: ['demo', 'Watch the demo'],
    secondary: ['retry', 'Try again'],
  },
  blocked: {
    label: 'Camera unavailable',
    heading: 'Still no camera',
    text: 'The camera is still blocked. Change the camera permission for this site, then try again.',
    note: '',
    primary: ['demo', 'Watch the demo'],
    secondary: ['retry', 'Try again'],
  },
  unsupported: {
    label: 'Camera unavailable',
    heading: 'The Grid can still run',
    text: 'This browser can’t open a camera on this page (it needs a secure https address).',
    note: '',
    primary: ['demo', 'Watch the demo'],
    secondary: null,
  },
};

const GESTURE_LABELS = {
  open: 'open', fist: 'fist', point: 'point', peace: 'peace', rock: 'rock', ok: 'ok',
  pinch: 'pinch', thumbsUp: 'thumbs up', three: 'three', other: '', none: '',
};

// The label under a tracked hand. An open hand says which side it shows,
// since only palms count for entering.
export function gestureLabel(hand) {
  if (hand.gesture === 'open') return hand.palmFacing ? 'open palm' : 'back of hand';
  return GESTURE_LABELS[hand.gesture] ?? hand.gesture;
}

// System log rows: [label, value, tone], tone = ok | warn | pending | idle.
export function systemState(hands) {
  const status = hands.status;
  const camera = hands.hasCamera ? ['online', 'ok']
    : status === 'requesting camera' ? ['requesting access', 'pending']
      : /no camera/.test(status) ? ['not found', 'warn'] : ['off', 'idle'];
  let tracker;
  if (hands.mode === 'camera') {
    tracker = status === 'ready' ? ['online', 'ok']
      : status === 'loading hand tracker' ? ['loading model', 'pending'] : ['standby', 'pending'];
  } else if (/tracker failed/.test(status)) {
    tracker = ['failed', 'warn'];
  } else {
    tracker = ['not in use', 'idle'];
  }
  const input = {
    camera: ['hand tracking', 'ok'], mouse: ['mouse', 'warn'], demo: ['scripted demo', 'ok'],
  }[hands.mode] ?? [hands.mode, 'idle'];
  let inView;
  if (hands.mode === 'mouse') {
    inView = ['pointer', 'idle'];
  } else if (hands.mode === 'demo' || status === 'ready') {
    const count = hands.list.length;
    inView = [count ? `${count} in view` : 'none in view', count ? 'ok' : 'idle'];
  } else {
    inView = ['waiting', 'pending'];
  }
  return {
    camera: ['Camera', ...camera],
    tracker: ['Hand tracker', ...tracker],
    input: ['Input', ...input],
    hands: ['Hands', ...inView],
  };
}

// The line next to the palms ring, and a hint under it.
export function promptState(hands, palmCount) {
  if (hands.mode === 'mouse') {
    const prompt = /tracker failed/.test(hands.status) ? 'Hand tracking couldn’t start. The mouse works instead.'
      : /no camera/.test(hands.status) ? 'No camera here. The mouse works instead.'
        : 'Mouse mode. The pointer stands in for a hand.';
    return { prompt, hint: 'Move to aim, hold the button to pinch', tone: 'idle' };
  }
  const prompt = 'Show both open palms to enter the Grid';
  if (hands.mode === 'camera' && hands.status !== 'ready') {
    return { prompt, hint: 'Loading the hand tracker…', tone: 'idle' };
  }
  if (palmCount === 2) return { prompt, hint: 'Hold them there…', tone: 'ok' };
  if (palmCount === 1) return { prompt, hint: 'One palm found. Now the other one.', tone: 'ok' };
  return {
    prompt,
    hint: hands.mode === 'demo' ? 'Demo mode: the hands are scripted' : 'Hands up, palms towards the camera',
    tone: 'idle',
  };
}
