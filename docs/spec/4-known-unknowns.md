## 4. Known unknowns

1. That each expected Expo library has a version for SDK 57.
2. What `expo-image-manipulator` keeps of a photo's metadata (the segment
   check of 3.3 guards the result either way). The phone's own encoder
   writes the JPEG, so this can be checked only on a phone, in Adam's test
   session (Crog, #14). Settled in Phase 1 for Adam's camera photos
   only: they were analysed in his test session, so they passed the
   segment check (PBI-1.11, 2026-11-09).
   Not so for a gallery photo. In his Phase 2 test session, on
   2026-11-16 at 08:39, a find failed with the message for an APP1
   segment (Adam's screenshot); by his account the photo was taken with
   the phone's camera app and picked from the gallery in the app. The
   app shows that message only when the first thing the check refused
   in the encoder's JPEG was an APP1 segment. Not known: whether it
   held EXIF or XMP, what was in it, and whether anything else the
   check refuses followed it; the check stops at its first refusal, and
   the stored detail holds only the reason and the marker. Why his
   camera photos passed and this photo did not is not known either.
   Since the strip (3.3; Adam, 2026-11-16 08:42) a photo can be analysed
   whichever application segments, comments or bytes after the end of
   the image the encoder writes; what it writes is still seen only on a
   phone. Open:
   - whether the encoder's pixels are already upright, so that removing
     an EXIF orientation tag with APP1 turns no photo: **[not checked]**
     on a phone. Read on 2026-11-16, not run: the app's own code applies
     no orientation; in `expo-image-manipulator` 57.0.22, on iOS the
     photo is redrawn upright when it is loaded, and on Android the
     library reads no EXIF itself, loads the photo through Glide
     (`expo-image-loader` 57.0.1) and saves the resized bitmap with the
     platform's `Bitmap.compress`; Glide's reference says its decoder
     rotates by the EXIF orientation (read for version 4.14, not for
     the 5.0.5 the loader names). The library's type definitions say
     nothing of orientation. The strip's author checks it, and Adam on
     his phone;
   - whether an encoder writes an Adobe APP14 segment for a picture
     that is not YCbCr or grey. The segment tells a decoder the colour
     transform, and the strip removes it with the other APPn, so such a
     picture's colours can change, where the check alone refused the
     photo. Read on 2026-11-16, not run, and not in the versions an
     Android release ships: Android's `Bitmap.compress` encodes through
     Skia and libjpeg-turbo, which there write YCbCr or grey, with a
     JFIF header and no Adobe segment; iOS not read. **[not checked]**
     on a phone;
   - what the strip does with a marker the check refuses that is
     neither an application segment nor a comment (JPG and JPGn, DHP,
     EXP, DNL, TEM, a restart marker outside a scan, the reserved
     markers): not decided; 3.3 has the strip pass a JPEG that holds
     one on unchanged, so the check fails the photo (**[Clead]**).
     Whether a phone's encoder writes one is not known.
3. How the database and photos are excluded from iOS backups under Expo,
   and the Android data extraction rules (3.6). Android settled in #21;
   iOS needs native code (PBI-1.23). Android lint's `FullBackupContent`
   check did not stop the first release build (PBI-1.10, 2026-11-09):
   it finished, and Adam found no `FullBackupContent` in its log. The
   excludes have carried `tools:ignore` since #40, so the log cannot show
   what lint would do without it. The question is moot while they carry it.
4. The default model, chosen at the build.
5. EAS Build's setup for this project (its project ID and build profile).
   Settled: the Expo project `factoincognito/what-mushroom-is-this` (#42;
   its owner since #39) and the `preview` profile (#40), with which the
   first build was made (PBI-1.10).
6. A library for the network state, which the queue's "network is back"
   trigger needs (3.4). Settled for #17:
   `expo-network`, not NetInfo, whose reachability check can send a
   request to a Google server, against section 2 (**[Clead]**).
7. Whether a gallery photo's position arrives on Android. Android's
   documentation says reading it needs the `ACCESS_MEDIA_LOCATION`
   permission, and `expo-image-picker` does not ask for it, so it most
   likely does not (Crog's reading of the documentation and the library's
   source for #14, 2026-11-09). Not tested in Adam's Phase 1 test session
   (PBI-1.11); to be checked in his Phase 2 test session (PBI-2.11). If it
   does not arrive, PBI-1.18 is the remedy.
8. Whether a user's API key can be one that needs the
   `anthropic-workspace-id` header, which the API documentation says a key
   not scoped to a workspace needs (Crog's reading for PBI-1.4, checked
   against the "Authentication" page on 2026-11-09 for PBI-1.13); the app
   does not send it, and handles that answer as 401, 403 (3.3).
9. Whether a request keeps to the 60-second time limit while the model
   thinks, which on the current models it always may (PBI-1.14). If not, a
   find times out, stays waiting and is sent again at each run; the time
   limit is then the setting to change (Clead-role reviewer on #15).
   Settled: in Adam's test session analyses took under 30 seconds and none
   timed out (PBI-1.11, 2026-11-09).
10. Whether the phone's position fixes arrive on Android while the camera
    app is in front: `expo-location` stops its updates when the app goes
    to the background (the Clead-role reviewer's reading of its source for
    #16). If they do not, a camera find takes its position more often
    from a fix the app had before the camera opened, or from the last
    known position (3.6); a fix after the camera closes still counts
    within the 30 seconds. Not checked in Adam's Phase 1 test session
    (PBI-1.11); to be checked in his Phase 2 test session (PBI-2.11).
11. Phase 2's map (3.9). Decided by Adam, 2026-11-09 21:27, on PBI-2.1's
    findings (product office,
    `library/designs/what-mushroom-is-this/phase-2-checks.md`): MapLibre
    React Native (MIT), on MapLibre Native (BSD-2-Clause), with
    OpenFreeMap's tiles. Per the findings, OpenFreeMap needs no key and
    charges no fee; its terms allow apps, and offline downloads within
    limits; it has no SLA.
    Checked on 2026-11-09 for the build (product office, the same
    document, section 5):
    - the app's Expo, React Native and React versions are within version
      11.5.1's peer ranges; it ships an Expo config plugin; whether it
      builds on SDK 57 is left for the build;
    - no telemetry found in MapLibre Android 13.6.1 or the library's own
      source; iOS not inspected;
    - the styles: code BSD-3-Clause, design CC BY 4.0 (Positron also
      CARTO, CC BY 3.0, which would need its own credit), fonts SIL OFL
      1.1, sprites CC0;
    - on Android the cache is 50 MB by default, and the "(i)" button and
      the MapLibre logo are on by default; iOS's defaults not checked;
    - the Android User-Agent names the app by default, and the app can
      set its own; iOS not checked;
    - the vulkan flavour of MapLibre Android 13.6.1 declares the location
      permissions and `ACCESS_WIFI_STATE`; the opengl flavour, the
      plugin's default, was not checked. PBI-2.8 checks the merged
      manifest, where the app's block of `ACCESS_WIFI_STATE` must still
      hold.
12. Phase 2's request with several photos and text (3.9). Per the Claude
    API's "Vision" page, read for PBI-2.1 on 2026-11-09:
    - 100 images per request on models with a 200k context window, and 600
      on the others;
    - above 20 images, a stricter limit per image, whose value the page
      does not give; it advises at most 3,000 px a side;
    - 10 MB per image, base64, and 128 MB per request;
    - at most 8,000 × 8,000 px;
    - JPEG, PNG, GIF or WebP;
    - each image introduced by "Image 1:" and so on, the images before the
      text.
    Five photos at 3.3's sizes are within these. Settled.
13. Phase 2's library for picking from the phone's files (3.9)
    (**[Clead]**, on PBI-2.1's findings): `expo-document-picker`, with
    `type: 'image/*'` and
    `copyToCacheDirectory` on, so that `expo-image-manipulator` reads a
    local file; the copy then goes into the app's photo store. Its
    `lastModified` is never used as the photo's time. To be checked on
    the phone: `content://` sources, and HEIC and SVG files (PBI-2.6).
14. Whether resizing up to five photos for one request (one at a time,
    3.9) brings back the low-memory load failures PBI-1.25 was written
    for, on Adam's phone.
15. Phase 2's representative picture (3.9).
    Adam decided on 2026-11-09 21:27, on PBI-2.1's findings:
    - Wikimedia's API terms are accepted;
    - the pictures are limited to CC0, public domain without a country
      limit, CC BY and CC BY-SA.
    From PBI-2.1's findings, with Clead's choices marked:
    - the lookup: the Wikidata item by P225 (taxon name), its image, P18,
      then the Commons file's thumbnail URL, author, licence and page
      (**[Clead]**); a check that the item's rank, P105, is species
      (**[Clead]**; it does not settle the homonyms found, below);
    - thumbnails at Wikimedia's standard widths only, since other widths
      are rate-limited (**[Clead]**);
    - a User-Agent that names the app, its version and the repository's
      URL, as Wikimedia's policy asks (**[Clead]**: the form);
    - requests one at a time, within limits of a few hundred an hour per
      phone (**[Clead]**).
    Checked on 2026-11-09 for the build (product office,
    `library/designs/what-mushroom-is-this/phase-2-checks.md`, section 5):
    - Wikimedia's policies, read on the original sites. Its rate limits
      are now 10 requests a minute by IP alone and 200 a minute with a
      User-Agent that follows its policy; "a few hundred an hour per
      phone" is within them. Clients may not hide Wikimedia as the source;
    - the calls and the metadata field names;
    - `fetch` in Expo SDK 57 sends the app's User-Agent unchanged on
      Android, from the sources, not run on a phone; ASCII only; iOS not
      checked;
    - JPEG, PNG, WebP and GIF originals give thumbnails of their own
      format, SVG gives PNG and TIFF gives JPEG; an original narrower
      than the width asked for is served as it is, in its own format;
      Wikimedia's stated type and width are not always those served;
    - among the 11,574 fungus species items with an English Wikipedia
      article and an Index Fungorum ID, 19 share their Latin name with
      another item, all fungi of the same genus, which rank and parent do
      not tell apart; the second mostly has no picture. Within that set
      no name was shared with an item outside the fungi; fungus items
      outside the set were not checked, and the search by name covers all
      of Wikidata;
    - about a third of fungus species with an English Wikipedia article
      have a picture; 20 of 20 common Nordic species sampled do.
    Settled for PBI-2.9 (**[Clead]**, 2026-11-10, #71):
    - which item when a name has several, also outside the fungi: among
      the items whose P225 is the name, ignoring case, those whose P105 is
      species; among those, the ones with a P18 that is not deprecated;
      among those, the one with the most sitelinks; with none, or with a
      tie for the most, no picture. Whether the self-check catches a
      homonym of another kingdom is not checked; one of the same genus
      it does not catch, hence no picture on a tie;
    - which picture when an item has several P18: the first of preferred
      rank, else the first of normal rank, never a deprecated one;
    - a file's licences are read from its page's licence templates,
      mapped by a table in configuration to CC0, public domain, CC BY and
      CC BY-SA (any version of CC BY and CC BY-SA, and their ports);
      public domain counts only for a configured list of templates
      without a country limit; the file's metadata gives only the
      author, the attribution text and the page;
    - the credit names Wikimedia Commons as the source and says the
      picture was resized.
    The public-domain templates' "applies worldwide" was read on copies
    (c.enwp.org, species-id.net), since WebFetch did not reach
    commons.wikimedia.org in that session; it is read on Commons before
    release (PBI-1.24).
    Before release, the IP lawyer's review covers resizing under CC
    2.x/3.0 and sending pictures to Anthropic (policy rule 6).
16. Phase 2's share target (3.9, Shared photos; PBI-2.21).
    The app on `main`, read on 2026-11-16: `app.json` sets the scheme
    `what-mushroom-is-this` and no intent filter, and none of its
    plugins takes a share; `src/app` has no `+native-intent` file, and
    no code of the app reads an incoming link; `expo-sharing` is not a
    dependency (`package.json`). A photo's time and position are read
    only from
    the tags `expo-image-picker` gives with a gallery photo
    (`src/newFind/devicePicker.ts`, `src/newFind/photoMetadata.ts`): the
    app has no reader for the tags of a file.
    Expo's SDK 57 page for `expo-sharing`
    (`docs.expo.dev/versions/v57.0.0/sdk/sharing/`), read on 2026-11-16,
    by the author through a tool that summarises a page and by the
    reviewer of #111 as the page's own text; nothing of it was run:
    - it calls receiving a share experimental;
    - its config plugin, with `android.enabled`, adds the intent filter
      to the manifest, for the MIME types in
      `android.singleShareMimeTypes` (`ACTION_SEND`) and
      `android.multipleShareMimeTypes` (`ACTION_SEND_MULTIPLE`); the
      plugin's settings take effect only in a new app binary;
    - the app reads a share with `useIncomingShare`, or with
      `getSharedPayloads` (the raw payloads: a value, for a file
      typically its URI, a share type and a MIME type) and
      `getResolvedSharedPayloadsAsync` (each resolved payload with a
      content URI, a content type, a MIME type, a size and a name), and
      drops it with `clearSharedPayloads`;
    - resolving a payload may need a network connection, depending on
      what was shared; for a shared web address the resolved payload
      holds what a request gave;
    - with Expo Router, a `+native-intent.ts` file sends an incoming
      share to a route;
    - it does not say whether that URI is the sharing app's own address
      or a copy, how long it can be read, what of a photo's metadata
      comes with it, or what differs when the share starts the app.
    `expo-sharing` is the library expected (**[Clead]**): `~57.0.26`
    per that page, MIT per npm's entry for 57.0.26, from `expo/expo`,
    `packages/expo-sharing`, used as a package. It is recorded under
    the IP policy when it is added (section 2), with what its Android
    side builds in and what its plugin adds to the merged manifest. No
    other library is proposed.
    Not known without a new native build on Adam's phone (the 0.2.0
    install cannot be used: the manifest changes):
    - which apps share a photo with its metadata, since the sharing app
      can remove it, and Android can hide the position as for a gallery
      photo (Known unknown 7);
    - how Android hands the photos over, and how long the app may read
      them: across the disclaimer, and after the app is restarted;
    - whether the app can read the tags from a shared file with code of
      its own, in which formats; where it cannot, 3.9 holds: the photo
      is as one without metadata;
    - which image formats the loader loads from a share (as Known
      unknown 13);
    - whether resolving a shared image file uses the network, and
      whether a share declared as `image/*` can carry a web address:
      read in the library's source before the build; 3.9 holds either
      way.
17. The version history (3.10; PBI-2.24).
    The app on `main`, read on 2026-11-26 at `41d833d`, nothing run: it
    shows its own version nowhere and stores none; the keys of its
    plain key-value store are `install.marker`, `disclaimer.accepted`,
    `language.chosen`, `model.id`, `lookup.text.save` and
    `lookup.photo.save`. It reads its version in two ways: from the
    imported `app.json` for the map's User-Agent
    (`src/library/LibraryMap.tsx`), and through `expo-constants` for
    the Wikimedia User-Agent (`src/picture/devicePicture.ts`). The
    history reads the imported file (3.10, item 5), whose content the
    bundler builds into the app, so its version is not a phone
    question; whether `expo-constants` gives the same version in an
    EAS build is not checked, and 3.10 does not rest on it.
    Not known without builds on Adam's phone (**[not checked]**):
    - that the key-value store's content is kept when a build is
      installed over an earlier one, which is what lets the app see
      an upgrade;
    - that installing a build ends the running app, so that its next
      opening is a start (3.10, item 7);
    - whether the app can tell, before it shows a screen, which
      screen a start opens on: the Library, a share's choice or
      another address (3.10, item 8), and how long the decision then
      waits while Android keeps the app's process;
    - how the opening by itself looks: whether the Library shows for
      an instant first, and that back shows the Library and does not
      leave the app;
    - what TalkBack says when the screen opens by itself, and where
      its focus goes when "Show full history" is pressed and the
      button is removed;
    - the screen at the phone's largest text size, with long entries.
    The opening by itself can be tried on a phone only with two builds
    of different versions, the earlier of them already with the
    history; or, with Clead's recommendation in 3.10, item 7, with the
    first build that has the history, installed over a 0.2.x build.
    iOS: nothing checked (no build before PBI-1.23).
