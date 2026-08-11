// ---------------------------------------------------------------------------
// etransfer-register.ts — the e-Transfer ledger, from the bank's own record.
//
// The bank feed strips the counterparty and memo off Interac lines, which is
// why Penny kept asking "who is this $128.09?". This is Chris's exported
// transfer history: every line's DIRECTION ("From:" = money in, "To:" = money
// out), the person on the other side, and their memo — which is usually the
// whole answer ("Fuel - March.8", "Stick for Dan Heffernan", "Insurance
// payment").
//
// Two uses in the categorization run:
//   1. Per-line match (amount + date window) → annotate the transaction with
//      the counterparty and memo. Its direction is AUTHORITATIVE: some feed
//      lines carry an inverted debit/credit flag, and this register is the
//      bank's own statement of which way the money moved.
//   2. A computed RECURRING PATTERNS block so repeat items (truck payment,
//      insurance, fuel, on-ice contractor) are recognised on sight.
//
// To refresh: paste new rows into REGISTER_RAW in the same
// `date|direction|counterparty|amount|memo` shape. Dates are ISO; amounts are
// always positive (direction carries the sign).
// ---------------------------------------------------------------------------

export interface TransferEntry {
  date: string; // YYYY-MM-DD
  direction: "in" | "out";
  counterparty: string;
  amount: number;
  memo: string;
}

