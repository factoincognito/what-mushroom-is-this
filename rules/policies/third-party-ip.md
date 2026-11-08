# Policy: Third-Party Code and IP

We use other people's code, firmware, designs and assets only in ways their licence allows. When we can't copy something, we learn from it through a documented clean-room process, and we keep a record that shows how we did it. This policy is enforced at fixed gates in our production line: work that doesn't comply doesn't merge, build or ship.

## Scope and status

- **Applies to:** every product and project, and to anyone who writes or reviews code for us: people and AI agents alike.
- **Covers:** source code, firmware, example and forum code, vendor SDKs, hardware designs, documentation, images, fonts and icons that we did not create. Material the product owner or their company owns is our own, not third-party, whatever licence we publish it under.
- **Not legal advice.** Where this policy says *escalate*, the work stops until the product owner decides. Before a product ships, an IP lawyer reviews anything marked "escalate" or "clean room".

Claude follows the same rules through the `third-party-code-policy` skill, where it is available.

## Policy

1. **Know what we use.** Every piece of third-party material is recorded with its source, exact version and licence before we rely on it.
2. **Use it only as its licence allows.** Appendix A sets out what each licence type permits, what it requires of us, and what it rules out.
3. **Learn, don't copy, where copying isn't allowed.** We reuse such solutions only through the clean-room process in Appendix B, and only where Appendix A allows it.
4. **Some material is off limits.** We don't use leaked code, NDA material beyond what the NDA allows, or decompiled binaries, except decompiling for interoperability under EU law, after escalation (Appendix A.3). Where a work's terms ban reverse engineering, benchmarking or competing use, we use it only within those terms, and never reverse engineer it or reuse it through a clean room, except where EU law makes such a ban void (Appendix A.3), and then only after escalation. We never reuse other parties' trademarks, logos or product names.
5. **Give credit.** Each repo keeps a `THIRD-PARTY-NOTICES.md`, and required notices reach the end user of every product we ship.
6. **Escalate when unsure.** When Appendix A says escalate, or the situation is unclear, the work stops until the product owner decides. Before a product ships, an IP lawyer reviews any escalated or clean-room items.
7. **Keep records.** Clean-room work leaves a provenance record in the repo it went into. Records are kept for the life of the product.
8. **AI agents follow the same rules.** Claude applies this policy through the `third-party-code-policy` skill where it is available. Every task it covers starts with one line naming the source, the licence, the intended use and the mode chosen.

## Enforcement

This policy is enforced in our production line. These gates are mandatory, and no deadline overrides them.

| Gate | What is checked | If it fails |
| --- | --- | --- |
| Start of work | Before third-party material is used, its source, version, licence, intended use and mode are recorded (Appendix A.1) | Work doesn't start |
| Every task done by an AI agent | The agent applies this policy automatically, through the `third-party-code-policy` skill where it is available, and starts by stating the source, licence, use and mode | The agent stops and escalates instead of guessing |
| Escalation | Items marked *escalate* in Appendix A | Work on that item stops until the product owner decides, in writing |
| Merge | `THIRD-PARTY-NOTICES.md` is updated when the change adds or changes third-party material; clean-room work has a complete provenance record and a passed similarity check (Appendix B) | The change isn't merged |
| Release | All third-party items in the product are recorded, notices reach the end user, and an IP lawyer has reviewed escalated and clean-room items | The product isn't built for release or shipped |

- **No exceptions by default.** Only the product owner can grant an exception, in writing and recorded in the repo it applies to.
- **Breaches are fixed, not hidden.** Anyone who finds non-compliant material, including material already shipped, reports it to the product owner. That material is removed or brought into compliance before the next release.
- **Audits.** The product owner may audit the project or any product against this policy at any time.

## Appendices

- Appendix A: Licence handling: what each licence type allows, what it requires, and when a clean room may be used.
- Appendix B: Clean-room process: the step-by-step clean-room procedure and provenance record.

The appendices are process. In a project they change only with a newer edition of these Rules.

---

# Appendix A: Working with IP by licence type

This appendix sets out how we work with third-party IP under each licence type, including when the clean-room process (Appendix B) may be used. Where it says **escalate**, the work stops until the product owner decides.

## A.1 Before anything else

