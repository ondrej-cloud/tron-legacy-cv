// A rear-view mirror: a strip at the top of the screen showing the arena
// behind the bike, flipped left to right like a mirror, so CLU behind you on
// the left shows on the left. The ride turns it on while the player looks
// back (B held, or braking for a moment). The view behind is rendered into
// a small target of its own and then drawn over the finished frame.
import * as THREE from 'three';

const EYE = { height: 1.5, forward: 0.4, lookBack: 40, lookHeight: 0.9, fov: 46 };

export function createMirror(renderer) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const camera = new THREE.PerspectiveCamera(EYE.fov, 4, 0.1, 2000);
  const geometry = new THREE.PlaneGeometry(2, 2);
  // mirrored: the texture's left edge on the right
  const uv = geometry.attributes.uv;
  for (let index = 0; index < uv.count; index++) uv.setX(index, 1 - uv.getX(index));
  const material = new THREE.MeshBasicMaterial({ map: target.texture, transparent: true, depthTest: false, depthWrite: false });
  const overlay = new THREE.Scene();
  overlay.add(new THREE.Mesh(geometry, material));
  const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const viewport = new THREE.Vector4();
  const scissor = new THREE.Vector4();

  return {
    // its overlay's shader, compiled in the background (for a ride that
    // starts before the warm-up has drawn it once)
    compile() {
      return renderer.compileAsync(overlay, flat);
    },
    // Draws the mirror: `scene` seen back from `rider`, into `rect` (CSS px
    // from the top left of a viewport `viewHeight` tall), `alpha` 0..1.
    render(scene, rider, rect, viewHeight, alpha) {
      if (alpha <= 0.01) return;
      const pixelRatio = renderer.getPixelRatio();
      const width = Math.max(1, Math.round(rect.w * pixelRatio));
      const height = Math.max(1, Math.round(rect.h * pixelRatio));
      if (target.width !== width || target.height !== height) target.setSize(width, height);
      const y = rider.y ?? 0;
      camera.position.set(rider.x + rider.forwardX * EYE.forward, y + EYE.height, rider.z + rider.forwardZ * EYE.forward);
      camera.lookAt(rider.x - rider.forwardX * EYE.lookBack, y + EYE.lookHeight, rider.z - rider.forwardZ * EYE.lookBack);
      if (Math.abs(camera.aspect - rect.w / rect.h) > 1e-3) {
        camera.aspect = rect.w / rect.h;
        camera.updateProjectionMatrix();
      }
      const previousTarget = renderer.getRenderTarget();
      const autoClear = renderer.autoClear;
      renderer.getViewport(viewport);
      renderer.getScissor(scissor);
      const scissorTest = renderer.getScissorTest();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(previousTarget);
      // over the finished frame, in its corner of the screen
      material.opacity = alpha;
      renderer.autoClear = false;
      const bottom = viewHeight - rect.y - rect.h;
      renderer.setViewport(rect.x, bottom, rect.w, rect.h);
      renderer.setScissor(rect.x, bottom, rect.w, rect.h);
      renderer.setScissorTest(true);
      renderer.render(overlay, flat);
      renderer.setScissorTest(scissorTest);
      renderer.setScissor(scissor);
      renderer.setViewport(viewport);
      renderer.autoClear = autoClear;
    },
  };
}

// where the mirror goes on screen: under the score, a wide strip
export function mirrorRect(width) {
  const w = Math.round(Math.min(520, width * 0.34));
  const h = Math.round(w / 4.2);
  return { x: Math.round((width - w) / 2), y: 96, w, h };
}
