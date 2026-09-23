import * as Cesium from 'cesium';
import { animateMovement } from './easing.js';

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function viewTarget(viewer, explicitTarget, sceneCamera) {
  if (explicitTarget) {
    return Cesium.Cartesian3.fromDegrees(
      explicitTarget.longitude,
      explicitTarget.latitude,
      explicitTarget.altitude ?? 0,
    );
  }
  const { camera, scene } = viewer;
  const canvas = scene?.canvas;
  if (canvas) {
    const center = new Cesium.Cartesian2(
      (canvas.clientWidth || canvas.width) / 2,
      (canvas.clientHeight || canvas.height) / 2,
    );
    if (typeof camera.getPickRay === 'function') {
      const ray = camera.getPickRay(center);
      const picked = ray && scene.globe?.pick(ray, scene);
      if (picked) return picked;
    }
    if (typeof camera.pickEllipsoid === 'function') {
      const picked = camera.pickEllipsoid(center, Cesium.Ellipsoid.WGS84);
      if (picked) return picked;
    }
  }
  if (sceneCamera) {
    return Cesium.Cartesian3.fromDegrees(
      sceneCamera.longitude,
      sceneCamera.latitude,
      0,
    );
  }
  return null;
}

function orbitFrame(camera, target) {
  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(target);
  const inverse = Cesium.Matrix4.inverseTransformation(
    transform,
    new Cesium.Matrix4(),
  );
  const offset = Cesium.Matrix4.multiplyByPoint(
    inverse,
    camera.positionWC ?? camera.position,
    new Cesium.Cartesian3(),
  );
  const range = Cesium.Cartesian3.magnitude(offset);
  if (!Number.isFinite(range) || range < 1) return null;
  const pitch = -Math.asin(Cesium.Math.clamp(offset.z / range, -1, 1));
  const heading =
    pitch < Cesium.Math.toRadians(-88.5)
      ? camera.heading
      : Math.atan2(-offset.x, -offset.y);
  return { heading, pitch, range };
}

function restoreWorldFrame(camera) {
  const destination = Cesium.Cartesian3.clone(camera.positionWC);
  const direction = Cesium.Cartesian3.clone(camera.directionWC);
  const up = Cesium.Cartesian3.clone(camera.upWC);
  camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  if (destination && direction && up) {
    camera.setView({ destination, orientation: { direction, up } });
  }
}

/** Ordered movement handlers. Pan distances are in screen-plane meters. */
export function createMovementHandlers(
  viewer,
  { animate = animateMovement, sleep = wait } = {},
) {
  const { camera, scene } = viewer;
  const render = () => scene?.requestRender?.();

  async function orbit(movement, sceneCamera) {
    const target = viewTarget(viewer, movement.target, sceneCamera);
    const frame =
      target && typeof camera.lookAt === 'function'
        ? orbitFrame(camera, target)
        : null;
    const delta = Cesium.Math.toRadians(movement.degrees);
    if (!frame) {
      const heading = camera.heading;
      await animate(movement, (progress) => {
        camera.setView({
          orientation: {
            heading: heading + delta * progress,
            pitch: camera.pitch,
            roll: camera.roll,
          },
        });
        render();
      });
      return;
    }

    const roll = camera.roll;
    try {
      await animate(movement, (progress) => {
        camera.lookAt(
          target,
          new Cesium.HeadingPitchRange(
            frame.heading + delta * progress,
            frame.pitch,
            frame.range,
          ),
        );
        if (roll && typeof camera.twistRight === 'function')
          camera.twistRight(roll);
        render();
      });
    } finally {
      restoreWorldFrame(camera);
      render();
    }
  }

  async function pan(movement) {
    let previous = 0;
    await animate(movement, (progress) => {
      const step = progress - previous;
      previous = progress;
      if (movement.horizontalMeters)
        camera.moveRight(movement.horizontalMeters * step);
      if (movement.verticalMeters)
        camera.moveUp(movement.verticalMeters * step);
      render();
    });
  }

  async function zoom(movement, sceneCamera) {
    const target = viewTarget(viewer, null, sceneCamera);
    const position = camera.positionWC ?? camera.position;
    const distance =
      target && position
        ? Cesium.Cartesian3.distance(position, target)
        : camera.positionCartographic?.height;
    if (!Number.isFinite(distance) || distance <= 0) {
      throw new Error('Worldlayer: zoom requires a valid camera distance.');
    }
    const total = distance * (1 - movement.factor);
    let previous = 0;
    await animate(movement, (progress) => {
      const step = progress - previous;
      previous = progress;
      camera.moveForward(total * step);
      render();
    });
  }

  async function hold(movement) {
    await sleep(movement.duration * 1000);
  }

  return { orbit, pan, zoom, hold };
}