1. **Record the source:** URL, repo, and the exact commit or version.
2. **Find the licence:** check LICENSE or COPYING files, file headers, the README and package metadata. Folders, assets and bundled libraries can each have their own licence.
3. **State the intended use:** *commercial product* (anything any of our brands sells or ships), *internal tooling*, or *personal or hobby*.
4. **Confirm lawful access:** we got the material through a public release, a licence or an agreement whose terms allow what we plan to do.

Only the licence on the exact commit used counts. With no licence at all, the work is all rights reserved. When unsure which category applies, use the stricter one.

## A.2 Summary by licence type

| Licence type | Depend on it | Copy or adapt | Clean room | Commercial product |
| --- | --- | --- | --- | --- |
| Permissive | Yes | Yes, with notices | Not needed | Yes |
| Weak copyleft | Yes | Changes to the library itself only, published | Optional | Yes, as a library. Static linking in firmware: escalate. |
| Strong copyleft | No (closed products) | No (closed products) | Required to reuse the solution | Only through the clean room |
| Non-commercial / source-available | No (personal and hobby use: as the licence allows) | No | Required, after escalation | Only through the clean room, or with a bought licence |
| No licence | No | No | Required to reuse the solution | Only through the clean room |
| Vendor SDK, EULA or ToS | As the licence allows | As the licence allows | Not allowed if the terms ban reverse engineering, benchmarking or competing use, except the EU exceptions in A.3, after escalation | Escalate whenever the terms are unclear, and always before use in a product; then as the licence allows. |
| NDA, leaked, decompiled | No | No | Not allowed, except as the NDA allows, or decompiling for interoperability under EU law after escalation (A.3) | No, except through those A.3 exceptions after escalation |
| Hardware designs | By licence | By licence | Required for copyleft designs | CERN-OHL-P: yes. CERN-OHL-W/S and TAPR: escalate. |
| Docs, images, fonts | n/a | Yes, with attribution (non-commercial CC licences excluded) | n/a, so create our own | Per licence. Never trademarks or logos. |

## A.3 Details by licence type

### Permissive (MIT, BSD-2/3, ISC, Zlib, Apache-2.0, Unlicense, CC0)

- **Allowed:** use, copy, modify and ship in closed products.
- **Obligations:** keep the copyright and licence text, and list the component in `THIRD-PARTY-NOTICES.md`. For Apache-2.0, also carry its NOTICE file and mark files we changed. In firmware, the notices must reach the user too: in the docs, an About screen or the web installer.
- **Clean room:** not needed.

### Weak copyleft (LGPL-2.1/3, MPL-2.0, EPL-2.0)