const REGISTER_RAW = `
2026-08-08|in|WOODSTOCK NAVY VETS U10 A/AA|480.00|Invoice 590
2026-07-29|in|JEREMY ELLIOTT|387.48|
2026-07-22|in|JEREMY ELLIOTT|230.00|July Insurance payment.
2026-07-21|out|Forge Hockey|60.00|Payment Inv-000051
2026-07-17|out|Jeremy Elliott|110.70|407 FEES- Oshawa/TEP
2026-07-17|out|Jeremy Elliott|2000.00|Re-payment
2026-07-17|out|Chris|2500.00|Repay 2500 advance
2026-07-15|in|JEREMY ELLIOTT|387.48|Truck payment - July 10
2026-07-10|in|JEREMY ELLIOTT|200.00|Cash exchange - Jer
2026-07-08|in|KATIE HOWARD|50.00|
2026-07-04|out|Jeremy Elliott|224.00|Hotel room - Oshawa
2026-07-01|in|JEREMY ELLIOTT|387.48|Truck payment, June 26th
2026-07-01|in|JEREMY ELLIOTT|230.00|Insurance payment, June.
2026-06-24|in|JEREMY ELLIOTT|2000.00|Additional contribution
2026-06-17|in|JEREMY ELLIOTT|387.48|Truck payment - June 12
2026-06-17|in|JEREMY ELLIOTT|60.00|Sales - 2 x hats
2026-06-17|in|ANDREW P MARSHALL|1000.00|$1000 remaining for IBL jerseys
2026-06-12|out|TEP Tournament|565.00|INV - 00014
2026-06-05|in|Brad Cook|2500.00|
2026-06-04|out|Lucan Business Men|100.00|Hole sponsorship
2026-06-01|in|JEREMY ELLIOTT|387.48|Truck Payment- May.29th
2026-06-01|in|JEREMY ELLIOTT|230.00|Insurance payment - May 2026
2026-05-29|in|STEPHANIE ROMANO|2350.00|London TFC - Stephanie Romano 50 blankets
2026-05-20|in|JEREMY ELLIOTT|387.48|Truck Payment- May 15th
2026-05-15|in|Strathroy Minor Lacrosse Association|1830.60|Lacrosse bags, invoice - 00592
2026-05-12|in|ALLISON BROSS|186.45|
2026-05-08|in|ANDREW P MARSHALL|2000.00|IBL Jerseys
2026-05-07|in|Jon Van Grinsven|2198.98|INV-00593
2026-05-03|in|Katie Uniac|40.00|Pucks
2026-05-03|out|Jeremy Elliott|148.12|Fuel - May 3
2026-05-03|in|JEREMY ELLIOTT|387.48|Truck Payment- May 1st
2026-05-03|in|JEREMY ELLIOTT|450.00|Additional cash infusion - May.2
2026-04-28|out|Jeremy Elliott|136.65|Storage Bins for ice tiles/Shop
2026-04-25|out|Jeremy Elliott|150.00|Fuel - April 24th
2026-04-25|in|JEREMY ELLIOTT|230.00|Insurance payment
2026-04-25|in|JEREMY ELLIOTT|95.00|Balance of Parson's stick plus McHardy grips
2026-04-25|in|JEREMY ELLIOTT|225.00|Dan Liska's stick
2026-04-20|in|JESSICA FAIRFUL|1265.60|payment for INV-00587 northside smash monkey jerseys and socks. Lonnie Parkin
2026-04-18|out|Jeremy Elliott|150.09|Fuel - April 17th
2026-04-18|in|JEREMY ELLIOTT|387.48|Truck Payment- April 17th
2026-04-16|in|JEREMY ELLIOTT|800.00|Additional cash contribution
2026-04-16|in|JEREMY ELLIOTT|480.00|Van Steensel Sticks - 2 x LH,T28,75
2026-04-16|in|Charles Moir|225.00|
2026-04-13|out|Jeremy Elliott|108.09|Fuel - April 11
2026-04-09|out|EMC Treasurer|2000.00|
2026-04-09|in|JEREMY ELLIOTT|1800.00|Additional contribution to acct ($)
2026-04-08|out|Jeremy Elliott|128.30|Fuel - April6
2026-04-08|in|JEREMY ELLIOTT|387.48|Truck payment - April 6
2026-04-06|in|JEREMY ELLIOTT|250.00|D.Skinner, 25in White Goalie stick
2026-04-06|in|JEREMY ELLIOTT|210.00|Stick for Dan Heffernan, H2512-05983
2026-04-06|out|Jeremy Elliott|158.10|Fuel - March 30th
2026-04-06|in|DANIEL RICHARD|185.45|3 Tilt sweaters for 2015 rising stars team
2026-03-26|out|Ethan Lamoureux|120.00|
2026-03-26|in|1001036281 ONTARIO INC|2369.76|supreme hockey uniforms payment 2/2
2026-03-24|in|JEREMY ELLIOTT|1500.00|cash contribution to Business Acct.
2026-03-23|in|1001036281 ONTARIO INC|3000.00|spring uniforms 1/2
2026-03-22|in|AMY MCHARDY|225.00|amy mchardy
2026-03-21|in|JEREMY ELLIOTT|230.00|Insurance payment
2026-03-21|in|JEREMY ELLIOTT|387.48|Truck Payment- Mar.20
2026-03-14|out|Jeremy Elliott|128.10|Fuel - Mar.14th
2026-03-14|in|Jeremy James Gilbert|35.00|
2026-03-11|in|JEREMY ELLIOTT|387.48|Truck Payment- Mar.6
2026-03-10|in|JEREMY ELLIOTT|210.00|Scott Vosper (Mitchell) stick - details to follow
2026-03-08|out|Jeremy Elliott|118.09|Fuel - March.8
2026-03-01|out|Jeremy Elliott|95.50|Fuel - Feb.28th
2026-02-27|in|Dave Barselaar|10.00|Barselaar stick topper
2026-02-27|in|JEREMY ELLIOTT|220.00|Vick stick - RH, T92, 85 flex, black and chrome
2026-02-27|in|CAYLE R ST CROIX|194.36|coles stick
2026-02-24|in|BARBARA COOK|292.67|Payment from Ken Cook for 2 goalie sticks
2026-02-23|out|Xtreem Screen Prntg|67.80|TILT Hockey - Invoice #000438
2026-02-22|out|Jeremy Elliott|120.00|Fuel - Feb.21
2026-02-22|in|JEREMY ELLIOTT|230.00|Insurance payment - Feb.20
2026-02-22|in|JEREMY ELLIOTT|387.48|F-150 payment - Feb.20
2026-02-22|in|JEREMY ELLIOTT|265.00|Vosper- 72in 100 flex T92 RH white
2026-02-18|in|CINDY WALKER|167.24|Beech Goalie Stick INV-00564
2026-02-17|out|48 Cuts|1050.00|
2026-02-16|out|Jeremy Elliott|118.09|Fuel - Feb.15th
2026-02-10|out|Courier Plus|33.65|Invoice 93603
2026-02-09|in|AARON LECKIE|200.00|Invoice 0540 Leckie
2026-02-09|out|Jeremy Elliott|118.09|Fuel - Feb.8
2026-02-07|in|JEREMY ELLIOTT|387.48|Truck Payment- Feb.6th
2026-02-03|in|STEVEN BENEDETTI|450.00|
2026-02-02|out|Jeremy Elliott|128.09|Fuel - Jan.30th
2026-01-31|out|Ethan Lamoureux|140.00|
2026-01-30|in|Dave Barselaar|20.00|Barselaar, 2 x senior extenders
2026-01-30|in|JEREMY ELLIOTT|345.00|Keener Stick (LH,92M,85,white) and Gibby gift stick (52in,LH,92M,25,white)
2026-01-26|in|JEREMY ELLIOTT|387.48|truck Payment- Jan.23
2026-01-25|in|CHARITY KOREN CHAMBERS|24.00|
2026-01-25|in|Patrick Bonk|145.00|
2026-01-24|in|JONATHAN MERKLEY|370.00|
2026-01-23|in|JORDAN THOMAS|10.00|
2026-01-22|out|Ethan Lamoureux|140.00|
2026-01-22|in|JEREMY ELLIOTT|230.00|Insurance - Jan.20
2026-01-22|out|Jeremy Elliott|130.48|Fuel - Jan.20th
2026-01-17|in|Paul Edmonds|175.00|
2026-01-17|in|GLEN MARSHALL|225.00|
2026-01-16|out|Ethan Lamoureux|200.00|
2026-01-16|in|1000233 ONTARIO LIMITED|1356.00|inv#00561
2026-01-15|in|JEREMY ELLIOTT|387.48|Truck Payment- Jan.9th
2026-01-15|in|KAREN E HANSHAW|225.00|
2026-01-14|in|Paul|155.00|
2026-01-13|out|Jeremy Elliott|128.09|Jer fuel - Jan.07
2026-01-09|out|Ethan Lamoureux|140.00|On Ice
2026-01-07|in|JEREMY ELLIOTT|387.48|Truck Payment- Dec.29th
2026-01-03|in|JOSHUA CAMPBELL|205.00|new twig for soupy
2026-01-02|in|Katrina Aarts|225.00|
2026-01-02|in|ALICE WEBBER|30.00|
2025-12-31|in|JORDAN THOMAS|225.00|
2025-12-30|in|KERRI HAVENS|232.00|2 sticks
2025-12-28|out|Jeremy Elliott|125.51|Fuel - Dec.27th
2025-12-27|in|Blair Keating|10.00|tilt red grip(jer)
2025-12-26|in|Dave Barselaar|10.00|Barselaar stick topper
2025-12-26|in|JEREMY ELLIOTT|248.33|Elliott Costco total - Dec.11
2025-12-26|in|JEREMY ELLIOTT|220.00|Cola gift stick - 66in/T92/85/SILVER Lazer
2025-12-26|in|JEREMY ELLIOTT|150.00|McHardy - Dougy's 54in/T92/30/White w X1 black + grip + engraving
2025-12-25|in|KURTIS HEGGIE|225.00|
2025-12-22|in|JEREMY ELLIOTT|50.00|2 sweaters - Scotty Brown
2025-12-22|in|JEREMY ELLIOTT|230.00|Truck Ins. Payment- Dec.
2025-12-22|out|Jeremy Elliott|98.89|Fuel - Dec.18
2025-12-19|out|Ethan|67.00|Taxes/Duty for OPP jerseys order
2025-12-17|in|JEREMY ELLIOTT|387.48|Truck Payment- Dec.12
2025-12-17|in|NANCY HALL-JUPP|20.00|Extender fee.
2025-12-17|in|NANCY HALL-JUPP|245.00|P28 85 flex
2025-12-16|in|JEREMY ELLIOTT|50.00|J.Powers - padded shirt
2025-12-16|in|JEREMY ELLIOTT|100.00|Gibb - Jr stick
2025-12-15|in|WOODSTOCK NAVY VETS U10 A/AA|1269.00|invoice 542 Courtney Champeau
2025-12-15|in|CHRISTOPHER COOK|400.00|McGuire x 4
2025-12-10|in|W WILLIAM W KRAMER|190.00|
2025-12-08|out|Jeremy Elliott|82.09|Fuel - Dec.6th
2025-12-06|in|PAUL ELGIE|205.00|
2025-12-06|in|CAREY CAMPBELL|316.40|
2025-12-04|in|curtis murray|60.00|Nicole Murray Lakers blanket
2025-12-04|in|Kent Lucier|990.29|INV-00552
2025-12-04|in|Kent Lucier|900.00|INV-00552
2025-12-02|in|SUZANNE TAYLOR-WALL|60.00|
2025-11-30|in|JEREMY ELLIOTT|387.48|Truck Payment- Nov.28
2025-11-28|in|JEFF DONE|50.00|Jeff Done - Gloves
2025-11-28|in|Colin Urquhart|150.00|
2025-11-28|in|Alvinston Killer Bees|5530.00|Alvinston Killer Bees invoice 00542
2025-11-28|in|ADAM BROPHY|67.77|3 mini sticks. Adam brophy. inv-00550
2025-11-27|in|HOLLY MATTHEWS|60.00|HPL blanket
2025-11-27|out|Ethan Lamoureux|150.00|Nazim Kadri Tournament
2025-11-25|in|JEREMY ELLIOTT|235.00|insurance payment Nov.20
2025-11-25|in|Dave Harrison|60.00|HPL blanket Cynthia Harrison
2025-11-25|in|MICHAEL GILPIN|155.00|wesley gilpin stick
2025-11-24|out|Jeremy Elliott|138.89|Fuel - Nov.23
2025-11-23|in|VICTORIA YAHBEE|120.00|Payment for two blankets. Thank you!
2025-11-21|in|BRANDON K MCCOY|245.00|pranger stick
2025-11-20|in|DANIELLE COLAFRANCESCHI|80.00|Alex Cola
2025-11-20|in|KEEGAN KNIGHT|30.00|
2025-11-19|in|TERRY WICKHAM|254.25|Thanks Chris
2025-11-19|in|TRUDY M NICHOLS|896.70|Balance of Invoice 00491 - Ryan Nichols - Custom Sticks. Thank you.
2025-11-17|in|JEREMY ELLIOTT|225.00|S.Hutchinson stick - RH/Sr/T90/85 flex serial #H2508-04914
2025-11-17|out|Jeremy Elliott|79.08|Fuel - Nov.15
2025-11-14|in|JEREMY ELLIOTT|387.48|Truck payment - Nov.14th
2025-11-13|in|MELISSA MCCANN|120.00|
2025-11-11|out|Jeremy Elliott|138.09|Fuel - Nov. 9th
2025-11-11|in|CRAIG BROWNE|320.00|
2025-11-10|in|JEREMY ELLIOTT|387.48|Truck Payment- Oct.31
2025-11-09|in|BRITTANY VERSAEVEL|50.00|Vets Blanket
2025-11-09|in|Caitlin Gillen|460.00|
2025-11-09|in|JOSHUA CAMPBELL|200.00|stick for Lachlan
2025-11-08|in|ASHLYNN READ|376.00|
2025-11-06|in|JEREMY ELLIOTT|220.00|Lucas Vick - RH/T90/85 flex?/SILVER Lazer
2025-11-06|in|JEREMY ELLIOTT|130.00|From Lucas Vick - gloves
2025-11-03|in|KATRINA ROBERTS|60.00|
2025-11-03|in|Scott Parker|225.00|Jaylyn's stick
2025-11-02|out|Jeremy Elliott|118.09|Fuel - Nov.1st
2025-11-02|in|JEREMY ELLIOTT|225.00|P.Conlin - 66in/LH/T92/75 flex/X1 Lazer Silver
2025-11-02|in|JEREMY ELLIOTT|250.00|Shawn Vosper - 72in/LH/T28/90 flex
2025-10-31|in|RYAN BAKER|60.00|Lawson Baker Huron Perth Lakers Blanket
2025-10-31|in|JEREMY ELLIOTT|100.00|D.Wall - Devillettes stick for Everly
2025-10-31|in|ORLA WOOD|60.00|HPLs blanket, thx!
2025-10-31|in|Kristy Thorogood|1240.00|warm up gear
2025-10-29|in|JOSHUA CAMPBELL|205.00|stick for soupy
2025-10-28|in|U15A MOUNT BRYDGES COUGARS|940.00|INV-00534 Mount Brydges Cougars
2025-10-28|in|LORI RUSSELL|60.00|Lakers Blanket-Lori Russell
2025-10-28|in|REBECCA GOODWIN|60.00|Myles Alge hockey blanket HPL
2025-10-27|out|Jeremy Elliott|120.89|Fuel - Oct.23
2025-10-24|in|ANDREW J MCCALLUM|220.00|For stick
2025-10-23|out|Lucan Minor Hockey|145.00|TILT Hockey Fundraising contribution from Photo night.
2025-10-19|in|SHAUN M DORRESTYN|40.00|Dorrestyn blanket
2025-10-19|out|Jeremy Elliott|88.90|Fuel - Oct.17
2025-10-18|in|JEREMY ELLIOTT|387.48|Truck Payment Oct.17
2025-10-18|out|Jeremy Elliott|2000.00|Ashton Hockey Sponsorship - '24-'25 and '25-'26
2025-10-18|in|DANIEL RICHARD|63.28|canucks day
2025-10-18|in|GRANT ELLIGSEN|155.00|# INV-00530 Grant Elligsen
2025-10-16|in|1000233 ONTARIO LIMITED|1186.50|Inv# INV-00531
2025-10-15|in|Brianne Ernewein|80.00|Ernewein blankets
2025-10-14|in|CHAD MORRISON|90.00|
2025-10-14|in|Leanne Scott|90.00|
2025-10-14|in|PATRICIA LEAH GILLIS|60.00|
2025-10-14|in|RHIAN LIBERATORE|60.00|
2025-10-14|in|ALICIA TRUSDALE|60.00|
2025-10-14|in|REBECCA NOBLE|60.00|
2025-10-14|in|MALLORY DOW|60.00|Mallory Dow blanket
2025-10-14|in|NICOLE VAN DOOREN|75.00|
2025-10-12|in|Nikki|120.00|walt- 4 mini sticks
2025-10-12|in|BRENDA J GUSTAVSON|25.00|Gustavson- emc hoodie
2025-10-12|in|BRENDA J GUSTAVSON|40.00|blanket-Gustavson
2025-10-12|in|JEREMY ELLIOTT|155.00|Scott Moir - gloves
2025-10-12|in|JESSICA E BUTT|50.00|
2025-10-11|in|Katie Uniac|30.00|
2025-10-10|in|AMRITPAL SINGH GREWAL|40.00|grewal
2025-10-10|out|Jeremy Elliott|98.41|Fuel - Oct.10
2025-10-10|out|Jeremy Elliott|203.29|bins for product storage
2025-10-10|in|TROY TRAVIS|40.00|For Malcolm Travis blanket
2025-10-10|in|KYLE SMITH|40.00|Jagger Smith - EMC Blanket
2025-10-10|in|MARANDA KING|40.00|King blanket
2025-10-10|in|JEFFREY G CROW|40.00|Carter Crow EMC blanket
2025-10-10|in|Adam Hill|40.00|Hill Blanket
2025-10-10|in|CAYLE R ST CROIX|40.00|cole stcroix blanket
2025-10-09|in|TREVMAR CONSTRUCTION INC|300.00|For tilt jersey sponsor. Boersma
2025-10-05|in|JEREMY ELLIOTT|387.48|Truck Payment Oct.3
2025-10-05|out|Jeremy Elliott|128.09|Fuel - Oct.4
2025-10-03|in|Chris|182.21|INV-00528
2025-10-03|in|RYAN ILYA NICHOLS|320.00|
2025-10-02|in|ben gustavson|173.74|Brooke Gustavson
2025-10-01|in|KERRI HAVENS|378.27|
2025-10-01|in|S. R. JOSEPH MEDICINE|300.00|sponsorship
2025-09-30|in|JEREMY ELLIOTT|175.00|Sean Attridge - 60in/RH/T92/55 flex/Black with X1 Orange
2025-09-30|in|LISA LAMONT|50.00|Lisa Lamont - 1 Lakers blanket
2025-09-29|in|CAYLE R ST CROIX|25.00|caylest.croix
2025-09-28|out|Jeremy Elliott|128.30|Fuel - Sept.26
2025-09-24|in|JEREMY ELLIOTT|105.00|3 x Engraved Tumblers for 2 Section
2025-09-24|in|JEREMY ELLIOTT|235.00|Insurance payment for Set.22 deduction
2025-09-24|in|JESSE ROBINSON|300.00|thanks for organizing
2025-09-24|in|CHRISTOPHER STANDISH|170.00|Chris Standish WHL
2025-09-24|in|JORDAN GALBRAITH|170.00|Spare jersey - Galbraith
2025-09-22|in|Blair Keating|155.00|Preston stick
2025-09-21|in|Adam Hill|25.00|Hilly Hoodie
2025-09-21|in|JEREMY ELLIOTT|387.48|Truck Payment - Sept.19
2025-09-18|out|Jeremy Elliott|98.09|Fuel - Sept.18
2025-09-18|in|STEVEN JOSEPH|410.01|
2025-09-18|in|STEVEN JOSEPH|199.22|Landon stick
2025-09-16|in|U15A MOUNT BRYDGES COUGARS|1880.00|U15A Blankets Fundraiser
2025-09-14|out|Jeremy Elliott|109.68|Fuel - Sept.12
2025-09-11|in|CHRISTOPHER COOK|150.00|Warren
2025-09-09|out|Chris|1000.00|Asher emc sponsorship
2025-09-09|in|JEREMY ELLIOTT|220.00|Bill Simpson stick - LH T92 75 White Base Black X1
2025-09-07|out|Brad Esler - B4 Mktg|118.19|Fuel - Sept.6
2025-09-07|in|JEREMY ELLIOTT|387.48|Truck Payment - Friday, Sept.5
2025-09-05|in|JEREMY ELLIOTT|235.00|insurance payment for Aug.20th deduction
2025-09-04|in|MOIR'S SKATE SHOP|3606.96|INVOICE: INV-00513
2025-09-02|in|DANIEL RICHARD|173.74|inv 00509
2025-09-01|in|BRENT THOMAS|175.15|
2025-09-01|out|Jeremy Elliott|134.89|Fuel - Aug.29
2025-08-29|out|EMC Treasurer|500.00|Golf Tournament Sponsorship - Tilt Hockey
2025-08-28|out|Jeremy Elliott|63.28|TILT banner for Pete's
2025-08-27|in|DAVID CROSSAN|528.28|
2025-08-23|in|JEREMY ELLIOTT|205.00|Dave (Sam) McCarthy - 58in LH T28 55 flex Black with White X1
2025-08-23|in|JEREMY ELLIOTT|387.48|Ford Lease payment
2025-08-23|out|Jeremy Elliott|95.19|Fuel - Aug. 22
2025-08-21|in|JEREMY ELLIOTT|290.00|McHardy 72in stick
2025-08-21|in|Nathan Jeffrey|173.74|Invoice: 00507
2025-08-17|in|JEREMY ELLIOTT|150.00|Grayson Goarley stick - 54in T28 35 flex Black with Green X1 serial #2412-07704
2025-08-17|out|Jeremy Elliott|92.98|Fuel - August 16th
2025-08-15|in|Ryan Smith|131.45|
`;

