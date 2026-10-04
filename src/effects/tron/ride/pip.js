// The webcam as a picture-in-picture while riding. The host shows the
// camera as a full-screen <video> under the effect layer (index.html), and
// the effect layer is screen-blended over it, so the arena shows in full
// wherever the video isn't. Shrinking the video element itself into a
// corner keeps the real camera image, at its full frame rate, under the
// HUD's frame; the HUD covers that corner in black so the arena doesn't
// add onto it. The element is put back exactly as it was afterwards.
export function createPip(video) {
  let applied = false;

  return {
    // rect { x, y, w, h } in CSS pixels of a viewport `viewWidth` wide, or
    // null for the normal full-screen camera
    set(rect, viewWidth) {
      if (!rect) {
        if (!applied) return;
        video.style.transform = '';
        video.style.transformOrigin = '';
        video.style.borderRadius = '';
        applied = false;
        return;
      }
      const scale = rect.w / Math.max(1, viewWidth);
      // mirrored like the full-screen camera: the element's left edge lands
      // on the rect's right edge
      video.style.transformOrigin = '0 0';
      video.style.transform = `translate(${(rect.x + rect.w).toFixed(2)}px, ${rect.y.toFixed(2)}px) `
        + `scale(${(-scale).toFixed(5)}, ${scale.toFixed(5)})`;
      video.style.borderRadius = `${(10 / Math.max(scale, 0.01)).toFixed(1)}px`;
      applied = true;
    },
  };
}