- **Allowed:** use as an unmodified or separately modified library inside our products.
- **Obligations:** publish the source of any changes to the library's own files (MPL and EPL apply per file, LGPL per library), and keep the notices.
- **Firmware:** LGPL code that is statically linked (for example a microcontroller framework's core) requires that users can relink with a modified version, which usually means shipping object files or our source. **Escalate** before shipping.
- **Clean room:** optional, and only when depending on the library isn't workable.

### Strong copyleft (GPL-2.0/3.0, AGPL-3.0)

- **Allowed:** internal tools that never ship; separate programs that only talk to it over standard interfaces.
- **Not allowed:** copying it into, or linking it with, closed products. Shipping GPL code means releasing our whole combined source under the GPL. AGPL extends this to network services.
- **Clean room:** required to reuse a solution in a product. **Escalate** if the work is to be shipped.

### Non-commercial and source-available (PolyForm Noncommercial, CC BY-NC, BSL/BUSL, SSPL, Commons Clause, Elastic)

- **Allowed:** personal and hobby use as the licence defines it. A BSL licence converts to open source on its change date; check that date.
- **Not allowed:** copying it into, or deriving from it in, any commercial product.
- **Clean room:** allowed only after **escalation**, because some of these licences restrict use, not just copying. For example, PolyForm requires accepting its terms before you get any rights, and studying the code for a commercial product may count as commercial use.
- **Alternative:** ask the author for a commercial licence.

### No licence (repos without a LICENSE, forum posts, blogs, videos)

- **Allowed:** reading it, and forking on GitHub. Neither grants any reuse rights.
- **Clean room:** required to reuse a solution in any of our work, hobby use included.

### Vendor SDKs, EULAs and terms of service (e.g. device and chip vendors)

- **Allowed:** exactly what the SDK licence or agreement permits, nothing more.
- **Clean room:** **not allowed** when the terms ban reverse engineering, benchmarking or building competing products. The terms are a contract, and a clean room doesn't get around a contract.
- **EU exceptions (Directive 2009/24/EC):** a term that bans reverse engineering can't stop a lawful user from observing, studying and testing how a program works while using it (art. 5(3)), or from decompiling the parts indispensable for interoperability with an independently created program (art. 6); such terms are void (art. 8). Work that relies on this is **escalated** first and then goes through the clean room. The information is used only for that interoperability: never to make a substantially similar program, and never given to others beyond what interoperability needs. The exceptions don't cover NDA material, trade secrets, patents or circumventing technical protection.
- **Escalate** whenever the terms are unclear, or the SDK is needed in a product.

### NDA material, leaked code and decompiled binaries

- **Not allowed** for any purpose, including a clean room, unless the NDA explicitly allows it. EU law allows decompiling only for interoperability, under strict conditions: **escalate**.
- Keep NDA material out of public repos and out of AI sessions that aren't covered by the NDA.

### Hardware designs (CERN-OHL-P/W/S, TAPR, CC-licensed schematics and PCBs)

- **CERN-OHL-P:** permissive; keep the notices.
- **CERN-OHL-W/S and TAPR:** copyleft, so modified designs must be released under the same terms. **Escalate** before using them in a product.
- **Clean room:** required to reuse a copyleft or unlicensed design in a product. Datasheet reference designs follow the vendor's terms.

### Documentation, images, fonts and icons (CC BY, CC BY-SA, OFL, stock licences)

- **CC BY:** use with attribution. **CC BY-SA:** our changes must also be released under CC BY-SA. **CC with NC:** not in commercial work. **OFL fonts:** bundle freely, but don't sell the font on its own.
- **Trademarks, logos and product names** are never reused, whatever the licence.
- **Clean room:** not applicable. Create our own design instead of copying a distinctive look.

---

# Appendix B: Clean-room process

We use the clean-room process when Appendix A says it is required or allowed and we want a solution we may not copy. Whoever reads the third-party material never writes our implementation. That applies to AI agents too: a session that has the source loaded must not write the code.

## B.1 Before starting

- Appendix A allows a clean room for this licence and this use. Non-commercial and source-available licences need escalation first.
- We accessed the source lawfully, and no terms we agreed to ban reverse engineering or competing use, unless the work relies on an EU exception in Appendix A.3 and was escalated.
- The analyst and the builder are named, and are separate people or separate AI sessions.

## B.2 Steps

1. **Analyse.** The analyst reads the source and writes a functional spec. The spec describes:
   1. the behaviour: inputs, outputs, states, timing, edge cases and error handling
   2. the protocol facts: message identifiers, data paths, register maps, message formats, units and scaling
   3. the public references the behaviour rests on: standards, datasheets, upstream library docs
   4. and nothing more. No code, no line-by-line pseudo-code, no identifiers, no file layout, and no comments or strings copied from the source.
2. **Review.** A reviewer who has not opened the source checks that the spec describes behaviour, not implementation, and removes anything that mirrors the source. The project owner approves the spec.
3. **Build.** The builder writes the code using only the approved spec, public references and permissively licensed libraries. The builder never receives the source, its URL or the analyst's notes, and uses the project's own architecture and naming.
4. **Check similarity.** Before merging, compare the result against the source: a token-based duplicate detector such as `jscpd`, plus a look at structure, naming and strings. Any non-trivial match goes back to the builder to rewrite.
5. **Record it.** Commit the provenance record to the target repo.

## B.3 Provenance record

Store it as `docs/provenance/YYYY-MM-DD-<topic>.md` in the target repo. After the first commit, only append to it.

- The source URL, commit and licence as found
- The Appendix A category, and why a clean room was used
- The escalation decision, if one was needed
- The approved spec, word for word, and who approved it
- The analyst and builder (person or AI session)
- The public references and libraries used, with their licences
- The similarity check: tool, date and result
- The commits that implement it

## B.4 With AI agents

- **Analyst:** a fresh subagent given the source and the question. It returns only the spec.
- **Reviewer and builder:** the main session, or another fresh subagent. Neither ever loads the source.
- The session summary or log stays with the provenance record as evidence.
