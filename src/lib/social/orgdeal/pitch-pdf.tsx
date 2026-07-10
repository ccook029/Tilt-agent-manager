// ---------------------------------------------------------------------------
// pitch-pdf.tsx — the org-facing stick program one-pager.
//
// Print-ready, email-attachable PDF built with @react-pdf/renderer (same stack
// as the analytics report in src/lib/pdf.tsx). This is the FULL-DETAIL piece:
// member discount, club kickback, deadline, one-batch delivery, and the boxed
// MAP note (share the discount by email, never publicly). The org crest is
// embedded as a real image — never AI-drawn.
// ---------------------------------------------------------------------------
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import path from "path";
import sharp from "sharp";
import { BRAND } from "@/lib/social/brand";
import { formatDeadline } from "@/lib/social/fundraiser/generate";
import type { OrgStickDeal, OrgDealPitch } from "@/lib/social/db/schema";

const TILT_LOGO_PATH = path.join(process.cwd(), "public", "images", "tilt-logo.png");

const C = {
  black: "#0D0D0D",
  dark: "#15181C",
  cyan: BRAND.colors.cyan,
  gray: "#4A4A4A",
  lightGray: "#E5E7EB",
  white: "#FFFFFF",
};

const styles = StyleSheet.create({
  page: {
    padding: 44,
    paddingTop: 34,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: C.dark,
    lineHeight: 1.45,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: 10,
    marginBottom: 18,
    borderBottomWidth: 3,
    borderBottomColor: C.black,
  },
  tiltLogo: { width: 96, height: 26, objectFit: "contain" },
  headerTag: {
    fontSize: 8,
    letterSpacing: 2,
    color: C.gray,
    textTransform: "uppercase",
  },
  lockupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  crestBox: {
    width: 56,
    height: 56,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: C.lightGray,
    padding: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  crest: { width: 44, height: 44, objectFit: "contain" },
  orgName: { fontSize: 20, fontFamily: "Helvetica-Bold", color: C.black },
  orgSub: { fontSize: 9, color: C.gray, marginTop: 2 },
  headline: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
    color: C.black,
    marginBottom: 6,
  },
  intro: { fontSize: 10.5, color: C.gray, marginBottom: 14 },
  statsRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  stat: {
    flex: 1,
    backgroundColor: C.black,
    borderRadius: 8,
    padding: 10,
    borderTopWidth: 3,
    borderTopColor: C.cyan,
  },
  statValue: { fontSize: 15, fontFamily: "Helvetica-Bold", color: C.white },
  statLabel: {
    fontSize: 7,
    letterSpacing: 1,
    color: "#9CA3AF",
    textTransform: "uppercase",
    marginTop: 3,
  },
  sectionTitle: {
    fontSize: 9,
    letterSpacing: 2,
    color: C.gray,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  bulletRow: { flexDirection: "row", marginBottom: 8, gap: 8 },
  bulletMark: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: C.cyan,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  bulletMarkText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.black },
  bulletTitle: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: C.black },
  bulletDetail: { fontSize: 9.5, color: C.gray, marginTop: 1 },
  mapBox: {
    marginTop: 6,
    marginBottom: 14,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
    borderLeftWidth: 4,
    borderLeftColor: C.cyan,
  },
  mapTitle: {
    fontSize: 8.5,
    letterSpacing: 1.5,
    fontFamily: "Helvetica-Bold",
    color: C.black,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  mapText: { fontSize: 9.5, color: C.gray },
  closing: { fontSize: 10.5, color: C.dark, marginBottom: 6 },
  linkLine: { fontSize: 10, fontFamily: "Helvetica-Bold", color: C.black },
  footer: {
    position: "absolute",
    bottom: 26,
    left: 44,
    right: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: C.lightGray,
    paddingTop: 8,
  },
  footerText: { fontSize: 8, color: C.gray },
});

export type PitchPdfInput = {
  deal: OrgStickDeal;
  pitch: OrgDealPitch;
  /** Raw uploaded crest bytes; embedded as PNG. Null = text-only lockup. */
  orgLogo: Buffer | null;
};

export async function renderPitchPdf(input: PitchPdfInput): Promise<Buffer> {
  const { deal, pitch } = input;

  // Normalize whatever was uploaded (JPEG/WebP/PNG) to PNG for react-pdf.
  let crestSrc: string | null = null;
  if (input.orgLogo) {
    const png = await sharp(input.orgLogo).png().toBuffer();
    crestSrc = `data:image/png;base64,${png.toString("base64")}`;
  }

  const deadlineLong = formatDeadline(deal.deadline);
  const deliveryLong = deal.deliveryDate ? formatDeadline(deal.deliveryDate) : null;

  const doc = (
    <Document
      title={`${deal.orgName} × Tilt Hockey — Stick Program`}
      author={BRAND.name}
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Image src={TILT_LOGO_PATH} style={styles.tiltLogo} />
          <Text style={styles.headerTag}>Organization Stick Program</Text>
        </View>

        <View style={styles.lockupRow}>
          {crestSrc && (
            <View style={styles.crestBox}>
              <Image src={crestSrc} style={styles.crest} />
            </View>
          )}
          <View>
            <Text style={styles.orgName}>
              {deal.orgName} <Text style={{ color: C.cyan }}>× TILT HOCKEY</Text>
            </Text>
            <Text style={styles.orgSub}>
              Prepared for {deal.contactName?.trim() || deal.orgName} ·{" "}
              {new Date().toLocaleDateString("en-CA", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </Text>
          </View>
        </View>

        <Text style={styles.headline}>{pitch.headline}</Text>
        <Text style={styles.intro}>{pitch.intro}</Text>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{deal.discountPct}% off</Text>
            <Text style={styles.statLabel}>Member pricing on sticks</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{deal.kickbackPct}% back</Text>
            <Text style={styles.statLabel}>To the club, on net sales</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{deadlineLong}</Text>
            <Text style={styles.statLabel}>Ordering closes</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{deliveryLong ?? "+6 weeks"}</Text>
            <Text style={styles.statLabel}>
              {deliveryLong ? "Delivered to the club" : "Club delivery after close"}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>How the program works</Text>
        {pitch.bullets.map((b, i) => (
          <View key={i} style={styles.bulletRow} wrap={false}>
            <View style={styles.bulletMark}>
              <Text style={styles.bulletMarkText}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bulletTitle}>{b.title}</Text>
              <Text style={styles.bulletDetail}>{b.detail}</Text>
            </View>
          </View>
        ))}

        <View style={styles.mapBox} wrap={false}>
          <Text style={styles.mapTitle}>
            Sharing the discount — please read (MAP policy)
          </Text>
          <Text style={styles.mapText}>{pitch.mapNote}</Text>
        </View>

        <Text style={styles.closing}>{pitch.closing}</Text>
        {deal.orderUrl?.trim() && (
          <Text style={styles.linkLine}>
            Your club&apos;s private ordering page: {deal.orderUrl.trim()}
          </Text>
        )}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {BRAND.name} · chris@tilthockey.com · tilthockey.com
          </Text>
          <Text style={styles.footerText}>Don&apos;t be a sheep.</Text>
        </View>
      </Page>
    </Document>
  );

  return Buffer.from(await renderToBuffer(doc));
}