function parseRegister(): TransferEntry[] {
  const out: TransferEntry[] = [];
  for (const line of REGISTER_RAW.split("\n")) {
    const row = line.trim();
    if (!row) continue;
    const [date, direction, counterparty, amount, ...memoParts] = row.split("|");
    const parsedAmount = Number(amount);
    if (!date || !Number.isFinite(parsedAmount)) continue;
    out.push({
      date,
      direction: direction === "out" ? "out" : "in",
      counterparty: (counterparty ?? "").trim(),
      amount: parsedAmount,
      memo: memoParts.join("|").trim(),
    });
  }
  return out;
}

export const TRANSFER_REGISTER: TransferEntry[] = parseRegister();

/**
 * Find the register entry for a bank line by amount + date proximity.
 * Deliberately direction-AGNOSTIC: the feed's debit/credit flag is unreliable
 * on Interac lines, and the register is the bank's own record of which way the
 * money moved — so a unique amount+date hit settles the direction too.
 * Returns null when there's no hit or the match is ambiguous.
 */
export function findTransfer(
  amount: number,
  isoDate: string,
  windowDays = 4
): TransferEntry | null {
  if (!Number.isFinite(amount) || !isoDate) return null;
  const t = new Date(isoDate).getTime();
  if (Number.isNaN(t)) return null;
  const hits = TRANSFER_REGISTER.filter(
    (e) =>
      Math.abs(e.amount - amount) < 0.005 &&
      Math.abs(new Date(e.date).getTime() - t) <= windowDays * 86_400_000
  );
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) return null;
  // Several same-amount transfers nearby (e.g. two $387.48 truck payments):
  // take the closest date, but only if it's unambiguously closer.
  const sorted = hits
    .map((e) => ({ e, d: Math.abs(new Date(e.date).getTime() - t) }))
    .sort((a, b) => a.d - b.d);
  return sorted[0].d < sorted[1].d ? sorted[0].e : null;
}

