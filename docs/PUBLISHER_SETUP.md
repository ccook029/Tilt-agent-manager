# Publisher Setup — Instagram, Facebook, TikTok

Step-by-step guide to getting the three platform credentials the publisher
needs. Written for Chris — no developer experience assumed. When you're done,
the three cards at the top of **/publish** turn green and one-tap posting
goes live. Until then, everything is a safe no-op.

---

## Part 1 — Instagram + Facebook (one Meta setup covers both)

**What you end up with:** three values in Vercel — `META_ACCESS_TOKEN`,
`META_IG_USER_ID`, `META_FB_PAGE_ID`.

**Prerequisites (check these first):**
- A **Facebook Page** for Tilt Hockey (not a personal profile) that you admin.
- The Tilt **Instagram account converted to a Business (or Creator) account**
  and **linked to that Facebook Page**. Check in the Instagram app:
  Settings → Account type and tools. Link it via Settings → Business tools →
  Connect a Facebook Page.

### Steps

1. **Create the Meta app.** Go to **developers.facebook.com** → log in with
   the Facebook account that admins the Tilt Page → My Apps → **Create App**
   → use case: **Other** → type: **Business**. Name it "Tilt Publisher".
2. **Get a User token with the right permissions.** In the app dashboard,
   open **Tools → Graph API Explorer**:
   - "Meta App": select Tilt Publisher.
   - "User or Page": select **User Token**.
   - Add permissions: `pages_show_list`, `pages_read_engagement`,
     `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`,
     `business_management`.
   - Click **Generate Access Token** and approve the popup (make sure you
     grant access to the Tilt Page and Instagram account when asked).
3. **Make the token long-lived.** The Explorer token dies in ~an hour. Open
   **Tools → Access Token Debugger**, paste the token, press **Debug**, then
   press **Extend Access Token** (bottom) — this gives a ~60-day token.
4. **Get the Page ID and Page token.** In Graph API Explorer, with your
   extended token, run `GET me/accounts`. In the response find the Tilt
   Hockey page — copy its `id` (that's **`META_FB_PAGE_ID`**) and its
   `access_token` (**this Page token is what goes in `META_ACCESS_TOKEN`** —
   Page tokens obtained from a long-lived user token don't expire).
5. **Get the Instagram user ID.** Still in the Explorer, run
   `GET {PAGE_ID}?fields=instagram_business_account` (swap in the Page id).
   The `instagram_business_account.id` in the response is **`META_IG_USER_ID`**.
6. **Add to Vercel.** Project → Settings → Environment Variables:
   `META_ACCESS_TOKEN`, `META_IG_USER_ID`, `META_FB_PAGE_ID` → redeploy.
7. **Verify:** open **/publish** — Instagram and Facebook should show green.

**Gotchas**
- **App review:** while the app is in Development mode, publishing works for
  accounts with a role on the app (you). That's fine for Tilt posting to its
  own accounts. If Meta ever blocks a call with a permissions error, add
  yourself under App Roles, or submit the two Instagram permissions for App
  Review (takes a few days).
- **Media must be public URLs.** The publisher posts your rendered media from
  Vercel Blob, which is public — nothing to do here, just don't switch Blob
  to private.
- Instagram API can't post **Stories** this way, only feed posts and Reels.

## Part 2 — TikTok

**What you end up with:** `TIKTOK_ACCESS_TOKEN` in Vercel (and later,
`TIKTOK_PRIVACY_LEVEL=PUBLIC_TO_EVERYONE`).

TikTok is the slow one — their **Direct Post approval takes days to weeks**,
so start it early and let it run in the background.

### Steps

1. **Create a developer account and app.** Go to
   **developers.tiktok.com** → Register (log in with the Tilt TikTok
   account) → Manage apps → **Connect an app**. Name it "Tilt Publisher".
2. **Add the Content Posting API product** to the app, and enable
   **Direct Post** configuration.
3. **Verify the media domain.** In the app's URL properties, add and verify
   the domain your rendered videos are served from (the Vercel Blob domain,
   e.g. `*.public.blob.vercel-storage.com`, or tilthockey.com if we proxy
   media through the site — I can wire that if TikTok rejects the Blob
   domain).
4. **Request scopes** `user.info.basic` and `video.publish`, and submit the
   app for review. In the review form, describe it honestly: "Posts Tilt
   Hockey's own marketing videos to Tilt Hockey's own TikTok account,
   human-approved before posting."
5. **Add the redirect URI.** In the app's Login Kit settings, set the
   redirect URI to exactly:
   `https://YOUR-HQ-DOMAIN/api/publish/tiktok/callback`
   (your deployed Tilt HQ domain).
6. **Add the app keys to Vercel:** `TIKTOK_CLIENT_KEY` and
   `TIKTOK_CLIENT_SECRET` (both shown on the app's page) → redeploy.
7. **Connect (one click).** Once TikTok approves the app, open **/publish**
   and tap **Connect TikTok** on the TikTok card — log in as the Tilt
   account, approve, and you land back on /publish with the card green.
   Tokens auto-refresh from then on; no manual token handling.
8. Leave `TIKTOK_PRIVACY_LEVEL` unset at first — posts go up as
   **SELF_ONLY** (only the account sees them) so you can safely test
   end-to-end; set it to `PUBLIC_TO_EVERYONE` when you're happy.

**Gotchas**
- Unaudited apps can ONLY post SELF_ONLY. Public posting requires the audit
  in step 4 to be approved.
- TikTok tokens expire (24h, refreshed via refresh token). Phase 5 wires
  automatic refresh; until then the token needs occasional re-auth.
- TikTok accepts **video only** through this API — image posts stay
  IG/FB-only.

## Part 3 — Search Console for Sage (5 minutes, do this now)

You've already verified tilthockey.com — two small steps make the data flow:

1. In **search.google.com/search-console** → Settings → **Users and
   permissions** → Add user → paste the **service account email** from our
   GA4 setup (it's the `client_email` inside the credentials JSON — looks
   like `something@project-id.iam.gserviceaccount.com`) → permission:
   **Full**.
2. In Vercel, set **`GSC_SITE_URL`** to exactly how the property appears in
   the Search Console property dropdown: `sc-domain:tilthockey.com` for a
   domain property, or `https://tilthockey.com/` for a URL-prefix property.

After the next deploy, Sage's SEO audits use real Google query data
automatically.
