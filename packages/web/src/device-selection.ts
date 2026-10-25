import type { Device } from "./types";

export function preferredDevice(
  devices: Device[],
  selected: string | null,
): Device | null {
  const ready = devices.filter((device) => device.state === "device");
  const current = ready.find((device) => device.serial === selected);
  const phone = ready.find((device) => !device.replay);
  if (current && !current.replay) return current;
  if (phone) return phone;
  // An unauthorized/offline phone needs attention; showing demo data would hide it.
  if (devices.some((device) => !device.replay)) return null;
  return current ?? ready[0] ?? null;
}
