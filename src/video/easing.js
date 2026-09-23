export const easingFunctions = Object.freeze({
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
});

/** Animate a movement using elapsed wall time, independent of frame rate. */
export function animateMovement(
  movement,
  update,
  { now = () => performance.now(), requestFrame = requestAnimationFrame } = {},
) {
  const ease = easingFunctions[movement.easing ?? 'easeInOut'];
  const startedAt = now();
  const durationMs = movement.duration * 1000;
  return new Promise((resolve, reject) => {
    function frame(currentTime) {
      try {
        const progress = Math.min(
          Math.max((currentTime - startedAt) / durationMs, 0),
          1,
        );
        update(ease(progress), progress);
        if (progress < 1) requestFrame(frame);
        else resolve();
      } catch (error) {
        reject(error);
      }
    }
    requestFrame(frame);
  });
}
