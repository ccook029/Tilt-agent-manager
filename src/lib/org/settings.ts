// ---------------------------------------------------------------------------
// org/settings.ts — org-wide switches (Vercel KV)
//
// Graduation: Chris keeps the approve trigger on every department by default.
// When a boss has earned trust, flipping their department's autoShip means a
// BOSS-APPROVED work order ships immediately (running the ship executor)
// instead of waiting in Chris's queue. Escalations still always go to Chris,
// and positions without a reviewing boss never auto-ship — graduation only
// removes the second human tap after a review has already happened.
// ---------------------------------------------------------------------------
import { kv } from "@vercel/kv";

const KEY = "org-settings";

export interface OrgSettings {
  /** departmentId → boss-approved work ships without the owner's tap. */
  autoShip: Record<string, boolean>;
}

export async function getOrgSettings(): Promise<OrgSettings> {
  const stored = await kv.get<OrgSettings>(KEY);
  return { autoShip: stored?.autoShip ?? {} };
}

export async function setAutoShip(
  departmentId: string,
  enabled: boolean,
  changedBy = "Chris Cook"
): Promise<OrgSettings> {
  const settings = await getOrgSettings();
  settings.autoShip[departmentId] = enabled;
  await kv.set(KEY, settings);
  console.log(
    `[org-settings] autoShip(${departmentId}) → ${enabled} by ${changedBy}`
  );
  return settings;
}

export async function isAutoShipEnabled(
  departmentId: string
): Promise<boolean> {
  const settings = await getOrgSettings().catch(
    (): OrgSettings => ({ autoShip: {} })
  );
  return settings.autoShip[departmentId] === true;
}
