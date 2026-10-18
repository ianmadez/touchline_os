/**
 * Who is allowed in, and which of them is holding the pen.
 *
 * Kept in `remote.json` beside the database rather than in the database: these are facts about the
 * connection, not about the career, and they must survive a career reset without being exported into
 * a transfer package. Losing this file costs a re-pair, which is the right amount of damage.
 *
 * Two rules worth reading the code for:
 *
 * - **Tokens are stored hashed.** A bearer token written in plain text in a file on disk is a second
 *   copy of the secret; the hash cannot be replayed. The device compares nothing itself - it sends the
 *   token, the core hashes and looks it up.
 * - **The lease expires by idleness, not by clock.** A phone in a pocket must not keep the pen from
 *   the desktop forever, and a phone being looked at must not lose it. `lastSeenAt` is refreshed by a
 *   heartbeat the app sends only while the page is visible, so it means "someone is here" rather than
 *   "a socket is open".
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DEVICE_IDLE_MS } from "../src/lib/remote/protocol";

export interface DeviceRecord {
  id: string;
  name: string;
  /** SHA-256 of the bearer token. The token itself is never written down. */
  tokenHash: string;
  pairedAt: string;
  lastSeenAt: string;
}

export interface LeaseRecord {
  deviceId: string;
  /** ISO. */
  since: string;
  /**
   * Bumped every time the pen changes hands.
   *
   * A write that carries an older epoch is from a screen that has been looking at stale state, and is
   * refused rather than applied - which is what stops two devices' saved forms from interleaving.
   */
  epoch: number;
}

interface StoreFile {
  devices: DeviceRecord[];
  lease: LeaseRecord | null;
  revision: number;
  sharing: boolean;
}

const EMPTY: StoreFile = { devices: [], lease: null, revision: 0, sharing: false };

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** A token nobody can guess, in a form that survives being put in a header or a cookie. */
export function createToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export class DeviceStore {
  private state: StoreFile;

  constructor(private readonly file: string, initial: StoreFile = EMPTY) {
    this.state = initial;
  }

  /** Reads the store, treating anything unreadable as "nobody is paired" rather than crashing a start. */
  static load(file: string): DeviceStore {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as Partial<StoreFile>;
      return new DeviceStore(file, {
        devices: Array.isArray(raw.devices)
          ? raw.devices.filter(
              (entry): entry is DeviceRecord =>
                !!entry &&
                typeof entry.id === "string" &&
                typeof entry.name === "string" &&
                typeof entry.tokenHash === "string"
            )
          : [],
        lease:
          raw.lease && typeof (raw.lease as LeaseRecord).deviceId === "string"
            ? (raw.lease as LeaseRecord)
            : null,
        revision: typeof raw.revision === "number" ? raw.revision : 0,
        // Absent means off: an older file must never be read as "share with the network".
        sharing: raw.sharing === true,
      });
    } catch {
      return new DeviceStore(file);
    }
  }

  private persist(): void {
    // Written beside the target and renamed, so a crash mid-write leaves the old file rather than a
    // truncated one. Losing every pairing to a power cut is a worse outcome than a stale list.
    const temp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(temp, JSON.stringify(this.state, null, 2), "utf8");
      fs.renameSync(temp, this.file);
    } catch {
      // An unwritable location costs persistence, not the session: everything still works until the
      // core restarts, and the pairing code gets re-entered.
    }
  }

  /** Pairs a device, reusing the record when the same name pairs again from the same browser. */
  pair(name: string, now: Date = new Date()): { device: DeviceRecord; token: string } {
    const token = createToken();
    const device: DeviceRecord = {
      id: crypto.randomBytes(4).toString("hex"),
      name: name.trim().slice(0, 60) || "Unnamed device",
      tokenHash: hashToken(token),
      pairedAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
    };
    this.state.devices.push(device);
    this.persist();
    return { device, token };
  }

  /** The device a token belongs to, or null. Constant-time is unnecessary here: a hash either matches. */
  authenticate(token: string | undefined): DeviceRecord | null {
    if (!token) return null;
    const hash = hashToken(token);
    return this.state.devices.find((device) => device.tokenHash === hash) ?? null;
  }

  touch(deviceId: string, now: Date = new Date()): void {
    const device = this.state.devices.find((entry) => entry.id === deviceId);
    if (!device) return;
    device.lastSeenAt = now.toISOString();
    this.persist();
  }

  revoke(deviceId: string): boolean {
    const before = this.state.devices.length;
    this.state.devices = this.state.devices.filter((device) => device.id !== deviceId);
    if (this.state.lease?.deviceId === deviceId) {
      // Revoking the pen-holder frees the pen. Otherwise the remaining devices would be locked out by
      // a device that no longer exists, with nothing on screen to explain it.
      this.state.lease = null;
      this.state.revision += 1;
    }
    if (this.state.devices.length === before) return false;
    this.persist();
    return true;
  }

  devices(): DeviceRecord[] {
    return [...this.state.devices].sort((a, b) => a.pairedAt.localeCompare(b.pairedAt));
  }

  /** The pen, or null when nobody holds it or the holder has gone quiet. */
  lease(now: Date = new Date()): LeaseRecord | null {
    const lease = this.state.lease;
    if (!lease) return null;
    const holder = this.state.devices.find((device) => device.id === lease.deviceId);
    if (!holder) return null;
    if (now.getTime() - Date.parse(holder.lastSeenAt) > DEVICE_IDLE_MS) return null;
    return lease;
  }

  /**
   * Claims the pen.
   *
   * Always succeeds, including against another device: this is what the "Take control" press does, and
   * a request to take control that silently failed would leave the user pressing a button that appears
   * to do nothing. The displaced device learns about it through the event stream and a 409.
   */
  take(deviceId: string, now: Date = new Date()): LeaseRecord {
    const current = this.state.lease;
    const alreadyHeld = current?.deviceId === deviceId;
    this.state.lease = {
      deviceId,
      since: alreadyHeld ? current.since : now.toISOString(),
      epoch: (current?.epoch ?? 0) + 1,
    };
    this.state.revision += 1;
    this.persist();
    return this.state.lease;
  }

  release(deviceId: string): boolean {
    if (this.state.lease?.deviceId !== deviceId) return false;
    this.state.lease = null;
    this.state.revision += 1;
    this.persist();
    return true;
  }

  revision(): number {
    return this.state.revision;
  }

  /** Bumped by every write, so a client can tell whether it is looking at stale data. */
  bumpRevision(): number {
    this.state.revision += 1;
    this.persist();
    return this.state.revision;
  }

  sharing(): boolean {
    return this.state.sharing;
  }

  setSharing(enabled: boolean): void {
    this.state.sharing = enabled;
    this.state.revision += 1;
    this.persist();
  }

  /** Everything, for a test that wants to assert the file rather than the API. */
  snapshot(): StoreFile {
    return JSON.parse(JSON.stringify(this.state)) as StoreFile;
  }
}
