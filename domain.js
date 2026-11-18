// Campus Stores domain: sample records, loan rules and saved-data validation.
// No DOM access, so it runs in the browser (window.CampusDomain) and in Node tests.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CampusDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const requests = [
    {
      id: "RQ-214",
      club: "Film Society",
      event: "Courtyard screening",
      owner: "Isha Rao",
      due: "Fri 8 pm",
      items: ["HDMI projector", "Portable speaker", "USB-C → HDMI adapter"],
      note: "Playback is from a USB-C-only laptop. The host will collect at 4 pm.",
    },
    {
      id: "RQ-209",
      club: "Debate Union",
      event: "Finals rehearsal",
      owner: "Tara Shah",
      due: "Sat 10 am",
      items: ["Wireless microphone"],
      note: "Rehearsal runs into the evening.",
    },
    {
      id: "RQ-217",
      club: "Photo Circle",
      event: "Street portrait walk",
      owner: "Dev Menon",
      due: "Sat noon",
      items: ["Digital camera"],
      note: "Collection on Saturday morning.",
    },
  ];
  const assets = [
    { id: "PR-04", type: "HDMI projector", model: "BenQ MH550", bin: "A2" },
    {
      id: "PR-06",
      type: "HDMI projector",
      model: "Epson EB-X49",
      bin: "Workshop",
      repair: true,
    },
    { id: "SP-02", type: "Portable speaker", model: "JBL Eon One", bin: "B1" },
    { id: "SP-05", type: "Portable speaker", model: "Bose S1", bin: "B2" },
    {
      id: "AD-12",
      type: "USB-C → HDMI adapter",
      model: "Belkin AVC002",
      bin: "C4",
    },
    {
      id: "AD-15",
      type: "USB-C → HDMI adapter",
      model: "Anker A8312",
      bin: "C4",
    },
    { id: "MI-09", type: "Wireless microphone", model: "Shure BLX", bin: "B3" },
    { id: "CA-03", type: "Digital camera", model: "Sony A6400", bin: "D2" },
  ];
  const people = [
    "Isha Rao",
    "Kabir Sen",
    "Leela Das",
    "Tara Shah",
    "Dev Menon",
  ];
  // `at` is the simulated desk clock in minutes since Friday 00:00.
  const shifts = [
    {
      time: "Friday · 3:45 pm",
      at: 945,
      title: "Pickup at the counter",
      text: "Kabir is here for the Film Society screening. The film starts at four. Can he leave with everything he needs?",
      next: "Move to return time",
    },
    {
      time: "Friday · 7:30 pm",
      at: 1170,
      title: "The kit comes back in pieces",
      text: "Kabir has brought back the projector and speaker. “Leela still has the adapter. She’ll drop it off tomorrow at nine.” Take the return and hand over to the morning shift.",
      next: "Move to next morning",
    },
    {
      time: "Saturday · 9:00 am",
      at: 1980,
      title: "Morning shift",
      text: "You’ve just taken over. Leela walks in with an adapter. Work out what was outstanding from the screening and close the loan for the right item.",
    },
  ];
  const DUE = {
    "Fri 8 pm": 1200,
    "Sat 9 am": 1980,
    "Sat 10 am": 2040,
    "Sat noon": 2160,
  };
  const DUE_TIMES = Object.keys(DUE);
  const EVENT_TYPES = ["issued", "handover", "returned", "return-undone", "unit-corrected"];


  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const unique = (list) => [...new Set(list)];
  const isPerson = (p) => people.includes(p);
  const isMinute = (t) => Number.isInteger(t) && t >= 0 && t < 2880;
  const isSeq = (n) => Number.isInteger(n) && n >= 0;
  const getAsset = (id) => assets.find((x) => x.id === id);
  const getReq = (id) => requests.find((x) => x.id === id);
  const now = (st) => shifts[st.phase].at;

  function fmtTime(min) {
    const h = Math.floor((min % 1440) / 60);
    const m = String(min % 60).padStart(2, "0");
    return `${min < 1440 ? "Fri" : "Sat"} ${h % 12 || 12}:${m} ${h < 12 ? "am" : "pm"}`;
  }
  const fmtLong = (min) =>
    `${min < 1440 ? "Friday" : "Saturday"} · ${fmtTime(min).slice(4)}`;

  // Accept what a person or scanner types: "ad15", "AD 15", "ad-15" → "AD-15".
  function normId(raw) {
    const t = String(raw || "")
      .toUpperCase()
      .replace(/[\s_]+/g, "");
    const m = /^([A-Z]{2})-?(\d{1,2})$/.exec(t);
    return m ? `${m[1]}-${m[2].padStart(2, "0")}` : t;
  }

  // Loan record (one slip per physical unit):
  // { num, req, asset, who (borrower), holder (current holder), due (expected
  //   back now), issuedDue, issuedAt, returned: null | { by, at, seq },
  //   history: [{ type, at, seq, ... }] }  ← append-only; replaying it must
  //   reproduce holder, due and returned exactly.
  const initialRecords = () => ({
    version: 2,
    phase: 0,
    seq: 1,
    loans: [
      {
        num: 401,
        req: "RQ-209",
        asset: "MI-09",
        who: "Tara Shah",
        holder: "Tara Shah",
        due: "Sat 10 am",
        issuedDue: "Sat 10 am",
        issuedAt: 900,
        returned: null,
        history: [
          { type: "issued", at: 900, seq: 1, by: "Tara Shah", due: "Sat 10 am" },
        ],
      },
    ],
    notes: [],
  });

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------
  const getLoan = (st, num) => st.loans.find((l) => l.num === num);
  const typeOf = (l) => getAsset(l.asset).type;
  const openLoan = (st, assetId) =>
    st.loans.find((l) => l.asset === assetId && !l.returned);
  const loansFor = (st, reqId, type) =>
    st.loans.filter((l) => l.req === reqId && (!type || typeOf(l) === type));
  const qtyOf = (r, type) => r.items.filter((t) => t === type).length;
  const shelfUnits = (st, type) =>
    assets.filter((a) => a.type === type && !a.repair && !openLoan(st, a.id));
  const isOverdue = (st, l) => !l.returned && DUE[l.due] < now(st);
  const isHandedOver = (l) => l.holder !== l.who;
  // Revision of a loan: forms carry it so a stale form can't act on a changed slip.
  const rev = (l) => l.history.length;

  // Kit progress for one request, computed from the full issue history.
  function kitOf(st, reqId) {
    const r = getReq(reqId);
    const lines = unique(r.items).map((type) => {
      const loans = loansFor(st, r.id, type);
      const qty = qtyOf(r, type);
      return { type, qty, loans, missing: Math.max(0, qty - loans.length) };
    });
    const loans = loansFor(st, r.id);
    const required = r.items.length;
    const issued = loans.length;
    const returned = loans.filter((l) => l.returned).length;
    const outstanding = issued - returned;
    const overdue = loans.filter((l) => isOverdue(st, l)).length;
    const missing = lines.flatMap((x) => Array(x.missing).fill(x.type));
    const parts = [`${issued} of ${required} issued`];
    if (returned) parts.push(`${returned} returned`);
    if (issued && (returned || !missing.length))
      parts.push(`${outstanding} outstanding`);
    const state = !issued
      ? "none"
      : missing.length
        ? "partial"
        : outstanding
          ? "out"
          : "closed";
    return { r, lines, loans, required, issued, returned, outstanding, overdue, missing, state, summary: parts.join(" · ") };
  }

  // Every issuing safeguard lives here, so all screens enforce the same rules.
  function checkIssue(st, reqId, rawUnit) {
    const r = getReq(reqId);
    if (!r) return { field: "req", msg: "Choose the approved request first." };
    const id = normId(rawUnit);
    if (!id) return { field: "unit", msg: "Enter the unit ID printed on the label." };
    const a = getAsset(id);
    if (!a)
      return { field: "unit", msg: `No unit “${id}” in inventory. Check the label. IDs look like AD-15.` };
    if (a.repair)
      return { field: "unit", msg: `${a.id} is in repair (${a.bin}) and can’t be issued.` };
    const busy = openLoan(st, a.id);
    if (busy)
      return { field: "unit", msg: `${a.id} is already out on slip L-${busy.num} (${busy.req}, held by ${busy.holder}).` };
    if (!r.items.includes(a.type))
      return { field: "unit", msg: `${a.id} is a ${a.type}, which ${r.id} isn’t approved for. Approved: ${unique(r.items).join(", ")}.` };
    const prior = loansFor(st, r.id, a.type);
    if (prior.length >= qtyOf(r, a.type))
      return {
        field: "unit",
        msg: `${r.id} is approved for ${qtyOf(r, a.type)} ${a.type}, already issued as ${prior
          .map((l) => `${l.asset} on L-${l.num}${l.returned ? " (returned)" : ""}`)
          .join(", ")}.`,
      };
    return { req: r, asset: a };
  }

  // Resolve a scanned/typed unit ID to its open loan, never to another unit's.
  function lookup(st, raw) {
    const id = normId(raw);
    if (!id) return { id, state: "empty", error: "Enter or scan the unit ID from the label." };
    const asset = getAsset(id);
    if (!asset)
      return { id, state: "unknown", error: `No unit “${id}” in inventory. Check the label. IDs look like AD-15.` };
    const loan = openLoan(st, id);
    if (!loan)
      return { id, state: "notout", asset, error: `${id} has no open loan, so there is nothing to return.` };
    return { id, state: "found", asset, loan, error: "" };
  }

  // ---------------------------------------------------------------------------
  // Mutations: validate, then append to the loan's history.
  // ---------------------------------------------------------------------------
  const nextSeq = (st) => ++st.seq;

  function issue(st, { req, unit, who, override = false, due = "" }) {
    const errors = {};
    const check = checkIssue(st, req, unit);
    if (check.field) errors[check.field] = check.msg;
    if (!isPerson(who)) errors.who = "Choose who is collecting the equipment.";
    if (override) {
      if (!hasOwn(DUE, due)) errors.due = "Choose the override return time, or untick the override.";
      else if (DUE[due] <= now(st)) errors.due = `The return time must be later than now (${fmtTime(now(st))}).`;
      else if (check.req && due === check.req.due)
        errors.due = "That is already the approved time. Untick the override or choose another time.";
    }
    if (Object.keys(errors).length) return { ok: false, errors };
    const at = now(st);
    const slipDue = override ? due : check.req.due;
    const num = Math.max(400, ...st.loans.map((l) => l.num)) + 1;
    const loan = {
      num,
      req: check.req.id,
      asset: check.asset.id,
      who,
      holder: who,
      due: slipDue,
      issuedDue: slipDue,
      issuedAt: at,
      returned: null,
      history: [{ type: "issued", at, seq: nextSeq(st), by: who, due: slipDue }],
    };
    st.loans.push(loan);
    return { ok: true, num, loan };
  }

  function returnLoan(st, num, by, expectRev) {
    const l = getLoan(st, num);
    if (!l) return { ok: false, error: "That slip no longer exists. Scan the unit again." };
    if (l.returned) return { ok: false, error: `Slip L-${num} is already closed. Scan the unit again.` };
    if (expectRev !== undefined && rev(l) !== expectRev)
      return { ok: false, changed: true, error: `Slip L-${num} changed in another tab. Check the details, then confirm again.` };
    if (!isPerson(by)) return { ok: false, error: "Choose who returned it." };
    const at = now(st);
    const seq = nextSeq(st);
    l.returned = { by, at, seq };
    l.history.push({ type: "returned", at, seq, by });
    return { ok: true, loan: l };
  }

  // Undo leaves the return in the history and adds a matching undo event.
  function undoReturn(st, num) {
    const l = getLoan(st, num);
    if (!l || !l.returned) return { ok: false, error: "That return has already been undone." };
    const clash = openLoan(st, l.asset);
    if (clash)
      return { ok: false, error: `Can’t undo: ${l.asset} has since gone out again on slip L-${clash.num}.` };
    l.history.push({ type: "return-undone", at: now(st), seq: nextSeq(st), by: l.returned.by });
    l.returned = null;
    return { ok: true, loan: l };
  }

  function handover(st, num, { to, due, note = "" }, expectRev) {
    const l = getLoan(st, num);
    if (!l || l.returned)
      return { ok: false, closed: true, error: "That item has already been returned, so there is nothing to hand over." };
    if (expectRev !== undefined && rev(l) !== expectRev)
      return { ok: false, changed: true, error: `Slip L-${num} changed in another tab. Check the holder and due time, then save again.` };
    const text = String(note || "").trim().slice(0, 200);
    if (!isPerson(to) || !hasOwn(DUE, due))
      return { ok: false, error: "Choose who has it and when it’s expected back." };
    if (DUE[due] <= now(st))
      return { ok: false, error: `Expected back must be later than now (${fmtTime(now(st))}).` };
    if (to === l.holder && due === l.due && !text)
      return { ok: false, error: "Nothing has changed. Choose the new holder or a new return time." };
    l.history.push({ type: "handover", at: now(st), seq: nextSeq(st), from: l.holder, to, prevDue: l.due, due, note: text });
    l.holder = to;
    l.due = due;
    return { ok: true, loan: l };
  }

  // Wrong-unit correction: the slip names one unit, the borrower brings back
  // another of the same type. Allowed only while the slip is open and has never
  // been returned, because a return (even an undone one) was recorded against
  // the old unit and rewriting that would falsify the history. The original
  // issue event is kept; the correction is appended with who, when and why.
  const canCorrectUnit = (l) => !l.returned && !l.history.some((e) => e.type === "returned");
  function correctUnit(st, num, { unit, staff, reason }, expectRev) {
    const l = getLoan(st, num);
    if (!l) return { ok: false, error: "That slip no longer exists." };
    if (!canCorrectUnit(l))
      return { ok: false, closed: true, error: `Slip L-${num} has a return in its history, so its unit can’t be changed here. Flag it to the desk lead.` };
    if (expectRev !== undefined && rev(l) !== expectRev)
      return { ok: false, changed: true, error: `Slip L-${num} changed in another tab. Check it again before correcting.` };
    const id = normId(unit);
    const a = getAsset(id);
    const current = getAsset(l.asset);
    if (!a) return { ok: false, error: `No unit “${id}” in inventory.` };
    if (a.id === l.asset) return { ok: false, error: `Slip L-${num} already names ${a.id}.` };
    if (a.type !== current.type)
      return { ok: false, error: `${a.id} is a ${a.type}; slip L-${num} is for a ${current.type}. Only a unit of the same type can be swapped.` };
    if (a.repair) return { ok: false, error: `${a.id} is in repair, so it can’t be on a loan.` };
    const busy = openLoan(st, a.id);
    if (busy) return { ok: false, error: `${a.id} is already on open slip L-${busy.num}.` };
    const who = String(staff || "").trim().slice(0, 40);
    const why = String(reason || "").trim().slice(0, 200);
    if (why.length < 3) return { ok: false, field: "reason", error: "Say why the slip is wrong, e.g. “Wrong adapter written at pickup”." };
    if (!who) return { ok: false, field: "staff", error: "Enter your name or initials." };
    l.history.push({ type: "unit-corrected", at: now(st), seq: nextSeq(st), fromUnit: l.asset, toUnit: a.id, staff: who, reason: why });
    l.asset = a.id;
    return { ok: true, loan: l };
  }

  // ---------------------------------------------------------------------------
  // Validation of saved data: replay each loan's history and compare.
  // ---------------------------------------------------------------------------
  function cleanEvent(ev) {
    if (!ev || typeof ev !== "object" || !EVENT_TYPES.includes(ev.type) || !isMinute(ev.at) || !isSeq(ev.seq))
      return null;
    const out = { type: ev.type, at: ev.at, seq: ev.seq };
    for (const k of ["by", "from", "to"])
      if (ev[k] !== undefined) {
        if (!isPerson(ev[k])) return null;
        out[k] = ev[k];
      }
    for (const k of ["due", "prevDue"])
      if (ev[k] !== undefined) {
        if (!hasOwn(DUE, ev[k])) return null;
        out[k] = ev[k];
      }
    for (const k of ["fromUnit", "toUnit"])
      if (ev[k] !== undefined) {
        if (!getAsset(ev[k])) return null;
        out[k] = ev[k];
      }
    for (const [k, max] of [["note", 200], ["reason", 200], ["staff", 40]])
      if (ev[k] !== undefined) {
        if (typeof ev[k] !== "string") return null;
        out[k] = ev[k].slice(0, max);
      }
    return out;
  }

  // Returns "" when the saved state is exactly what the history produces.
  function replayError(l, history, nowAt) {
    const [first] = history;
    if (!first || first.type !== "issued") return "its history doesn’t start with an issue";
    if (!first.by || !first.due) return "its issue event is incomplete";
    if (first.by !== l.who || first.due !== l.issuedDue || first.at !== l.issuedAt)
      return "its issue event doesn’t match the slip";
    let holder = l.who;
    let due = l.issuedDue;
    let returned = null;
    let everReturned = false;
    const firstFix = history.find((e) => e.type === "unit-corrected");
    let unit = firstFix ? firstFix.fromUnit : l.asset;
    let lastSeq = -1;
    let lastAt = -1;
    for (const [i, ev] of history.entries()) {
      if (ev.seq <= lastSeq) return "its events are out of order";
      if (ev.at < lastAt) return "its event times go backwards";
      if (ev.at > nowAt) return "an event is later than the desk time";
      lastSeq = ev.seq;
      lastAt = ev.at;
      if (ev.type === "issued") {
        if (i) return "it was issued twice";
      } else if (ev.type === "handover") {
        if (returned) return "a handover was recorded after the return";
        if (!ev.from || !ev.to || !ev.due || !ev.prevDue) return "a handover is missing the holder or due time";
        if (ev.from !== holder || ev.prevDue !== due) return "a handover doesn’t follow the previous holder";
        holder = ev.to;
        due = ev.due;
      } else if (ev.type === "returned") {
        if (returned) return "it was returned twice";
        if (!ev.by) return "a return has no returner";
        returned = { by: ev.by, at: ev.at, seq: ev.seq };
        everReturned = true;
      } else if (ev.type === "unit-corrected") {
        if (everReturned) return "its unit was corrected after a return";
        if (!ev.fromUnit || !ev.toUnit || !ev.staff || !ev.staff.trim() || !ev.reason || !ev.reason.trim())
          return "a unit correction is incomplete";
        if (ev.fromUnit !== unit) return "a unit correction doesn’t follow the previous unit";
        const from = getAsset(ev.fromUnit);
        const to = getAsset(ev.toUnit);
        if (from.id === to.id || from.type !== to.type || to.repair) return "a unit correction swaps to an invalid unit";
        unit = ev.toUnit;
      } else {
        if (!returned) return "an undo has no matching return";
        if (ev.by && ev.by !== returned.by) return "an undo doesn’t match its return";
        returned = null;
      }
    }
    if (unit !== l.asset) return "its unit doesn’t match its history";
    if (holder !== l.holder || due !== l.due) return "its holder or due time doesn’t match its history";
    const r = l.returned;
    if (Boolean(r) !== Boolean(returned)) return "its return status doesn’t match its history";
    if (r && (r.by !== returned.by || r.at !== returned.at || r.seq !== returned.seq))
      return "its return details don’t match its history";
    return "";
  }

  function cleanLoan(l, nowAt) {
    const label = l && Number.isInteger(l.num) ? `Slip L-${l.num}` : "A slip";
    const bad = (why) => ({ error: `${label}: ${why}.` });
    if (!l || typeof l !== "object") return bad("it isn’t a loan record");
    const a = getAsset(l.asset);
    const r = getReq(l.req);
    if (!Number.isInteger(l.num) || l.num < 1) return bad("its slip number is invalid");
    if (!a || !r) return bad("it refers to an unknown unit or request");
    if (a.repair || !r.items.includes(a.type)) return bad("its unit isn’t issuable on that request");
    if (!isPerson(l.who) || !isPerson(l.holder)) return bad("its borrower or holder is unknown");
    if (!hasOwn(DUE, l.due) || !hasOwn(DUE, l.issuedDue) || !isMinute(l.issuedAt)) return bad("its times are invalid");
    if (l.returned !== null && (!l.returned || typeof l.returned !== "object")) return bad("its return status is invalid");
    if (!Array.isArray(l.history)) return bad("it has no history");
    const history = l.history.map(cleanEvent);
    if (history.some((e) => !e)) return bad("its history contains an invalid event");
    const why = replayError(l, history, nowAt);
    if (why) return bad(why);
    return {
      loan: {
        num: l.num,
        req: l.req,
        asset: l.asset,
        who: l.who,
        holder: l.holder,
        due: l.due,
        issuedDue: l.issuedDue,
        issuedAt: l.issuedAt,
        returned: l.returned && { by: l.returned.by, at: l.returned.at, seq: l.returned.seq },
        history,
      },
    };
  }

  function migrateV1(d) {
    if (!Array.isArray(d.loans)) return null;
    const at = shifts[d.phase] ? shifts[d.phase].at : shifts[0].at;
    let seq = 0;
    const loans = d.loans.map((l) => {
      if (!l || typeof l !== "object") return l;
      const issuedAt = l.num === 401 ? 900 : shifts[0].at;
      const history = [{ type: "issued", at: issuedAt, seq: ++seq, by: l.who, due: l.due }];
      let returned = null;
      if (l.back) {
        returned = { by: l.who, at, seq: ++seq };
        history.push({ type: "returned", at, seq, by: l.who });
      }
      const { back, ...rest } = l;
      return { ...rest, holder: l.who, issuedDue: l.due, issuedAt, returned, history };
    });
    return { ...d, version: 2, loans, seq };
  }

  // Records are all-or-nothing (a partial loan set could break the
  // one-loan-per-unit rule); the caller keeps a copy of anything rejected.
  function sanitize(input) {
    const fail = (error) => ({ ok: false, error });
    let d = input;
    if (!d || typeof d !== "object") return fail("The saved shift isn’t readable.");
    if (d.version === 1) d = migrateV1(d);
    if (!d || d.version !== 2 || !Array.isArray(d.loans)) return fail("The saved shift is from an unknown version.");
    const phase = Number.isInteger(d.phase) && shifts[d.phase] ? d.phase : 0;
    const loans = [];
    for (const raw of d.loans) {
      const res = cleanLoan(raw, shifts[phase].at);
      if (res.error) return fail(res.error);
      loans.push(res.loan);
    }
    const nums = new Set();
    const open = new Map();
    const used = new Map();
    const seqs = new Set();
    for (const l of loans) {
      if (nums.has(l.num)) return fail(`Slip L-${l.num} appears twice.`);
      nums.add(l.num);
      if (!l.returned) {
        if (open.has(l.asset))
          return fail(`${l.asset} is open on both L-${open.get(l.asset)} and L-${l.num}.`);
        open.set(l.asset, l.num);
      }
      const type = getAsset(l.asset).type;
      const key = `${l.req}|${type}`;
      used.set(key, (used.get(key) || 0) + 1);
      if (used.get(key) > qtyOf(getReq(l.req), type))
        return fail(`${l.req} has more ${type} slips than it was approved for.`);
      for (const e of l.history) {
        if (seqs.has(e.seq)) return fail(`Two saved events share sequence number ${e.seq}.`);
        seqs.add(e.seq);
      }
    }
    const notes = (Array.isArray(d.notes) ? d.notes : [])
      .filter((n) => n && Number.isInteger(n.phase) && shifts[n.phase] && n.phase <= phase && typeof n.text === "string" && n.text.trim())
      .map((n) => ({ phase: n.phase, text: n.text.trim().slice(0, 400), seq: isSeq(n.seq) ? n.seq : 0 }));
    const maxSeq = Math.max(0, ...seqs, ...notes.map((n) => n.seq));
    return {
      ok: true,
      data: { ...d, version: 2, phase, loans, notes, seq: Math.max(isSeq(d.seq) ? d.seq : 0, maxSeq) },
    };
  }

  return {
    requests, assets, people, shifts, DUE, DUE_TIMES,
    hasOwn, unique, isPerson, getAsset, getReq, now, fmtTime, fmtLong, normId,
    initialRecords, getLoan, typeOf, openLoan, loansFor, qtyOf, shelfUnits,
    isOverdue, isHandedOver, rev, kitOf, checkIssue, lookup,
    issue, returnLoan, undoReturn, handover, canCorrectUnit, correctUnit,
    cleanLoan, migrateV1, sanitize,
  };
});
