# Campus Stores

Campus Stores is a Product Engineer work sample set at a fictional campus media equipment desk. Work through a club’s screening, from equipment pickup to a partial return and the next morning’s handover. Open **Candidate brief** in the app for the assignment.

## My submission: returns that start from the unit in your hand

### What works well (kept)

At the 3:45 pm pickup, the issue slip wouldn’t let me make a wrong loan. It blocked the projector in repair (PR-06), a second speaker against the Film Society request, and a camera that RQ-214 never approved. Those safeguards are kept unchanged and now share one rule function. The approved quantity now counts the request’s whole history, so a returned speaker doesn’t free a second issue.

### The problem (changed)

The 7:30 pm partial return and the 9 am morning shift broke down:

- **No kit view.** Nothing answered “can he leave with everything he needs?” I could issue the projector and speaker, forget the adapter, and get no warning, even though the laptop is USB-C only.
- **The handover only lived in the Desk book.** The adapter slip still said “Kabir Sen · Due Fri 8 pm”. The fact that Leela had it was free text that the register couldn’t see.
- **Returns closed a slip, not a unit.** Register rows showed only `L-404 · AD-15`, with no type or model. Closing the right loan meant cross-checking the Desk book, Inventory and the Register, then clicking one of two open slips. One of them was Tara’s microphone. The click couldn’t be undone and recorded neither the returner nor the time. There are also two USB-C adapters in the same bin, so nothing confirmed that the unit in hand matched the slip.

### The decision

Make the **physical unit ID** the key for returns, and keep custody **on the loan record**:

1. **Unit-first return** (new *Returns* tab). Type or scan `AD-15` (`ad15` works too). The app shows the matching open slip: model, home bin, request, club, event, borrower, current holder, due time, status and the rest of the kit. Then it asks you to confirm and records who returned it and when. **Undo return** reopens the slip and logs that in its history. If a unit with no open loan is scanned, such as `AD-12` while `AD-15` is out, the app says there is nothing to close and lists the open adapter slips as a possible mix-up. It never closes a different slip.
2. **Request kit tracker.** Each request shows e.g. `3 of 3 issued · 2 returned · 1 outstanding`. Opening it lists every approved item as *Not issued*, *Out* (with holder and due time) or *Returned* (by whom and when). A banner states whether the borrower has the complete kit.
3. **Partial handover on the loan.** After a partial return, the still-out item offers *Record handover*: new holder, expected-back time and an optional note. These are saved on the slip and in its history, so the kit view, register, return lookup and Desk book all read the same data.

**Why custody belongs on the loan record.** The morning shift asks a question about one slip: who has AD-15 and when is it due? If the answer lives in a Desk book note, every screen that shows the slip is wrong until someone reads the note. Keeping holder and due time on the loan, with each change appended to its history, gives every screen one source. A saved slip can also be checked by replaying its history.

Supporting changes:

- **Register rows** now show the slip, unit, type, model, request, club, event, borrower, holder and due time. Tags mark *Outstanding*, *Overdue*, *Handed over* and *Returned*. Search covers the slip number, unit, type, model, request and names.
- **Issue form** takes the unit ID from the label and fills in the approved return-by time. An override must be ticked deliberately and is flagged on the slip. The form shows what is still to issue and where it sits on the shelf. Errors appear inline at the field. The form stays open until the kit is complete.
- **Safer actions:** restart asks for confirmation. Focus, the cursor and typed drafts are preserved across updates, and Escape cancels.
- **Trustworthy saved data:** on load, each slip's history is replayed (issue → handovers → return/undo) and must reproduce the saved holder, due time and return status exactly. Event order, sequence numbers and desk times are also checked. A save that fails is not used. Instead it is copied to `campus-stores.shift.rejected` in browser storage, a fresh shift starts, and the status bar says which slip failed and why. Valid saves from earlier builds, including v1, still load.

### Measuring it at a real counter

The main measure is the **mismatch rate**: in a weekly shelf audit, how often the unit ID on a closed slip differs from the unit actually returned.

Secondary measures:
- Time from item in hand to slip closed.
- Share of morning returns closed without opening the Desk book.
- Undo returns per 100 returns, as a proxy for mistaken closes.
- Kits that left incomplete, i.e. a borrower coming back for a missing item.

## Run the app

Open `index.html` in a modern browser. The app includes its scripts, styles and icons, needs no build step and runs offline.

To serve it over local HTTP, run this from the repository folder and visit `http://localhost:8000`.

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Each browser stores its own sample shift locally when browser storage is available. Tabs open in the same browser share records but keep their own view and unsaved form input. **Restart sample shift** asks first, then restores the fictional starting records.

## Automated tests

```sh
npm test            # or: node --test tests/domain.test.js   (Node 18+, no dependencies)
```

`tests/domain.test.js` (42 tests) covers the rules in `domain.js` without the UI:
- issuing safeguards, including historical quantity and invalid overrides
- unit-ID lookup and returns
- handovers, including closed loans and stale forms
- undo
- save validation: valid v2, v1 migration, repeated reloads, 16 kinds of corrupted or contradictory history
- the full Friday-to-Saturday scenario
- wrong-unit correction: allowed and refused cases, history kept, tampered corrections rejected on load

