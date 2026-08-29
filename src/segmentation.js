// Person segmentation on the webcam: MediaPipe's selfie segmenter, from the
// same tasks-vision bundle the hand tracker uses.
//
//   const segmenter = createSegmenter(hands.video);
//   segmenter.load();             // starts the download, returns at once
//   segmenter.update(nowMs);      // per frame while the mask is wanted
//   segmenter.mask                // { data: Uint8Array, width, height, frame }
//
// The mask is in VIDEO space (unmirrored, row 0 at the top), one byte of
// person confidence per pixel, softened a little (the model's output is
// blocky at its 256 px resolution) and smoothed over time. Map it to the screen the
// way hands.js maps landmarks (mirror, then the object-fit: cover crop);
// coverTransform() gives that mapping.
//
// update() only runs the model on new video frames and at most `maxRate`
// times a second, on a small copy of the frame (the model works at 256 px).

const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

const INPUT_WIDTH = 256;   // the frame is scaled to this width before segmenting
const TEMPORAL_BLEND = 0.6; // weight of the newest mask: less flicker, little lag
const BLUR_RADIUS = 2;      // box blur, in mask pixels, run twice (close to a gaussian)

export function createSegmenter(video, { maxRate = 30 } = {}) {
  let segmenter = null;
  let loading = null;
  let status = 'idle';
  let lastVideoTime = -1;
  let lastRunMs = -Infinity;
  let lastTimestamp = 0;
  const input = document.createElement('canvas');
  const inputContext = input.getContext('2d');
  const mask = { data: null, width: 0, height: 0, frame: 0 };
  let runs = 0;
  let soft = null;      // the newest mask, blurred
  let scratch = null;

  function load() {
    loading ??= (async () => {
      status = 'loading';
      try {
        const { ImageSegmenter, FilesetResolver } = await import(VISION_URL);
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        const options = {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        };
        try {
          segmenter = await ImageSegmenter.createFromOptions(fileset, options);
        } catch (gpuError) {
          console.warn('segmenter: GPU delegate failed, retrying on CPU', gpuError);
          options.baseOptions.delegate = 'CPU';
          segmenter = await ImageSegmenter.createFromOptions(fileset, options);
        }
        status = 'ready';
      } catch (loadError) {
        console.warn('person segmentation unavailable', loadError);
        status = 'failed';
      }
    })();
    return loading;
  }

  function store(confidence, width, height) {
    const size = width * height;
    const fresh = !mask.data || mask.data.length !== size;
    if (fresh) {
      mask.data = new Uint8Array(size);
      mask.width = width;
      mask.height = height;
      soft = new Float32Array(size);
      scratch = new Float32Array(size);
    }
    soft.set(confidence);
    for (let pass = 0; pass < 2; pass++) {
      boxBlur(soft, scratch, width, height, 1, width);   // along rows
      boxBlur(scratch, soft, height, width, width, 1);   // along columns
    }
    const data = mask.data;
    for (let index = 0; index < size; index++) {
      const value = soft[index] * 255;
      data[index] = fresh ? value : data[index] + (value - data[index]) * TEMPORAL_BLEND;
    }
    mask.frame++;
  }

  function update(nowMs) {
    if (!segmenter || video.readyState < 2 || !video.videoWidth) return false;
    if (video.currentTime === lastVideoTime || nowMs - lastRunMs < 1000 / maxRate) return false;
    lastVideoTime = video.currentTime;
    lastRunMs = nowMs;
    const width = INPUT_WIDTH;
    const height = Math.round(INPUT_WIDTH * video.videoHeight / video.videoWidth);
    if (input.width !== width || input.height !== height) {
      input.width = width;
      input.height = height;
    }
    inputContext.drawImage(video, 0, 0, width, height);
    // VIDEO mode needs strictly increasing timestamps
    lastTimestamp = Math.max(lastTimestamp + 1, Math.round(nowMs));
    runs++;
    try {
      segmenter.segmentForVideo(input, lastTimestamp, (result) => {
        const masks = result.confidenceMasks;
        if (!masks?.length) return;
        // one mask is the person; with two, the second one is
        const person = masks[masks.length - 1];
        store(person.getAsFloat32Array(), person.width, person.height);
      });
    } catch (runError) {
      console.warn('segmentation failed, giving up', runError);
      segmenter = null;
      status = 'failed';
      return false;
    }
    return true;
  }

  return {
    load,
    update,
    mask,
    get status() {
      return status;
    },
    get runs() {
      return runs;
    },
  };
}

// A running-sum box blur of `lines` lines of `length` samples each; `step`
// is the distance between samples along a line, `stride` between lines.
function boxBlur(source, target, length, lines, step, stride) {
  const radius = BLUR_RADIUS;
  const span = radius * 2 + 1;
  for (let line = 0; line < lines; line++) {
    const start = line * stride;
    const at = (index) => source[start + Math.min(length - 1, Math.max(0, index)) * step];
    let sum = 0;
    for (let index = -radius; index <= radius; index++) sum += at(index);
    for (let index = 0; index < length; index++) {
      target[start + index * step] = sum / span;
      sum += at(index + radius + 1) - at(index - radius);
    }
  }
}

// Viewport (0..1, y down, as the user sees it) -> video (0..1, unmirrored,
// y down) for a mirrored video shown with object-fit: cover:
//   videoX = 1 - (viewportX * scale.x + offset.x),  videoY = viewportY * scale.y + offset.y
export function coverTransform(video, viewportWidth, viewportHeight) {
  if (!video.videoWidth) return { scale: { x: 1, y: 1 }, offset: { x: 0, y: 0 } };
  const zoom = Math.max(viewportWidth / video.videoWidth, viewportHeight / video.videoHeight);
  const shownWidth = video.videoWidth * zoom;
  const shownHeight = video.videoHeight * zoom;
  return {
    scale: { x: viewportWidth / shownWidth, y: viewportHeight / shownHeight },
    offset: { x: (shownWidth - viewportWidth) / 2 / shownWidth, y: (shownHeight - viewportHeight) / 2 / shownHeight },
  };
}
