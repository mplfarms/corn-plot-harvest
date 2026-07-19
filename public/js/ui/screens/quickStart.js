// src/ui/screens/quickStart.js
//
// A short, plain-language "how do I even start" guide — reachable from a
// link on the branded Home Screen (plotChooser.js) AND from the splash/
// sign-in screen itself (accountScreen.js), for someone opening the app
// for the very first time and not sure what to tap, even before they've
// signed in. Deliberately short: 8 steps, no jargon, nothing that
// requires scrolling through paragraphs to find. The full,
// section-by-section Help screen (help.js, reachable from Settings)
// covers every field and every screen in much more depth — this is
// meant to get a brand-new user through their first plot, not to be a
// reference.
//
// This is the one screen besides "account" itself that router.js's
// mandatory-sign-in guard exempts — see its comment — and it's reachable
// from three different places (the splash screen, the Home Screen, and
// Help's "Show Me the Quick Start Guide Instead" button), so its own
// Back button returns to whichever one it was actually opened from (see
// router.js's rememberedOriginFor()). The old sign-in-state guess
// (signed in -> Home, signed out -> splash) is kept only as the fallback
// for when nothing's been recorded — e.g. a direct deep link/reload.

import { h, mount } from "../dom.js";
import { createTopBar } from "../components/topBar.js";
import * as authStore from "../authStore.js";
import { navigate, rememberedOriginFor } from "../router.js";

const STEPS = [
  {
    title: "Sign in",
    text: "Type your email and tap Sign In. No password needed. The first time, it'll ask your name — that just helps your admin tell everyone's plots apart.",
    tip: "You'll notice a “Demo” plot already sitting in Saved Plots — that's a sample with results already filled in, just so you have something to look at. Explore it, edit it, or delete it any time; it's local to this device only.",
  },
  {
    title: "Add it to your Home Screen",
    text: "On an iPhone or iPad: tap the Share button in Safari (the square with an arrow), then “Add to Home Screen.” On Android: tap the ⋮ menu in Chrome, then “Add to Home screen” (or “Install app”). Either way, an icon appears on your home screen that opens the app directly — no browser bar, no re-typing a web address.",
    tip: "Tip: see “Adding This App to Your Home Screen” under Settings → Help for the full step-by-step, including what it looks like on Android.",
  },
  {
    title: "Pick your Brand View (if asked)",
    text: "Most work emails skip this automatically. If you're asked, just tap the logo for the brand you work with — you can change it later in Settings.",
  },
  {
    title: "Tap “Enter a New Plot”",
    text: "This opens a new, blank plot and takes you to Plot Details — cooperator name, location, and planting info. Fill in what you know; nothing here is required to keep going.",
    tip: "Recommended: on a phone or tablet, allow location access when it's asked for. It fills in your GPS coordinates and looks up your Soil Type automatically — much faster than typing them in by hand.",
  },
  {
    title: "Add your hybrids",
    text: "From the Plot Workspace menu, tap “Enter Plot Hybrids,” then the + button to add each hybrid you're comparing.",
  },
  {
    title: "Enter your yield numbers",
    text: "After harvest, open each hybrid and either type the Dry Yield directly, or fill in the raw measurements (weight, moisture, strip length, etc.) and the app does the math for you.",
  },
  {
    title: "Check your results",
    text: "Tap “Plot Summary & Results” to see every hybrid ranked, plus averages and a chart of the spread.",
    tip: "Tip: tap the “i” info icon next to the gear at the top of this screen any time for a detailed explanation of the tabs, the chart, and what the colored numbers mean.",
  },
  {
    title: "Share it",
    text: "From Plot Summary, tap “Share This Plot” for a printable PDF, a full spreadsheet, printing, or emailing your results.",
  },
  {
    title: "Don't worry about saving",
    text: "Everything you type saves automatically the moment you enter a cooperator name. Find any plot again later under “Saved Plots” on the Home Screen.",
  },
];

// Spelled out in the intro line below rather than a hardcoded word, so
// adding/removing a step here can't silently leave that sentence saying
// the wrong count (as happened when "Add it to your Home Screen" was
// inserted as step 2 — the intro used to just say "eight steps").
const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
function spelledOutCount(n) {
  return COUNT_WORDS[n] || String(n);
}

export function render(container) {
  const topBar = createTopBar({
    title: "Quick Start Guide",
    onBack: () => navigate(rememberedOriginFor("quick-start") || (authStore.getUser() ? "plot-chooser" : "account")),
  });

  const stepsList = h(
    "ol",
    { className: "quick-start-steps" },
    STEPS.map((s, i) =>
      h("li", { className: "quick-start-step" }, [
        h("span", { className: "quick-start-step-number" }, String(i + 1)),
        h("div", { className: "quick-start-step-text" }, [
          h("p", { className: "quick-start-step-title" }, s.title),
          h("p", { className: "quick-start-step-body" }, s.text),
          s.tip ? h("p", { className: "quick-start-step-tip" }, s.tip) : null,
        ]),
      ])
    )
  );

  const moreHelpNote = h("p", { className: "field-note quick-start-more-help" }, [
    "Want more detail on any of these — like what a field means, how the cloud sync works, or what admins can do? Open ",
    h("strong", {}, "Settings → Help"),
    " for the full guide.",
  ]);

  const screen = h("div", { className: "screen quick-start-screen" }, [
    topBar,
    h("div", { className: "screen-body" }, [
      h("h2", { className: "screen-heading" }, "Getting Started"),
      h(
        "p",
        { className: "field-note" },
        `Here's the short version — ${spelledOutCount(STEPS.length)} steps from opening the app to sharing your first set of results.`
      ),
      stepsList,
      moreHelpNote,
    ]),
  ]);

  mount(container, screen);
}