/**
 * Repeat items, computed from the register — so Penny recognises the regulars
 * (truck payment, insurance, fuel, the on-ice contractor) on sight instead of
 * asking about each occurrence. Facts only: who, which way, how often, typical
 * amount, and a sample memo. The accounting treatment stays Chris's call.
 */
export function renderRecurringPatterns(minCount = 3): string {
  const groups = new Map<string, TransferEntry[]>();
  for (const e of TRANSFER_REGISTER) {
    // Group by counterparty + direction + the memo's leading keyword, so
    // "Fuel - Mar.14th" and "Fuel - Oct.4" collapse into one pattern.
    const keyword =
      e.memo
        .toLowerCase()
        .replace(/[^a-z ]/g, " ")
        .trim()
        .split(/\s+/)[0] ?? "";
    const key = `${e.counterparty.toLowerCase()}|${e.direction}|${keyword}`;
    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }

  const lines: string[] = [];
  for (const list of groups.values()) {
    if (list.length < minCount) continue;
    const first = list[0];
    const amounts = list.map((e) => e.amount);
    const min = Math.min(...amounts);
    const max = Math.max(...amounts);
    const amountText =
      Math.abs(max - min) < 0.005
        ? `always $${min.toFixed(2)}`
        : `$${min.toFixed(2)}–$${max.toFixed(2)}`;
    const sampleMemo = list.find((e) => e.memo)?.memo ?? "(no memo)";
    lines.push(
      `- ${first.counterparty} — money ${first.direction === "in" ? "IN" : "OUT"} — ${list.length}× — ${amountText} — e.g. "${sampleMemo.slice(0, 70)}"`
    );
  }
  lines.sort();

  return [
    "=== RECURRING E-TRANSFERS (from the bank's transfer register) ===",
    "These repeat regularly. Recognise them on sight; only ask when the treatment is genuinely undecided.",
    ...lines,
    "=== END RECURRING ===",
  ].join("\n");
}
