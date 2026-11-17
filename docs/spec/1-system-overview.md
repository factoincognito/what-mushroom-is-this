## 1. System overview

A phone app, Android and iOS, the proof of concept of a mushroom find
log: it takes a photo of a mushroom, has Claude give its best assessment
of the species, and keeps a log of the finds on the phone. The user
provides their own Claude API key. It comes before a general "What is
this?" app.

The app's public name is "Wushroom" (Adam's decision, 2026-11-10; "Washroom" from
2026-11-09). The repository, the Expo slug and scheme, and the Android application
ID stay as they were.

The app's languages are Swedish, English and Italian. For each analysed
find it shows the species' names in Swedish, English, Latin and Italian,
its edibility, general information, and the poisonous look-alikes of the
species (how they are shown: 3.1 and 3.3, **[Clead]**).

The edibility shown is always that of the species the app matched, and a
disclaimer says there is no guarantee the mushroom in the photo is that
species (section 3.5).

Marked **[Clead]** below: Clead's wording of what follows from Adam's
decisions, not decided by Adam in those words (product-office `RULES.md`
§ 7 (3)). Marked **[not checked]**: a fact still to be checked in the
build, before the item that depends on it.