`tests/e2e.py` is an optional browser run of the same scenario through the UI (86 checks). It covers inline errors, focus, search, undo, restart confirmation, rejected saves, two-tab sync, stale confirmations, the simultaneous-write guard, keyboard-only return, the wrong-unit correction flow and 390/768 px layouts. It needs Python Playwright: `pip install playwright && playwright install chromium`, then `python3 tests/e2e.py` (set `CHROME=/path/to/chrome` to use an installed browser).

## Test the scenario

1. **Fri 3:45 pm, pickup.** Open *Requests → Courtyard screening → Issue kit*. Choose Kabir Sen and enter `PR-04`, `SP-02`, then `AD-15`. The kit reads *Kit incomplete* until the adapter is issued, then *Complete kit issued*. Try `PR-06`, `CA-03` or `SP-05` to see the inline safeguards.
2. **Fri 7:30 pm, partial return.** Click *Move to return time*, then open *Returns*. Enter `PR-04`, confirm, then `SP-02` and confirm. Under “Still out on this request”, choose *Record handover* for AD-15: Leela Das, back Sat 9 am. The register now shows *Handed over* and “Held by Leela Das”.
3. **Sat 9:00 am, morning shift.** Click *Move to next morning*, open *Returns* and enter `AD-15`. The slip L-404 shows Leela as holder, due Sat 9 am (was Fri 8 pm), and is not overdue. Confirm. The request reads `3 of 3 issued · 3 returned · 0 outstanding`. Entering `AD-12` instead shows the possible mix-up warning.

## Source

- `index.html` contains the desk layout, candidate brief and bundled icons.
- `domain.js` holds the sample records and every rule: issuing checks, lookup, return, handover, undo and saved-data validation. It has no DOM access, so the tests load it directly. Every loan carries an append-only `history` of issue, handover, return and undo events.
- `app.js` is the desk UI: screens, forms, focus handling, storage and tab sync. It calls `domain.js` for every rule.
- `styles.css` defines the desktop and mobile layouts. It uses system font stacks, so no web fonts are loaded.

Icon license notices are in [third-party/lucide-LICENSE.txt](third-party/lucide-LICENSE.txt).

### Final pass: one more fix for the same problem

The whole submission is about one thing: the record must name the unit that is physically out. The last gap in that was a slip **issued against the wrong unit** (written as AD-15 when AD-12 left the desk). Until now the app could detect that at return but not fix it.

**Wrong-unit correction (implemented, narrowly).** When a scanned unit has no open slip but an open slip exists for the same type, the mismatch panel offers *Slip L-404 has the wrong unit: change it to AD-12*. The staff member gives a reason and their initials, then goes straight to the normal return check for the unit in hand.
- **Allowed** only on an open slip that has never been returned. Handovers are fine, because they change who holds the unit, not which unit it is.
- **Refused** after a return, even an undone one. That return was recorded against the old unit, and rewriting it would falsify history.
- **Same type only.** It can't swap in a unit that's unknown, in repair, or on another open slip.
- **Append-only.** The original issue event stays. A `unit-corrected` event (from, to, staff, reason, time) is added. Saved data is replayed and rejected if the unit chain doesn't add up.

**Deliberately not changed**

| Issue | Decision | Why |
|---|---|---|
| Wrong-unit correction | Implement now, narrowly (above) | It is the core problem. Without it, a detected mismatch had no safe resolution. |
| Simultaneous saves across tabs | Leave as is, documented | The earlier pass already added slip revisions on forms and a check for unseen saves before writing. Anything stronger needs atomic writes, which `localStorage` can't provide. A real fix is a backend with transactions. |
| Restoring rejected saves | Leave, documented | A save is only rejected because its history contradicts itself. Restoring it would bring the inconsistency back, and "repairing" it would mean guessing which part is true. The copy is kept for manual inspection. |

### Known limitations

- **Tabs:** `localStorage` has no transactions. Two tabs saving in the same instant can still overwrite each other. Outside that instant, a stale tab adopts the newer save and says its own last change wasn't saved, rather than overwriting.
- **Rejected saves:** kept under `campus-stores.shift.rejected` but not restorable from the app, by design (see above).
- **Corrections after a return:** a slip whose unit was wrong *and* that was already returned can't be corrected in the app. The desk lead has to fix it outside it.
- **Staff identity:** corrections are signed with typed initials. There are no staff accounts, so this records a claim, not a verified identity.
- **Desk time:** it moves only in the three scenario steps, so every action in a step gets the same timestamp.
- **Multi-desk use:** shared records across devices, real-time locking and an audit trail you can trust would all need a backend.

## Submit your work

1. [Fork Campus Stores](https://github.com/virinchi-healthcare/campus-stores/fork) into your GitHub account. Complete the candidate brief and push your changes to your public fork. In your README, point reviewers to your work and explain the decision you made.
2. In your fork, open **Commits**, select the final commit you want reviewed, and copy the page URL. It should look like `https://github.com/YOUR-USERNAME/campus-stores/commit/COMMIT-SHA`.
3. [Submit your work through the Google Form](https://docs.google.com/forms/d/e/1FAIpQLScvzoh1R4WS-SkiwAVBQbMvniieJYSoOEfLMyVo5CyjOvYUgQ/viewform). Your **roll number**, **email ID**, and **final commit link from your public fork** are required. Enter your roll number and email ID in the form only.
