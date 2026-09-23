// Runs MediaPipe's hand landmarker off the main thread. Loading the model and
// warming up its GPU shaders blocks for over half a second, and every
// detection costs a few milliseconds; here that happens without freezing the
// page's animations. hands.js sends one camera frame at a time as an
// ImageBitmap and gets the landmarks back.

// MediaPipe loads its WASM glue with importScripts(), which module workers
// don't support, so provide a synchronous stand-in that runs the script in
// the global scope.
self.importScripts = (...urls) => {
  for (const url of urls) {
    const request = new XMLHttpRequest();
    request.open('GET', url, false);
    request.send();
    if (request.status !== 200) throw new Error(`could not load ${url}`);
    (0, eval)(request.responseText);
  }
};

let landmarker = null;

async function init({ visionUrl, wasmUrl, modelUrl }) {
  const { HandLandmarker, FilesetResolver } = await import(visionUrl);
  const fileset = await FilesetResolver.forVisionTasks(wasmUrl);
  const options = {
    baseOptions: { modelAssetPath: modelUrl, delegate: 'GPU' },
    numHands: 2,
    runningMode: 'VIDEO',
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };
  try {
    landmarker = await HandLandmarker.createFromOptions(fileset, options);
  } catch (gpuError) {
    console.warn('GPU delegate failed in the worker, retrying on CPU', gpuError);
    options.baseOptions.delegate = 'CPU';
    landmarker = await HandLandmarker.createFromOptions(fileset, options);
  }
  return options.baseOptions.delegate;
}

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      const delegate = await init(data);
      self.postMessage({ type: 'ready', delegate });
    } catch (error) {
      self.postMessage({ type: 'error', message: String(error?.message ?? error) });
    }
  } else if (data.type === 'frame') {
    try {
      const result = landmarker.detectForVideo(data.frame, data.timestamp);
      self.postMessage({
        type: 'result',
        landmarks: result.landmarks ?? [],
        handedness: result.handedness ?? result.handednesses ?? [],
      });
    } catch (error) {
      self.postMessage({ type: 'frameError', message: String(error?.message ?? error) });
    } finally {
      data.frame.close();
    }
  }
};
