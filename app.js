(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Domain rules live in domain.js; this file is the desk UI.
  // ---------------------------------------------------------------------------
  const D = window.CampusDomain;
  const storageKey = "campus-stores.shift.v2";
  const legacyKey = "campus-stores.shift.v1";
  const rejectedKey = "campus-stores.shift.rejected";
  const root = document.getElementById("campus-stores");
  const q = (selector) => root.querySelector(selector);
  const { requests, assets, people, shifts, DUE, DUE_TIMES } = D;
  const { hasOwn, unique, isPerson, getAsset, getReq, fmtTime, fmtLong, normId } = D;
  const { typeOf, isHandedOver, rev } = D;
  const pages = [
    ["Requests", "clipboard-list"],
    ["Returns", "scan-line"],
    ["Inventory", "package"],
    ["Loan register", "book-open"],
    ["Desk book", "messages-square"],
  ];
  const FILTERS = ["All items", "On shelf", "On loan", "In repair"];

  const original = () => ({
    tab: "Requests",
    selected: "",
    filter: "All items",
    onlyOpen: true,
    ...D.initialRecords(),
    notice: "Sample shift · All records are fictional.",
  });
  const idleRet = (query = "") => ({
    state: "idle", // idle | found | done | notout
    query,
    num: 0,
    rev: 0,
    asset: "",
    error: "",
  });
  // Transient view state: never persisted.
  const freshUi = () => ({
    issue: null,
    ret: idleRet(),
    handover: 0,
    handoverRev: 0,
    handoverDraft: null,
    handoverError: "",
    undoError: null,
    query: "",
    noteDraft: "",
    correct: null, // { num, unit, rev, reason, staff, error, field }
    confirmRestart: false,
    focus: "",
  });
  let s = original();
  let ui = freshUi();
  let storageOk = true;
  // Highest event sequence this tab has seen in storage (for write conflicts).
  let syncedSeq = s.seq;

  // Domain queries bound to the current shift.
  const now = () => D.now(s);
  const getLoan = (num) => D.getLoan(s, num);
  const openLoan = (assetId) => D.openLoan(s, assetId);
  const loansFor = (reqId, type) => D.loansFor(s, reqId, type);
  const shelfUnits = (type) => D.shelfUnits(s, type);
  const isOverdue = (l) => D.isOverdue(s, l);
  const kitOf = (reqId) => D.kitOf(s, reqId);
  const lastWho = (reqId) => {
    const prior = loansFor(reqId);
    return prior.length ? prior[prior.length - 1].who : "";
  };

  // ---------------------------------------------------------------------------
  // Rendering primitives
  // ---------------------------------------------------------------------------
  const esc = (x) =>
    String(x).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const opts = (list, selected = "") =>
    list
      .map(
        ([v, t]) =>
          `<option value="${esc(v)}"${v === selected ? " selected" : ""}>${esc(t)}</option>`,
      )
      .join("");
  const btn = (label, act, val = "", style = "", aria = "") =>
    `<button type="button" data-action="${act}" data-val="${esc(val)}" class="${style}"${
      aria ? ` aria-label="${esc(aria)}"` : ""
    }>${esc(label)}</button>`;
  const head = (title, sub, control = "") =>
    `<div class="sectionhead"><div><h2 id="page-title" tabindex="-1">${esc(title)}</h2><small>${esc(sub)}</small></div>${
      control ? `<div class="buttons tight">${control}</div>` : ""
    }</div>`;
  const row = (label, sub, right) =>
    `<li class="row"><div><strong>${esc(label)}</strong><small>${esc(sub)}</small></div><div class="rowend">${right}</div></li>`;
  const tag = (t, kind = "") =>
    `<span class="tag${kind ? " " + kind : ""}">${esc(t)}</span>`;
  const uid = (id) => `<span class="uid">${esc(id)}</span>`;
  const banner = (kind, title, text = "") =>
    `<div class="banner ${kind}"><strong>${esc(title)}</strong>${text ? ` <span>${esc(text)}</span>` : ""}</div>`;
  const describe = (id, error) =>
    ` aria-describedby="${id}-msg"${error ? ' aria-invalid="true"' : ""}`;
  function field(id, label, control, { error = "", hint = "", cls = "" } = {}) {
    const text = error || hint;
    return `<div class="field${cls ? " " + cls : ""}"><label for="${id}">${label}</label>${control}<span id="${id}-msg" class="fieldmsg${
      error ? " error" : ""
    }"${text ? "" : " hidden"}>${esc(text)}</span></div>`;
  }
  const personOpts = (selected) => opts(people.map((p) => [p, p]), selected);

  function loanTags(l) {
    if (l.returned) return tag("Returned", "good");
    let html = isOverdue(l) ? tag("Overdue", "warn") : tag("Outstanding");
    if (isHandedOver(l)) html += " " + tag("Handed over", "info");
    return html;
  }
  function dueText(l) {
    if (l.due !== l.issuedDue) return `Due ${l.due} (was ${l.issuedDue})`;
    if (l.issuedDue !== getReq(l.req).due)
      return `Due ${l.due} · override at issue (approved ${getReq(l.req).due})`;
    return `Due ${l.due}`;
  }
  function custodyText(l) {
    if (l.returned)
      return `Returned by ${l.returned.by} · ${fmtTime(l.returned.at)}`;
    const holder = isHandedOver(l)
      ? `Held by ${l.holder} (borrowed by ${l.who})`
      : `Held by ${l.holder}`;
    return `${holder} · ${dueText(l)}`;
  }
  const undoErr = (l) =>
    ui.undoError && ui.undoError.num === l.num
      ? `<span class="fieldmsg error" role="alert">${esc(ui.undoError.text)}</span>`
      : "";

  // One register / list row per slip, used by the register and Returns page.
  function slipRow(l) {
    const a = getAsset(l.asset);
    const r = getReq(l.req);
    const custody = l.returned
      ? `Borrowed by ${l.who} · Returned by ${l.returned.by} · ${fmtTime(l.returned.at)}`
      : `Borrowed by ${l.who}${isHandedOver(l) ? ` · Held by ${l.holder}` : ""} · ${dueText(l)}`;
    const fixes = l.history.filter((e) => e.type === "unit-corrected");
    const fixNote = fixes.length
      ? `<small>Unit corrected from ${esc(fixes.map((e) => e.fromUnit).join(", "))} by ${esc(fixes.at(-1).staff)} · ${esc(
          fmtTime(fixes.at(-1).at),
        )}: ${esc(fixes.at(-1).reason)}</small>`
      : "";
    const right =
      loanTags(l) +
      (l.returned ? " " + btn("Undo return", "undo", l.num, "", `Undo return of ${l.asset}, slip L-${l.num}`) : "");
    return `<li class="row slip${l.returned ? " closed" : ""}"><div><strong>L-${l.num} · ${uid(a.id)} · ${esc(a.type)}</strong><small>${esc(
      `${a.model} · ${r.id} · ${r.club} · ${r.event}`,
    )}</small><small class="${isOverdue(l) ? "late" : ""}">${esc(custody)}</small>${fixNote}${undoErr(l)}</div><div class="rowend">${right}</div></li>`;
  }

  // One line per unit in a request's kit (kit view and post-return panel).
  function kitLine(l) {
    const a = getAsset(l.asset);
    const editing = ui.handover === l.num && !l.returned;
    // A unit only just handed over the counter can't have changed hands yet.
    const canHandover = !l.returned && !editing && l.issuedAt < now();
    return `<li class="line"><div><strong>${esc(a.type)}</strong><small>${uid(a.id)} · ${esc(a.model)} · slip L-${l.num}</small><small class="${
      isOverdue(l) ? "late" : ""
    }">${esc(custodyText(l))}</small></div><div class="lineend">${loanTags(l)}${
      canHandover
        ? " " + btn("Record handover", "handover-open", l.num, "", `Record handover for ${l.asset}, slip L-${l.num}`)
        : ""
    }</div>${editing ? handoverForm(l) : ""}</li>`;
  }
  function missingLine(type, n) {
    const shelf = shelfUnits(type).map((a) => a.id);
    return `<li class="line"><div><strong>${esc(type)}${n > 1 ? ` ×${n}` : ""}</strong><small>Not issued yet · ${
      shelf.length ? "on the shelf: " + esc(shelf.join(", ")) : "none on the shelf"
    }</small></div><div class="lineend">${tag("Not issued", "warn")}</div></li>`;
  }

  function handoverForm(l) {
    const d = ui.handoverDraft || { to: l.holder, due: l.due, note: "" };
    const id = (k) => `ho-${k}-${l.num}`;
    return `<form class="subform" data-handover data-num="${l.num}" data-rev="${ui.handoverRev}" novalidate aria-label="Record handover for ${esc(l.asset)}">
      <p class="formlead">Who has <strong>${esc(l.asset)}</strong> now, and when will it be back?</p>
      <div class="form">
        ${field(id("to"), "Now held by", `<select id="${id("to")}" name="to" data-bind="ho.to"${describe(id("to"), "")}>${personOpts(d.to)}</select>`)}
        ${field(id("due"), "Expected back", `<select id="${id("due")}" name="due" data-bind="ho.due"${describe(id("due"), ui.handoverError)}>${opts(DUE_TIMES.map((t) => [t, t]), d.due)}</select>`, { error: ui.handoverError })}
        ${field(id("note"), "Handover note <em>(optional)</em>", `<input id="${id("note")}" name="note" data-bind="ho.note" maxlength="200" autocomplete="off" value="${esc(d.note)}"${describe(id("note"), "")}>`, { cls: "full" })}
      </div>
      <div class="buttons tight"><button type="submit" class="primary">Save handover</button>${btn("Cancel", "handover-cancel", l.num)}</div>
    </form>`;
  }

  // ---------------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------------
  function kitTag(k) {
    if (k.state === "none") return tag("Not issued");
    if (k.state === "partial") return tag("Kit incomplete", "warn");
    if (k.overdue) return tag("Overdue", "warn");
    if (k.state === "out")
      return k.returned ? tag("Partly returned", "info") : tag("Out");
    return tag("All returned", "good");
  }
  function kitBanner(k) {
    if (k.state === "none")
      return banner("warn", "Nothing issued yet.", `Approved: ${k.r.items.join(", ")}.`);
    if (k.state === "partial")
      return banner(
        "warn",
        "Kit incomplete. The borrower doesn’t have everything yet.",
        `Still to issue: ${k.missing.join(", ")}.`,
      );
    if (k.state === "closed") return banner("good", "All equipment is back.");
    const out = k.loans
      .filter((l) => !l.returned)
      .map((l) => `${l.asset} with ${l.holder}, due ${l.due}`)
      .join("; ");
    if (!k.returned)
      return banner(
        k.overdue ? "warn" : "good",
        `Complete kit issued. All ${k.required} approved items are out.`,
        k.overdue ? `${k.overdue} overdue.` : "",
      );
    return banner(
      k.overdue ? "warn" : "info",
      `${k.outstanding} of ${k.required} still out.`,
      out + ".",
    );
  }
  function kitSection(k) {
    let html = `<section class="kit" aria-labelledby="kit-title"><div class="kithead"><h3 id="kit-title" tabindex="-1">Equipment kit</h3><span class="progress">${esc(
      k.summary,
    )}</span></div>${kitBanner(k)}<ul class="lines">`;
    for (const line of k.lines) {
      html += line.loans.map(kitLine).join("");
      if (line.missing) html += missingLine(line.type, line.missing);
    }
    html += "</ul>";
    if (ui.issue && ui.issue.where === "request") html += issueForm();
    else if (k.missing.length)
      html += `<div class="buttons">${btn(
        k.issued ? "Issue remaining items" : "Issue kit",
        "issue-open",
        k.r.id,
        "primary",
      )}</div>`;
    return html + "</section>";
  }

  function requestPage() {
    let html = head(
      "Approved requests",
      `Student Activities Office · ${requests.length} approved forms`,
    );
    if (!s.selected) {
      return (
        html +
        '<ul class="rows">' +
        requests
          .map((r) => {
            const k = kitOf(r.id);
            return row(
              r.event,
              `${r.id} · ${r.club} · ${k.summary}`,
              kitTag(k) + " " + btn("View kit", "request", r.id, "", `View kit for ${r.event}, ${r.id}`),
            );
          })
          .join("") +
        "</ul>"
      );
    }
    const r = getReq(s.selected);
    html +=
      btn("Back to list", "close") +
      `<div class="record"><small>${esc(r.id)} · Approved</small><h3>${esc(r.event)}</h3><p>${esc(
        r.club,
      )} · Filed by ${esc(r.owner)}</p><p><b>Return by</b> ${esc(r.due)}</p><p>${esc(r.note)}</p></div>`;
    return html + kitSection(kitOf(r.id));
  }

  function issueForm() {
    const d = ui.issue;
    const e = d.errors;
    const r = getReq(d.req);
    const k = r ? kitOf(r.id) : null;
    const done = Boolean(k && !k.missing.length);
    let html = `<form data-issue class="subform" novalidate aria-labelledby="issue-title"><h3 id="issue-title">New issue slip${
      r && d.locked ? " · " + esc(r.id) : ""
    }</h3>`;
    if (d.flash) html += `<p class="flash">${esc(d.flash)}</p>`;
    html += '<div class="form">';
    if (!d.locked)
      html += field(
        "issue-req",
        "Approved request",
        `<select id="issue-req" name="req" data-bind="issue.req" data-rerender${describe("issue-req", e.req)}><option value="">Select…</option>${opts(
          requests.map((x) => [x.id, `${x.id} · ${x.club} · ${kitOf(x.id).summary}`]),
          d.req,
        )}</select>`,
        { error: e.req, cls: "full" },
      );
    if (k) {
      const shelf = unique(k.missing)
        .map((type) => {
          const units = shelfUnits(type);
          return units.length
            ? units
                .map((a) => `${uid(a.id)} ${esc(a.model)} (bin ${esc(a.bin)})`)
                .join(", ")
            : `no ${esc(type)} on the shelf`;
        })
        .join("; ");
      html += `<div class="needs full"><p>${
        done
          ? `Every approved item on ${esc(r.id)} has been issued.`
          : `Still to issue: <strong>${esc(k.missing.join(", "))}</strong>`
      }</p>${done ? "" : `<p><small>On the shelf: ${shelf}</small></p>`}${
        k.loans.length
          ? `<p><small>Already issued: ${k.loans
              .map((l) => `${uid(l.asset)} on L-${l.num}${l.returned ? " (returned)" : ""}`)
              .join(", ")}</small></p>`
          : ""
      }</div>`;
    }
    html += field(
      "issue-unit",
      "Unit ID on the label",
      `<input id="issue-unit" name="unit" class="idinput" value="${esc(d.unit)}" data-bind="issue.unit" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="e.g. PR-04"${describe(
        "issue-unit",
        e.unit,
      )}${done ? " disabled" : ""}>`,
      { error: e.unit, hint: "Type the ID printed on the unit you’re handing over." },
    );
    html += field(
      "issue-who",
      "Collected by",
      `<select id="issue-who" name="who" data-bind="issue.who"${describe("issue-who", e.who)}><option value="">Select…</option>${personOpts(
        d.who,
      )}</select>`,
      { error: e.who },
    );
    html += `<div class="field full"><span class="label">Return by</span><p class="dueline"><strong>${
      r ? esc(d.override && d.due ? d.due : r.due) : "Set by the request"
    }</strong> <small>${
      !r
        ? ""
        : d.override
          ? `override · approved return time is ${esc(r.due)}`
          : `approved return time from ${esc(r.id)}`
    }</small></p><label class="check" for="issue-override"><input type="checkbox" id="issue-override" name="override" data-bind="issue.override" data-rerender${
      d.override ? " checked" : ""
    }> Use a different return time for this slip</label></div>`;
    if (d.override)
      html += field(
        "issue-due",
        "Override return time",
        `<select id="issue-due" name="due" data-bind="issue.due" data-rerender${describe("issue-due", e.due)}><option value="">Select…</option>${opts(
          DUE_TIMES.filter((t) => !r || t !== r.due).map((t) => [t, t]),
          d.due,
        )}</select>`,
        { error: e.due, hint: "The slip will be marked as an override." },
      );
    html += `</div><div class="buttons tight"><button type="submit" class="primary"${
      done ? " disabled" : ""
    }>Save issue slip</button>${btn(done ? "Close" : "Cancel", "issue-cancel")}</div></form>`;
    return html;
  }

  function returnsPage() {
    const R = ui.ret;
    let html = head(
      "Return equipment",
      "Enter or scan the ID on the unit’s label, check the loan, then confirm.",
    );
    html += `<form data-lookup class="scan" novalidate>${field(
      "return-unit",
      "Unit ID on the label",
      `<div class="scanrow"><input id="return-unit" name="unit" class="idinput" value="${esc(
        R.query,
      )}" data-bind="ret.query" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="e.g. AD-15"${describe(
        "return-unit",
        R.error,
      )}><button type="submit" class="primary">Find loan</button></div>`,
      {
        error: R.error,
        hint: "Lower case or a missing dash is fine. ad15 finds AD-15.",
      },
    )}</form>`;
    html += returnPanel();
    const open = s.loans
      .filter((l) => !l.returned)
      .sort((a, b) => isOverdue(b) - isOverdue(a) || DUE[a.due] - DUE[b.due]);
    html += `<section class="listblock" aria-labelledby="out-title"><h3 id="out-title">Still out <small>${open.length}</small></h3>${
      open.length
        ? `<ul class="rows">${open.map(slipRow).join("")}</ul>`
        : '<p class="muted">Nothing is out.</p>'
    }</section>`;
    const recent = s.loans
      .filter((l) => l.returned)
      .sort((a, b) => b.returned.seq - a.returned.seq)
      .slice(0, 5);
    html += `<section class="listblock" aria-labelledby="recent-title"><h3 id="recent-title">Recent returns</h3>${
      recent.length
        ? `<ul class="rows">${recent.map(slipRow).join("")}</ul>`
        : '<p class="muted">No returns recorded yet.</p>'
    }</section>`;
    return html;
  }
  function returnPanel() {
    const R = ui.ret;
    const l = getLoan(R.num);
    if (R.state === "found" && l && !l.returned) return confirmPanel(l);
    if (R.state === "done" && l && l.returned) return donePanel(l);
    if (R.state === "notout" && getAsset(R.asset))
      return notOutPanel(getAsset(R.asset));
    return "";
  }
  function confirmPanel(l) {
    const a = getAsset(l.asset);
    const r = getReq(l.req);
    const k = kitOf(r.id);
    const fact = (t, v) => `<div><dt>${t}</dt><dd>${v}</dd></div>`;
    const handover = l.history.filter((x) => x.type === "handover").pop();
    const rest = k.loans
      .filter((x) => x.num !== l.num)
      .map((x) => `${uid(x.asset)} ${x.returned ? "returned" : "still out"}`)
      .concat(k.missing.map((t) => `${esc(t)} never issued`));
    let html = `<section class="confirm" aria-labelledby="confirm-title"><div class="confirmhead"><h3 id="confirm-title" tabindex="-1">${uid(
      a.id,
    )} · ${esc(a.type)}</h3><div>${loanTags(l)}</div></div><dl class="facts">`;
    html += fact("Model", `${esc(a.model)} · home bin ${esc(a.bin)}`);
    html += fact("Slip", `L-${l.num} · issued ${esc(fmtTime(l.issuedAt))}`);
    html += fact("Request", esc(`${r.id} · ${r.club} · ${r.event}`));
    html += fact("Borrower", esc(l.who));
    if (isHandedOver(l))
      html += fact(
        "Current holder",
        `<strong>${esc(l.holder)}</strong>${handover ? ` · since ${esc(fmtTime(handover.at))}` : ""}${
          handover && handover.note ? ` · “${esc(handover.note)}”` : ""
        }`,
      );
    html += fact("Due", esc(dueText(l).replace(/^Due /, "")));
    html += fact(
      "Status",
      isOverdue(l)
        ? `<span class="late">Overdue since ${esc(l.due)}</span>`
        : "Out, not yet returned",
    );
    if (rest.length) html += fact("Rest of kit", rest.join(", "));
    html += `</dl><form data-confirm-return data-num="${l.num}" data-rev="${ui.ret.rev}" class="confirmform" novalidate>${field(
      "return-by",
      "Returned by",
      `<select id="return-by" name="by"${describe("return-by", "")}>${personOpts(l.holder)}</select>`,
    )}<div class="buttons tight"><button type="submit" class="primary">Confirm return of ${esc(
      a.id,
    )}</button>${btn("Not this unit", "return-cancel")}</div></form></section>`;
    return html;
  }
  function donePanel(l) {
    const a = getAsset(l.asset);
    const k = kitOf(l.req);
    const open = k.loans.filter((x) => !x.returned);
    let html = `<section class="done" aria-labelledby="done-title"><div class="confirmhead"><h3 id="done-title" tabindex="-1">Returned ${uid(
      a.id,
    )} · ${esc(a.type)}</h3>${btn("Undo return", "undo", l.num, "", `Undo return of ${l.asset}, slip L-${l.num}`)}</div><p>Slip L-${l.num} closed · returned by ${esc(
      l.returned.by,
    )} at ${esc(fmtTime(l.returned.at))}. Shelve it in bin ${esc(a.bin)}.</p>${undoErr(l)}`;
    html += `<p class="kitsum"><strong>${esc(k.r.id)} · ${esc(k.r.club)}</strong> · ${esc(k.summary)}</p>`;
    if (open.length)
      html += `<p class="formlead">Still out on this request. If someone else has it now, record the handover:</p><ul class="lines">${open
        .map(kitLine)
        .join("")}</ul>`;
    else if (!k.missing.length)
      html += banner("good", "Every item on this request is back.");
    return html + "</section>";
  }
  function notOutPanel(a) {
    const last = s.loans
      .filter((l) => l.asset === a.id)
      .sort((x, y) => y.num - x.num)[0];
    const sameType = s.loans.filter((l) => !l.returned && typeOf(l) === a.type);
    let html = `<section class="notout" aria-labelledby="notout-title"><h3 id="notout-title">${uid(a.id)} · ${esc(
      a.type,
    )} <small>${esc(a.model)}</small></h3>`;
    html += a.repair
      ? `<p>In repair (${esc(a.bin)}). It was never issued, so there is no slip to close.</p>`
      : `<p>Our records show it on the shelf in bin ${esc(a.bin)}. There is no open slip to close.${
          last && last.returned
            ? ` Last slip: L-${last.num}, returned by ${esc(last.returned.by)} at ${esc(fmtTime(last.returned.at))}.`
            : ""
        }</p>`;
    if (sameType.length)
      html += `${banner(
        "warn",
        "Check the label again.",
        `${sameType.length === 1 ? "This" : "These"} ${a.type} ${sameType.length === 1 ? "slip is" : "slips are"} still open:`,
      )}<ul class="rows">${sameType.map((l) => slipRow(l) + correctionRow(l, a)).join("")}</ul>`;
    return html + "</section>";
  }
  // The only way to change a slip's unit: from the mismatch above, for an open
  // slip that has never been returned (rules in domain.js).
  function correctionRow(l, a) {
    if (a.repair) return "";
    if (!D.canCorrectUnit(l))
      return `<li class="fixrow"><small class="muted">L-${l.num} has a return in its history, so its unit can’t be changed here. Set ${esc(
        a.id,
      )} aside and flag it to the desk lead.</small></li>`;
    const c = ui.correct;
    if (!c || c.num !== l.num)
      return `<li class="fixrow">${btn(
        `Slip L-${l.num} has the wrong unit: change it to ${a.id}`,
        "correct-open",
        l.num,
      )}</li>`;
    const field2 = (k, label, placeholder) =>
      field(
        `cor-${k}`,
        label,
        `<input id="cor-${k}" name="${k}" data-bind="cor.${k}" autocomplete="off" maxlength="${k === "staff" ? 40 : 200}" placeholder="${placeholder}" value="${esc(
          c[k],
        )}"${describe(`cor-${k}`, c.field === k ? c.error : "")}>`,
        { error: c.field === k ? c.error : "", cls: k === "reason" ? "full" : "" },
      );
    return `<li class="fixrow"><form class="subform" data-correct data-num="${l.num}" data-rev="${c.rev}" novalidate aria-labelledby="cor-title">
      <h3 id="cor-title">Correct slip L-${l.num}: ${uid(l.asset)} → ${uid(a.id)}</h3>
      <p class="formlead">Only do this if the label on the unit in hand reads <strong>${esc(a.id)}</strong> and ${esc(
        l.asset,
      )} isn’t with the borrower. The original issue stays in the slip’s history and this correction is added to it.</p>
      ${c.error && !c.field ? `<span class="fieldmsg error" role="alert">${esc(c.error)}</span>` : ""}
      <div class="form">${field2("reason", "Why is the slip wrong?", "e.g. Wrong adapter written at pickup")}${field2(
        "staff",
        "Your name or initials",
        "e.g. RK",
      )}</div>
      <div class="buttons tight"><button type="submit" class="primary">Correct slip to ${esc(a.id)}</button>${btn(
        "Cancel",
        "correct-cancel",
        l.num,
      )}</div></form></li>`;
  }

  function inventory() {
    let html = head(
      "Inventory",
      "Physical units · home shelf and current availability",
    );
    html += `<div class="buttons"><label for="inv-filter">Show</label><select id="inv-filter" data-filter>${opts(
      FILTERS.map((f) => [f, f]),
      s.filter,
    )}</select></div><ul class="rows">`;
    let shown = 0;
    for (const a of assets) {
      const l = openLoan(a.id);
      const status = a.repair ? "In repair" : l ? "On loan" : "On shelf";
      if (s.filter !== "All items" && s.filter !== status) continue;
      shown++;
      html += row(
        `${a.id} · ${a.type}`,
        `${a.model} · ${a.bin}` +
          (l ? ` · L-${l.num} · held by ${l.holder} · due ${l.due}` : ""),
        l && isOverdue(l)
          ? tag("Overdue", "warn")
          : tag(status, status === "On shelf" ? "good" : ""),
      );
    }
    if (!shown) html += '<li class="empty">No units match this filter.</li>';
    return html + "</ul>";
  }

  function matches(l, tokens) {
    if (!tokens.length) return true;
    const a = getAsset(l.asset);
    const r = getReq(l.req);
    const hay = [`l-${l.num}`, l.num, a.id, a.type, a.model, r.id, r.club, r.event, l.who, l.holder]
      .join(" ")
      .toLowerCase();
    const compact = hay.replace(/[^a-z0-9]/g, "");
    return tokens.every((t) => {
      const c = t.replace(/[^a-z0-9]/g, "");
      return hay.includes(t) || (c && compact.includes(c));
    });
  }
  function registerView() {
    const tokens = ui.query.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = s.loans
      .filter((l) => (!s.onlyOpen || !l.returned) && matches(l, tokens))
      .sort((a, b) => b.num - a.num);
    const open = s.loans.filter((l) => !l.returned);
    const overdue = open.filter(isOverdue).length;
    let count = `${open.length} outstanding${overdue ? ` · ${overdue} overdue` : ""}`;
    if (tokens.length)
      count = `${shown.length} matching · ${count}`;
    const scope = s.onlyOpen ? "outstanding " : "";
    const rows = shown.length
      ? shown.map(slipRow).join("")
      : `<li class="empty">${
          tokens.length
            ? `No ${scope}slips match “${esc(ui.query.trim())}”.${s.onlyOpen ? " Try All slips." : ""}`
            : "No outstanding slips."
        }</li>`;
    return { count, rows };
  }
  function register() {
    const formOpen = ui.issue && ui.issue.where === "register";
    let html = head(
      "Loan register",
      "One slip per physical unit",
      btn("Return equipment", "goto-return") +
        (formOpen ? "" : btn("New issue slip", "issue-open", "", "primary")),
    );
    if (formOpen) html += issueForm();
    const v = registerView();
    html += `<div class="toolbar"><div class="field search"><label for="reg-search">Search slips</label><input type="search" id="reg-search" value="${esc(
      ui.query,
    )}" placeholder="Slip, unit, type, model, request or name" autocomplete="off"></div><div class="buttons tight" role="group" aria-label="Which slips">${[
      "Outstanding",
      "All slips",
    ]
      .map(
        (label, i) =>
          `<button type="button" data-action="scope" data-val="${i}" aria-pressed="${s.onlyOpen === (i === 0)}">${label}</button>`,
      )
      .join("")}</div></div><p class="count" data-reg-count aria-live="polite">${esc(
      v.count,
    )}</p><ul class="rows" data-reg-list>${v.rows}</ul>`;
    return html;
  }
  function updateRegisterList() {
    const list = q("[data-reg-list]");
    if (!list) return;
    const v = registerView();
    list.innerHTML = v.rows;
    q("[data-reg-count]").textContent = v.count;
  }

  function deskbook() {
    let html = head(
      "Desk book",
      "Messages from clubs and notes for the next shift",
    );
    const entries = [
      [
        920,
        0,
        "Isha Rao · Film Society",
        "Kabir Sen is picking up our whole screening kit. Please issue it in his name. I’m setting up in the courtyard.",
      ],
      [
        930,
        0,
        "Tara Shah · Debate Union",
        "Our microphone stays with me overnight. I’ll return it by 10 am Saturday.",
      ],
    ];
    if (s.phase >= 1)
      entries.push([
        1170,
        0,
        "Kabir Sen · Film Society",
        "I brought the projector and speaker. Leela Das has our adapter. She’ll be at the counter at 9 am tomorrow.",
      ]);
    for (const n of s.notes)
      entries.push([shifts[n.phase].at, n.seq, "Counter handover", n.text]);
    for (const l of s.loans)
      for (const ev of l.history)
        if (ev.type === "unit-corrected")
          entries.push([
            ev.at,
            ev.seq,
            `Unit corrected · slip L-${l.num} · ${ev.staff}`,
            `${ev.fromUnit} → ${ev.toUnit}. ${ev.reason}`,
          ]);
        else if (ev.type === "handover")
          entries.push([
            ev.at,
            ev.seq,
            `Handover recorded · slip L-${l.num}`,
            `${l.asset} ${typeOf(l)}: ${ev.from} → ${ev.to}. Expected back ${ev.due}${
              ev.prevDue !== ev.due ? ` (was ${ev.prevDue})` : ""
            }.${ev.note ? " " + ev.note : ""}`,
          ]);
    entries.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    for (const [t, , author, body] of entries)
      html += `<article class="record"><small>${esc(fmtLong(t))}</small><h3>${esc(author)}</h3><p>${esc(body)}</p></article>`;
    return (
      html +
      `<form data-note><div class="form">${field(
        "note-text",
        "Note for the next shift",
        `<textarea id="note-text" name="note" rows="2" maxlength="400" required data-bind="note.text" aria-describedby="note-text-msg">${esc(ui.noteDraft)}</textarea>`,
        { cls: "full" },
      )}</div><button type="submit">Add handover note</button></form>`
    );
  }

  const screens = {
    Requests: requestPage,
    Returns: returnsPage,
    Inventory: inventory,
    "Loan register": register,
    "Desk book": deskbook,
  };

  // ---------------------------------------------------------------------------
  // Paint, focus and persistence
  // ---------------------------------------------------------------------------
  function captureFocus() {
    const el = document.activeElement;
    if (!el || el === document.body || !root.contains(el)) return null;
    let start = null;
    let end = null;
    try {
      start = el.selectionStart;
      end = el.selectionEnd;
    } catch {
      // Inputs without a text selection.
    }
    return { id: el.id, action: el.dataset.action, val: el.dataset.val, start, end };
  }
  function restoreFocus(f) {
    let el = null;
    if (ui.focus) el = root.querySelector(ui.focus);
    ui.focus = "";
    if (!el && f) {
      if (f.id) el = document.getElementById(f.id);
      else if (f.action)
        el = [...root.querySelectorAll("[data-action]")].find(
          (b) => b.dataset.action === f.action && b.dataset.val === f.val,
        );
    }
    if (!el || !root.contains(el) || el.disabled) return;
    if (document.activeElement !== el) el.focus();
    if (f && f.id && el.id === f.id && typeof f.start === "number") {
      try {
        el.setSelectionRange(f.start, f.end);
      } catch {
        // Not a text field.
      }
    }
  }
  function paint() {
    const focus = captureFocus();
    const phase = shifts[s.phase];
    q("[data-clock]").textContent = phase.time;
    q("[data-shift-title]").textContent = phase.title;
    q("[data-shift]").textContent = phase.text;
    const advance = q('[data-action="advance"]');
    advance.hidden = !phase.next;
    advance.textContent = phase.next || "";
    q("[data-nav]").innerHTML = pages
      .map(
        ([n, icon]) =>
          `<button type="button" data-action="tab" data-val="${n}" aria-current="${
            s.tab === n ? "page" : "false"
          }"><svg aria-hidden="true" class="store-icon"><use href="#icon-${icon}"></use></svg>${n}</button>`,
      )
      .join("");
    q("[data-page]").innerHTML = screens[s.tab]();
    q("[data-status]").textContent =
      s.notice +
      (storageOk
        ? ""
        : " Browser storage is unavailable, so progress lasts for this visit only.");
    q("[data-restart]").innerHTML = ui.confirmRestart
      ? `<span class="restartq">Erase this shift’s slips, returns and notes?</span>${btn(
          "Erase and restart",
          "restart-confirm",
          "",
          "danger",
        )}${btn("Keep working", "restart-cancel")}`
      : btn("Restart sample shift", "restart");
    restoreFocus(focus);
  }
  const persisted = () => ({
    version: 2,
    tab: s.tab,
    phase: s.phase,
    selected: s.selected,
    filter: s.filter,
    onlyOpen: s.onlyOpen,
    seq: s.seq,
    loans: s.loans,
    notes: s.notes,
  });
  // Replace this tab's records with ones saved by another tab, and make sure
  // no open confirmation or handover form keeps acting on stale slip data.
  function adoptRecords(d) {
    Object.assign(s, { phase: d.phase, seq: d.seq, loans: d.loans, notes: d.notes });
    syncedSeq = d.seq;
    const R = ui.ret;
    const found = getLoan(R.num);
    if (R.state === "found") {
      if (!found || found.returned)
        ui.ret = { ...idleRet(R.query), error: "That slip was closed in another tab. Scan the unit again if needed." };
      else if (rev(found) !== R.rev) {
        R.rev = rev(found);
        R.error = "This slip changed in another tab. Check the details below before confirming.";
      }
    } else if (R.state === "done" && (!found || !found.returned)) ui.ret = idleRet();
    else if (R.state === "notout" && openLoan(R.asset))
      ui.ret = { ...idleRet(R.query), error: `${R.asset} is now on an open slip (changed in another tab). Find it again.` };
    if (ui.handover) {
      const l = getLoan(ui.handover);
      if (!l || l.returned) {
        ui.handover = 0;
        ui.handoverDraft = null;
        ui.handoverError = "";
      } else if (rev(l) !== ui.handoverRev) {
        ui.handoverRev = rev(l);
        ui.handoverError = "This slip changed in another tab. Check the holder and due time, then save again.";
      }
    }
    if (ui.correct) {
      const l = getLoan(ui.correct.num);
      if (!l || !D.canCorrectUnit(l) || ui.ret.state !== "notout") ui.correct = null;
      else if (rev(l) !== ui.correct.rev) {
        ui.correct.rev = rev(l);
        ui.correct.field = "";
        ui.correct.error = "This slip changed in another tab. Check it again before correcting.";
      }
    }
    if (ui.issue) ui.issue.errors = {};
  }
  // Last write wins between tabs, with one guard: if storage holds events this
  // tab hasn't seen (another tab saved first), adopt them instead of
  // overwriting, and say that this tab's latest change wasn't saved.
  function save(force = false) {
    try {
      const raw = force ? null : localStorage.getItem(storageKey);
      let stored = null;
      try {
        stored = raw && JSON.parse(raw);
      } catch {
        stored = null;
      }
      if (stored && Number.isInteger(stored.seq) && stored.seq > syncedSeq) {
        const res = D.sanitize(stored);
        if (res.ok) {
          const lostChange = s.seq > syncedSeq;
          adoptRecords(res.data);
          if (lostChange)
            s.notice =
              "Another open tab saved a change at the same moment. Its records are shown now and your last change was not saved. Please check and redo it.";
          return;
        }
      }
      localStorage.setItem(storageKey, JSON.stringify(persisted()));
      syncedSeq = s.seq;
      storageOk = true;
    } catch {
      storageOk = false;
    }
  }
  function commit(msg, force = false) {
    if (msg) s.notice = msg;
    save(force);
    paint();
  }

  // Saved data is replayed and checked in domain.js. A rejected save is kept
  // under its own key (never silently thrown away) and the reason is shown.
  function load() {
    let raw = null;
    let legacy = false;
    try {
      raw = localStorage.getItem(storageKey);
      if (raw === null) {
        raw = localStorage.getItem(legacyKey);
        legacy = raw !== null;
      }
    } catch {
      storageOk = false;
      return;
    }
    if (raw === null) return;
    let res;
    try {
      res = D.sanitize(JSON.parse(raw));
    } catch {
      res = { ok: false, error: "The saved shift isn’t readable." };
    }
    if (!res.ok) {
      try {
        localStorage.setItem(rejectedKey, raw);
      } catch {
        // Nothing more we can keep.
      }
      s.notice = `${res.error} A fresh sample shift has started. The old save is kept in browser storage as “${rejectedKey}”.`;
      return;
    }
    const d = res.data;
    s = {
      ...original(),
      tab: hasOwn(screens, d.tab) ? d.tab : "Requests",
      selected: typeof d.selected === "string" && getReq(d.selected) ? d.selected : "",
      filter: FILTERS.includes(d.filter) ? d.filter : "All items",
      onlyOpen: typeof d.onlyOpen === "boolean" ? d.onlyOpen : true,
      phase: d.phase,
      seq: d.seq,
      loans: d.loans,
      notes: d.notes,
      notice: `Restored your saved shift · ${shifts[d.phase].time}.`,
    };
    syncedSeq = s.seq;
    if (legacy) save();
  }

  // ---------------------------------------------------------------------------
  // Submit handlers
  // ---------------------------------------------------------------------------
  function submitIssue(f) {
    const d = ui.issue;
    const fd = new FormData(f);
    if (!d.locked) d.req = String(fd.get("req") || "");
    if (fd.has("unit")) d.unit = normId(fd.get("unit"));
    d.who = String(fd.get("who") || "");
    d.due = String(fd.get("due") || "");
    d.flash = "";
    const res = D.issue(s, { req: d.req, unit: d.unit, who: d.who, override: d.override, due: d.due });
    d.errors = res.errors || {};
    if (!res.ok) {
      ui.focus = `#issue-${["req", "unit", "who", "due"].find((k) => d.errors[k])}`;
      return commit();
    }
    const a = getAsset(res.loan.asset);
    const k = kitOf(res.loan.req);
    const msg = `Issued ${a.id} (${a.type}) to ${d.who} on slip L-${res.num}.`;
    if (!k.missing.length) {
      const where = d.where;
      ui.issue = null;
      ui.focus = where === "request" ? "#kit-title" : "#reg-search";
      return commit(`${msg} Kit complete: all ${k.required} items on ${k.r.id} are out.`);
    }
    d.unit = "";
    d.flash = `${msg} Still to issue: ${k.missing.join(", ")}.`;
    ui.focus = "#issue-unit";
    return commit(msg);
  }
  function submitLookup(f) {
    const res = D.lookup(s, new FormData(f).get("unit"));
    const R = (ui.ret = idleRet(res.id));
    ui.handover = 0;
    ui.correct = null;
    ui.undoError = null;
    ui.focus = "#return-unit";
    R.error = res.error;
    if (res.state === "notout") {
      R.state = "notout";
      R.asset = res.asset.id;
    } else if (res.state === "found") {
      R.state = "found";
      R.num = res.loan.num;
      R.rev = rev(res.loan);
      ui.focus = "#confirm-title";
    }
    return commit();
  }
  function submitReturn(f) {
    const num = Number(f.dataset.num);
    const by = String(new FormData(f).get("by") || "");
    const res = D.returnLoan(s, num, by, Number(f.dataset.rev));
    if (!res.ok) {
      if (res.changed) {
        // Re-show the confirmation with the slip's current details.
        ui.ret.rev = rev(getLoan(num));
        ui.ret.error = res.error;
        ui.focus = "#confirm-title";
      } else {
        ui.ret = { ...idleRet(), error: res.error };
        ui.focus = "#return-unit";
      }
      return commit();
    }
    ui.ret = { ...idleRet(), state: "done", num, asset: res.loan.asset };
    ui.focus = "#return-unit";
    const k = kitOf(res.loan.req);
    return commit(`Returned ${res.loan.asset}. Slip L-${num} closed, returned by ${by}. ${k.r.id}: ${k.summary}.`);
  }
  function submitHandover(f) {
    const num = Number(f.dataset.num);
    const fd = new FormData(f);
    const draft = {
      to: String(fd.get("to") || ""),
      due: String(fd.get("due") || ""),
      note: String(fd.get("note") || ""),
    };
    const res = D.handover(s, num, draft, Number(f.dataset.rev));
    if (res.closed) {
      ui.handover = 0;
      ui.handoverDraft = null;
      return commit(res.error);
    }
    if (!res.ok) {
      ui.handoverDraft = draft;
      ui.handoverError = res.error;
      if (res.changed) ui.handoverRev = rev(getLoan(num));
      ui.focus = `#ho-due-${num}`;
      return commit();
    }
    ui.handover = 0;
    ui.handoverDraft = null;
    ui.handoverError = "";
    ui.focus = `[data-action="handover-open"][data-val="${num}"]`;
    return commit(`Slip L-${num}: ${res.loan.asset} is now held by ${res.loan.holder}, expected back ${res.loan.due}.`);
  }

  function submitCorrection(f) {
    const c = ui.correct;
    const fd = new FormData(f);
    c.reason = String(fd.get("reason") || "");
    c.staff = String(fd.get("staff") || "");
    const before = getLoan(c.num) && getLoan(c.num).asset;
    const res = D.correctUnit(s, c.num, { unit: c.unit, staff: c.staff, reason: c.reason }, Number(f.dataset.rev));
    if (!res.ok) {
      c.error = res.error;
      c.field = res.field || "";
      if (res.changed && getLoan(c.num)) c.rev = rev(getLoan(c.num));
      ui.focus = c.field ? `#cor-${c.field}` : "#cor-title";
      return commit();
    }
    const l = res.loan;
    const old = getAsset(before);
    ui.correct = null;
    // Carry straight on to the return check for the unit actually in hand.
    ui.ret = { ...idleRet(l.asset), state: "found", num: l.num, rev: rev(l) };
    ui.focus = "#confirm-title";
    return commit(
      `Slip L-${l.num} corrected: ${before} → ${l.asset}. ${before} should be on the shelf in bin ${old.bin}; check it’s there.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-action]");
    if (!b || !root.contains(b)) return;
    const v = b.dataset.val;
    const act = b.dataset.action;
    if (act !== "undo") ui.undoError = null;
    switch (act) {
      case "restart":
        ui.confirmRestart = true;
        ui.focus = '[data-action="restart-cancel"]';
        break;
      case "restart-cancel":
        ui.confirmRestart = false;
        ui.focus = '[data-action="restart"]';
        break;
      case "restart-confirm":
        s = original();
        ui = freshUi();
        s.notice = "Sample shift restarted. All records are back to the fictional starting point.";
        ui.focus = '[data-action="restart"]';
        return commit("", true);
      case "advance":
        if (s.phase < 2) s.phase++;
        ui.correct = null;
        ui.issue = null;
        ui.handover = 0;
        ui.ret = idleRet();
        s.notice = `Desk time is now ${shifts[s.phase].time}.`;
        if (!shifts[s.phase].next) ui.focus = "#shift-text";
        break;
      case "tab":
        if (!hasOwn(screens, v)) return;
        s.tab = v;
        ui.correct = null;
        ui.issue = null;
        ui.handover = 0;
        break;
      case "close":
        ui.focus = `[data-action="request"][data-val="${s.selected}"]`;
        s.selected = "";
        ui.issue = null;
        ui.handover = 0;
        break;
      case "request":
        s.selected = v;
        ui.issue = null;
        ui.focus = "#kit-title";
        break;
      case "issue-open":
        ui.issue = {
          req: v || "",
          locked: Boolean(v),
          where: s.tab === "Requests" ? "request" : "register",
          unit: "",
          who: v ? lastWho(v) : "",
          override: false,
          due: "",
          errors: {},
          flash: "",
        };
        ui.handover = 0;
        ui.focus = v ? "#issue-unit" : "#issue-req";
        break;
      case "issue-cancel":
        ui.issue = null;
        ui.focus = '[data-action="issue-open"]';
        break;
      case "scope":
        s.onlyOpen = v === "0";
        break;
      case "goto-return":
        s.tab = "Returns";
        ui.issue = null;
        ui.focus = "#return-unit";
        break;
      case "return-cancel":
        ui.ret = idleRet();
        ui.focus = "#return-unit";
        break;
      case "undo": {
        const res = D.undoReturn(s, Number(v));
        if (!res.ok) {
          ui.undoError = { num: Number(v), text: res.error };
          break;
        }
        const l = res.loan;
        ui.undoError = null;
        if (ui.ret.num === l.num) ui.ret = idleRet();
        ui.focus = s.tab === "Returns" ? "#return-unit" : "#reg-search";
        s.notice = `Return undone. ${l.asset} is back out on slip L-${l.num}, held by ${l.holder}.`;
        break;
      }
      case "correct-open": {
        const l = getLoan(Number(v));
        if (!l || ui.ret.state !== "notout") return;
        ui.correct = { num: l.num, unit: ui.ret.asset, rev: rev(l), reason: "", staff: "", error: "", field: "" };
        ui.focus = "#cor-reason";
        break;
      }
      case "correct-cancel":
        ui.correct = null;
        ui.focus = `[data-action="correct-open"][data-val="${Number(v)}"]`;
        break;
      case "handover-open":
        ui.handover = Number(v);
        ui.handoverRev = getLoan(Number(v)) ? rev(getLoan(Number(v))) : 0;
        ui.handoverDraft = null;
        ui.handoverError = "";
        ui.focus = `#ho-to-${Number(v)}`;
        break;
      case "handover-cancel":
        ui.handover = 0;
        ui.handoverDraft = null;
        ui.handoverError = "";
        ui.focus = `[data-action="handover-open"][data-val="${Number(v)}"]`;
        break;
      default:
        return;
    }
    commit();
  });

  function bind(t) {
    const [scope, key] = t.dataset.bind.split(".");
    if (scope === "note") {
      ui.noteDraft = t.value;
      return;
    }
    if (scope === "ho" && !ui.handoverDraft) {
      const l = getLoan(ui.handover);
      if (!l) return;
      ui.handoverDraft = { to: l.holder, due: l.due, note: "" };
    }
    const target =
      scope === "issue"
        ? ui.issue
        : scope === "ret"
          ? ui.ret
          : scope === "ho"
            ? ui.handoverDraft
            : scope === "cor"
              ? ui.correct
              : null;
    if (!target) return;
    target[key] = t.type === "checkbox" ? t.checked : t.value;
    if (scope === "issue" && key === "req" && !target.who) target.who = lastWho(t.value);
    if (scope === "issue" && key === "override" && !t.checked) target.due = "";
  }
  root.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "reg-search") {
      ui.query = t.value;
      updateRegisterList();
    } else if (t.dataset.bind && t.type !== "checkbox" && t.tagName !== "SELECT") bind(t);
  });
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (t.matches("[data-filter]")) {
      s.filter = FILTERS.includes(t.value) ? t.value : "All items";
      commit();
    } else if (t.dataset.bind) {
      if (t.tagName === "SELECT" || t.type === "checkbox") bind(t);
      if (t.hasAttribute("data-rerender")) {
        if (ui.issue) {
          ui.issue.errors = {};
          ui.issue.flash = "";
        }
        commit();
      }
    }
  });
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (ui.confirmRestart) {
      ui.confirmRestart = false;
      ui.focus = '[data-action="restart"]';
    } else if (ui.handover) {
      ui.focus = `[data-action="handover-open"][data-val="${ui.handover}"]`;
      ui.handover = 0;
      ui.handoverError = "";
    } else if (ui.ret.state === "found") {
      ui.ret = idleRet(ui.ret.query);
      ui.focus = "#return-unit";
    } else return;
    e.preventDefault();
    commit();
  });
  root.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.matches("[data-note]")) {
      const text = String(new FormData(f).get("note") || "").trim();
      if (!text) return;
      s.notes.push({ phase: s.phase, text: text.slice(0, 400), seq: ++s.seq });
      ui.noteDraft = "";
      ui.focus = "#note-text";
      commit("Handover note saved.");
    } else if (f.matches("[data-issue]") && ui.issue) submitIssue(f);
    else if (f.matches("[data-lookup]")) submitLookup(f);
    else if (f.matches("[data-confirm-return]")) submitReturn(f);
    else if (f.matches("[data-handover]")) submitHandover(f);
    else if (f.matches("[data-correct]") && ui.correct) submitCorrection(f);
  });

  // Keep records in step when the app is open in another tab. View settings
  // (tab, filters, open forms and their drafts) stay per-tab; slips, notes and
  // desk time are shared.
  window.addEventListener("storage", (e) => {
    if (e.key !== storageKey || e.newValue === null) return;
    let res;
    try {
      res = D.sanitize(JSON.parse(e.newValue));
    } catch {
      return;
    }
    if (!res.ok) return;
    const d = res.data;
    // Every record change bumps seq, so an equal seq and phase means the other
    // tab only changed its own view: nothing to re-render here.
    if (d.seq === s.seq && d.phase === s.phase && d.notes.length === s.notes.length) return;
    adoptRecords(d);
    s.notice = "Records updated from another open tab.";
    paint();
  });

  load();
  paint();
})();
