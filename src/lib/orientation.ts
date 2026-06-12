/**
 * Pitch/roll from DeviceOrientationEvent, derived from the gravity direction
 * in device coordinates rather than raw beta/gamma — raw gamma flips wildly
 * when beta ≈ 90° (phone held upright), exactly the pose this app lives in.
 *
 * With R = Rz(alpha)·Rx(beta)·Ry(gamma) (W3C order), gravity in device
 * coords is g_d = (cosβ·sinγ, −sinβ, −cosβ·cosγ).
 * Phone upright in portrait facing the wall → g_d = (0,−1,0) → pitch = roll = 0.
 */

export interface Tilt {
  pitchDeg: number; // + = top of phone tilted away from you (toward the wall)
  rollDeg: number; // + = phone rotated clockwise (your view)
}

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function tiltFromOrientation(
  betaDeg: number,
  gammaDeg: number,
  screenAngleDeg: number,
): Tilt {
  const b = betaDeg * D2R;
  const g = gammaDeg * D2R;
  const gx = Math.cos(b) * Math.sin(g);
  const gy = -Math.sin(b);
  const gz = -Math.cos(b) * Math.cos(g);

  // Rotate gravity into screen coordinates (device frame is fixed to the
  // hardware; the UI rotates with screen.orientation.angle).
  const a = -screenAngleDeg * D2R;
  const sx = gx * Math.cos(a) - gy * Math.sin(a);
  const sy = gx * Math.sin(a) + gy * Math.cos(a);

  // pitch: lean toward/away from the wall (gravity leaving the screen plane)
  const pitch = Math.atan2(-gz, -sy) * R2D;
  // roll: rotation within the screen plane
  const roll = Math.atan2(sx, -sy) * R2D;
  return { pitchDeg: pitch, rollDeg: roll };
}

/** iOS requires an explicit permission grant from a user gesture. */
export async function requestOrientationPermission(): Promise<'granted' | 'denied' | 'not-needed'> {
  const anyEvt = DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<'granted' | 'denied'>;
  };
  if (typeof anyEvt.requestPermission === 'function') {
    try {
      return await anyEvt.requestPermission();
    } catch {
      return 'denied';
    }
  }
  return 'not-needed';
}
