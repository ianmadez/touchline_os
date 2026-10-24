/**
 * The direction of the last bridge version probe, held somewhere both runtimes can see.
 *
 * The probe lives in the browser twin (`bridge-client.browser.ts`), which the Node target does not even
 * resolve - so the component that renders the message cannot import it. This module is the neutral
 * meeting point: the browser build writes the answer here, and the card reads it.
 *
 * A mutable module value rather than a prop, deliberately. The state the card renders is *derived* from
 * this value, so the two cannot disagree, and the alternative was threading a second status field from
 * the probe through the page shell and the landing component to reach one branch of one card.
 */
import type { Compatibility } from "../sync/versions";

let last: Compatibility = "unknown";

export function setLastBridgeCompatibility(value: Compatibility): void {
  last = value;
}

export function lastBridgeCompatibility(): Compatibility {
  return last;
}
