// src/ui/screens/quickStart.js
//
// A short, plain-language "how do I even start" guide — reachable from a
// link on the branded Home Screen (plotChooser.js), for someone opening
// the app for the very first time and not sure what to tap. Deliberately
// short: 8 steps, no jargon, nothing that requires scrolling through
// paragraphs to find. The full, section-by-section Help screen
// (help.js, reachable from Settings) covers every field and every
// screen in much more depth — this is meant to get a brand-new user
// through their first plot, not to be a reference.

import { h, mount } from "../dom.js";
import { createTopBar } from "../components/topBar.js";
import { navigate } from "../router.js";

const STEPS = [
  {
    title: "Sign in",
    text: "Type your email and tap Sign In. No password needed. The first time, it'll ask your name — that just helps your admin tell everyone's plots apart.",
  },
  {
    title: "Pick your Brand View (if asked)",
    text: "Most work emails skip this automatically. If you're asked, just tap the logo for the brand you work with — you can change it later in Settings.",
  },
  {
    title: "Tap “Enter a New Plot”",
    text: "This opens a new, blank plot and takes you to Plot Details — cooperator name, location, and planting info. Fill in what you know; nothing here is required to keep going.",
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

export function render(container) {
  const topBar = createTopBar({
    title: "Quick Start Guide",
    onBack: () => navigate("plot-chooser"),
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
        "Here's the short version — eight steps from opening the app to sharing your first set of results."
      ),
      stepsList,
      moreHelpNote,
    ]),
  ]);

  mount(container, screen);
}
