/**
 * What the PC core and a paired device agree on.
 *
 * This module is imported by both sides - the bridge process on the PC and the React app in a browser -
 * so it may hold nothing but constants and types. Anything with a runtime dependency (a filesystem, a
 * socket, a browser global) belongs to one side only, and putting it here would break the other.
 *
 * The version numbers are the compatibility handshake. `REMOTE_API_VERSION` is what the core serves
 * today; `REMOTE_MIN_CLIENT_VERSION` is the oldest app build it will talk to. They are compared at
 * `/status` and at pairing, so an old app that a stale browser has cached says so in a sentence
 * instead of failing on an endpoint that changed shape underneath it.
 */

/** The wire shape this core speaks. Bumped when a field changes meaning, not merely exists. */
export const REMOTE_API_VERSION = 1;

/** The oldest app build this core will serve. */
export const REMOTE_MIN_CLIENT_VERSION = 1;

/** Identifies the core on `/status`, so a page can tell it apart from anything else on the port. */
export const REMOTE_SERVICE = "touchline-core";

/**
 * The LAN listener's port.
 *
 * Deliberately adjacent to the loopback bridge's 4977 and deliberately not that one: the loopback
 * listener hands out save bytes to a hosted page, this one is the whole app for a paired phone. Two
 * jobs, two clearances, two ports.
 */
export const DEFAULT_REMOTE_PORT = 4978;

/** Where the device token travels. A header, so it survives "block all cookies" and Safari's rules. */
export const REMOTE_TOKEN_HEADER = "x-touchline-device";

/** The browser's own record of the pairing. Session-scoped: forgetting it is the unpair. */
export const REMOTE_STORAGE_KEY = "touchline.remote.v1";

/** The meta tag the core injects into the app it serves. Its presence is what makes a page remote. */
export const REMOTE_MARKER_META = "touchline-remote";

/** Notified when a write is refused because another device holds the pen. */
export const REMOTE_LEASE_EVENT = "touchline:lease-lost";

/** Notified when the core's data changed, so every screen can refetch. */
export const REMOTE_DATA_EVENT = "touchline:data-changed";

/** How long a device idles before the core stops counting it as connected. */
export const DEVICE_IDLE_MS = 5 * 60 * 1000;

export type RemoteErrorCode =
  | "unpaired"
  | "pairing-code"
  | "version"
  | "lease"
  | "rate-limited"
  | "too-large"
  | "unknown";

/** The envelope a refused remote call carries, in addition to the usual `{ success, error }`. */
export interface RemoteErrorBody {
  success: false;
  error: string;
  code?: RemoteErrorCode;
  /** Present on `lease`: the epoch the caller would have needed to hold. */
  leaseEpoch?: number;
}

/** The revision counter, and which device moved it. */
export interface RemoteChange {
  revision: number;
  /** The device that made the write, or null when the change came from the PC itself. */
  by: string | null;
}

export interface RemoteDevice {
  /** Stable for the life of the pairing. Never derived from the name, which the user can repeat. */
  id: string;
  name: string;
  /** ISO. */
  pairedAt: string;
  /** ISO, refreshed by requests and by the event stream. */
  lastSeenAt: string;
  /** True for the device making the call. */
  self: boolean;
  /** True when this device currently holds the writer lease. */
  writer: boolean;
}

export interface RemoteWriter {
  deviceId: string;
  name: string;
  /** ISO. */
  since: string;
}

/** The pairing code and the address another phone would use, for the QR. */
export interface RemotePairing {
  code: string;
  url: string;
  /** `data:image/svg+xml;base64,...`; null when the QR generator is unavailable. */
  qr: string | null;
}

/** Everything a screen needs to describe the connection, in one call. */
export interface RemoteState {
  paired: boolean;
  apiVersion: number;
  minClientVersion: number;
  /** False when this app build is too old for the core, or the core is too old for the app. */
  compatible: boolean;
  /** The PC's hostname, for "connected to DESKTOP-1234". */
  hostName: string;
  /** The origin the page is served from. */
  url: string;
  /** Whether the LAN listener is on. Writes are refused when it is off. */
  sharing: boolean;
  self: RemoteDevice | null;
  writer: RemoteWriter | null;
  devices: RemoteDevice[];
  /** Only present for a paired device: the code is a secret until you have paired once. */
  pairing: RemotePairing | null;
  /** A monotonic counter the core bumps on every write. Used by the poll fallback. */
  revision: number;
}
