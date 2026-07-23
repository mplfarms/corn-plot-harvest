// src/ui/screens/help.js
//
// The full, section-by-section Help guide — reachable from Settings for
// every signed-in user (not admin-only; the Admin section within it is
// the only part that's admin-specific, and it just describes what
// admins can do rather than requiring admin access to read). Built as a
// stack of native <details>/<summary> accordions (see helpSection()
// below) rather than one long scroll of text, so someone looking for one
// specific answer isn't stuck scrolling past everything else to find it
// — <details> also needs no JavaScript to expand/collapse, which keeps
// this file simple.
//
// Written deliberately in plain, non-technical language throughout —
// many of this app's users are not tech-savvy, so this avoids jargon
// ("endpoint", "cache", "sync conflict") in favor of describing what
// someone actually sees and taps. See quickStart.js for the short
// version of this same content, reachable from the Home Screen, meant
// for a first-time user's very first plot rather than as a reference.

import { h, mount } from "../dom.js";
import { createTopBar } from "../components/topBar.js";
import { navigate } from "../router.js";

function p(text) {
  return h("p", { className: "help-p" }, text);
}

function ul(items) {
  return h(
    "ul",
    { className: "help-list" },
    items.map((item) => h("li", {}, item))
  );
}

function sub(title) {
  return h("h4", { className: "help-subheading" }, title);
}

// A labeled contact row ("Email: mikelage@republicseed.com") whose value
// is itself a tap-to-act link — tel: opens the phone's own dialer with
// the number pre-filled, mailto: opens the device's default mail app
// with a blank new message already addressed. Both are standard browser
// link schemes, so this needs no extra permissions or app code — the
// OS/browser handles the hand-off entirely.
function contactRow(label, displayValue, href) {
  return h("p", { className: "help-p help-contact-row" }, [
    h("strong", {}, `${label}: `),
    h("a", { className: "help-link", href }, displayValue),
  ]);
}

function helpSection(title, children, opts) {
  return h(
    "details",
    { className: "help-section", open: Boolean(opts && opts.open) },
    [h("summary", { className: "help-section-title" }, title), h("div", { className: "help-section-body" }, children)]
  );
}

export function render(container) {
  const topBar = createTopBar({
    title: "Help",
    // This is a round trip back to wherever Settings was actually opened
    // from, not a new arrival there — see router.js's rememberedOriginFor().
    onBack: () => navigate("settings", { _skipOriginTracking: true }),
  });

  const intro = h("div", { className: "card help-intro-card" }, [
    p("Tap any section below to open it. Everything here explains what you're looking at on screen and what to do next — nothing to memorize."),
    h(
      "button",
      { type: "button", className: "btn btn-secondary btn-block", onclick: () => navigate("quick-start") },
      "Show Me the Quick Start Guide Instead"
    ),
  ]);

  const sections = [
    helpSection(
      "Signing In",
      [
        p("This app only ever asks for your email — no password, no code to remember. Type it in and tap Sign In."),
        p("The first time you sign in, it'll ask your name. This just helps your admin tell everyone's saved plots apart later — it's fine to skip it, but worth taking a second to fill in."),
        p("Always sign in with the SAME email every time. Your email is how the app knows which saved plots are yours — signing in with a different email (even by accident) shows you an empty list instead of your usual plots. If that happens to you, see “I don't see any of my plots” under Troubleshooting below."),
        p("You'll stay signed in on this device until you tap Sign Out in Settings — there's no timeout."),
      ],
      { open: true }
    ),

    helpSection("Adding This App to Your Home Screen", [
      p("This app works like a regular app once it's added to your home screen — tap the icon and it opens directly, full-screen, no browser address bar. It still works the same either way; this just saves you a step every time."),
      sub("On an iPhone or iPad (Safari)"),
      p("Tap the Share button along the bottom of the screen (the square with an arrow pointing up), scroll down the list that pops up, tap “Add to Home Screen,” then tap “Add” in the top right."),
      p("This only works in Safari — if you're using Chrome or another browser on an iPhone, open this same page in Safari first."),
      sub("On an Android phone or tablet (Chrome)"),
      p("Tap the ⋮ menu in the top right of Chrome, then tap “Add to Home screen” (some phones show this as “Install app” instead), then confirm."),
      p("Either way, you only need to do this once per device. If you ever sign in on a new phone or tablet, just repeat these steps there too."),
    ]),

    helpSection("Finding Your Way Around", [
      p("Every screen has a bar across the top with a few icons:"),
      ul([
        "Barn icon — takes you straight back to the Home Screen from anywhere.",
        "‹ (arrow) — goes back one screen, the same as wherever you just came from.",
        "⚙ (gear) — opens Settings.",
      ]),
      p("On the Plot Workspace screen, you'll also see a ⇄ icon next to the gear. That's your sync status — green means everything's safely backed up to the cloud, red means it hasn't synced yet (tap it to try again). More on this under “Staying in Sync” below."),
    ]),

    helpSection("Starting a New Plot", [
      p("From the Home Screen, tap “Enter a New Plot.” This clears the workspace and takes you to Plot Details. You don't need to fill in everything before moving on — enter what you know now and come back later if needed."),
      p("Nothing here needs a Save button. The moment you type a cooperator name, the plot is saved automatically — you can close the app and come back anytime."),
      sub("Cooperator Details"),
      p("The grower's name and location: Name, Address, State, County, City, and Zip. Picking a State first narrows down the County list to match."),
      sub("GPS Location"),
      p("For a brand-new plot with no location saved yet, the app asks for your location automatically the moment you open Plot Details — you don't need to tap anything first. Recommended: tap Allow when your phone or tablet asks. It's faster and far more accurate than typing coordinates in by hand, and it's what triggers the automatic Soil Type lookup described just below."),
      p("Once allowed, your Latitude and Longitude fill in on their own, along with roughly how accurate the reading is (for example, “Location captured (±5m)”)."),
      p("Moved to a different field, or want to re-capture your location later? Tap “Use Device Location or Enter Manually” again any time. The automatic request only happens once, for a brand-new plot with nothing saved yet — reopening an existing plot never overwrites a location you've already set unless you tap that button yourself."),
      p("Prefer not to use GPS at all? Just type the Latitude and Longitude directly into those two fields by hand instead — nothing else in the app requires the automatic version to work, though see the Soil Type note below for the one tradeoff of doing it that way."),
      p("If you accidentally tapped “Don't Allow” on the location prompt: the fastest fix is to just type the coordinates in by hand. To let the app try again automatically, you'll need to re-enable Location for this app/site in your phone or browser's own settings (this varies by phone — look for Settings → the app or website → Location/Permissions). See Troubleshooting below for more."),
      sub("Soil Type"),
      p("Right after your location is captured automatically via GPS, the app looks up the most common soil type at that exact spot (using USDA soil survey data) and fills in the Soil Type field on the Planting Details section for you — one less thing to look up or guess at. You'll see a note like “Soil type set to [name]” appear under GPS Location when this happens."),
      p("This automatic lookup only runs when your location comes from the GPS button — if you type your Latitude and Longitude in by hand instead, Soil Type is left for you to pick manually. Either way, you can always open the Soil Type list yourself afterward and choose a different value; the automatic fill is just a starting point, never a lock."),
      p("Occasionally the app can't confidently match a soil type for a given spot (this happens in areas with less detailed survey data available) — when that happens it says so plainly and simply leaves Soil Type for you to select manually, the same as if GPS hadn't been used at all."),
      sub("Planting Details"),
      p("Tillage, Irrigation, Soil Type (see above), Previous Crop, Planting Population, and Date Planted."),
      sub("Harvest Details"),
      p("Who collected the data (Collected By), their Phone and Email, and the Date Harvested."),
      sub("Yield Calculation"),
      p("Drying Shrink Rate and Price per Bushel — these are used to calculate the dollar value of each hybrid's yield. Base moisture is fixed at 15.5%, the standard basis for corn, so there's nothing to set there. Plot Notes at the bottom is just free space for anything else worth writing down about this plot."),
    ]),

    helpSection("Adding Your Hybrids", [
      p("From the Plot Workspace menu, tap “Enter Plot Hybrids” to see the list of hybrids in this plot. Tap the + button (bottom right) to add one."),
      sub("Hybrid Details"),
      p("Brand/Company, Hybrid, Trait, Seed Treatment, and Relative Maturity (RM) — these describe which product this entry is."),
      sub("Yield Measurements"),
      p("There are two different ways to get a Dry Yield number onto an entry — use whichever one fits how you actually collected your data. You never need to do both."),
      sub("Option 1: Enter it yourself (yield monitor, scale ticket, or another app)"),
      p("If you already have a yield number from somewhere else — a combine's yield monitor, a scale ticket, a third-party yield-mapping app, or your own math — just type it straight into the Dry Yield (bu/ac) field. The app uses exactly what you type, with no calculation or adjustment applied, so this is the fastest option any time you already trust the number."),
      sub("Option 2: Let the app calculate it for you"),
      p("Don't have a Dry Yield number yet? Leave that field blank and fill in your raw sample measurements instead, and the app does the math automatically:"),
      ul([
        "Sample Net Wt. (lbs) — the weight of the harvested sample.",
        "Moisture % — the moisture reading at harvest.",
        "Strip Length (ft), Number of Rows, and Width (in) — how much ground that sample came from.",
      ]),
      p("The app converts those into bu/ac for you, adjusted to the standard 15.5% base moisture — nothing to calculate by hand. Test Weight is also on this screen and worth recording for your own records, but it isn't part of the Dry Yield formula itself."),
      p("You can switch between the two at any time: type a number into Dry Yield to override whatever the app calculated, or clear that field back to empty to return to the automatic calculation from your raw measurements. The field's placeholder text shows you the calculated value even while it's blank, so you can always see what the app would use."),
      p("Comments at the bottom is a free-text spot for notes on that specific hybrid."),
      p("Back on the Plot Hybrids list: tap any row to edit it, use the ↑ / ↓ arrows to reorder entries, or the 🗑 trash icon to remove one."),
    ]),

    helpSection("Viewing Your Results", [
      p("Tap “Plot Summary & Results” from the Plot Workspace menu to see how every hybrid stacks up."),
      p("Near the top, two tabs — Dry Yield and Gross — let you re-rank the list by whichever number matters most right now. Each hybrid's Moisture reading still shows on its row either way."),
      p("Below that: the Trial Mean (the plot's average), CV (a measure of how spread out the results are — lower means more consistent), and how many entries have complete data."),
      p("The small horizontal chart is a box plot — it shows the full spread of yields at a glance: the box is where the middle half of your results fall, the line through it is the median, and the whiskers reach out to your highest and lowest yields."),
      p("If two or more brands are represented with multiple hybrids each, you'll also see an average for each brand."),
      p("In the Ranked Results list, each hybrid gets a colored number badge: green means it came in well above the plot's average, yellow means well below, and gray means close to average — this color reflects how that hybrid actually performed, not just where it landed in the ranking."),
      p("Tap “Edit This Plot” to jump back to Plot Hybrids and keep editing."),
      p("Want more detail on any of this? Tap the “i” info icon next to the gear at the top of the Plot Summary screen for a deeper walkthrough of the tabs, the box plot, and the rank badges, right there on the results screen."),
    ]),

    helpSection("Sharing & Exporting Your Results", [
      p("From Plot Summary, tap “Share This Plot” to open four options:"),
      ul([
        "Export / Share PDF — a clean, printable summary of your ranked results, ready to hand someone or save.",
        "Export / Share XLSX — the full spreadsheet with everything you entered, for anyone who wants the raw data.",
        "Print — opens a print-ready version so you can print directly from your phone, tablet, or computer.",
        "Email — opens your email app with the spreadsheet ready to send to your team. If your device can't attach it automatically, the file downloads instead and you just attach it yourself in the email that opens.",
      ]),
    ]),

    helpSection("Saved Plots", [
      p("Every plot you've entered a cooperator name for is saved automatically — there's no separate “Save” step to remember. Find them all by tapping “Saved Plots” from the Home Screen or Plot Workspace menu."),
      p("Use the search box at the top to find a plot by cooperator name, state, or year. A gold “Current” badge marks whichever plot is open in your workspace right now. Tap any row to open it; tap the 🗑 icon to permanently delete one from your device."),
      p("If a saved plot shows a “From {name}” badge, it means it originally belonged to a teammate — either an admin merged their account into yours, or they deleted their own account and their plots came to your farm's admin (see “For Admins” below). It's yours to manage from here just like any other saved plot."),
      p("You'll also see one plot with a gray “Demo” badge — a sample plot pre-loaded on this device so you always have something to look at on Plot Summary. Feel free to edit it for practice; it stays local to this device and never syncs, shows up on All Plots (Admin), or counts in an export. Delete it whenever you like — every time the app updates, the Demo Plot reappears with fresh sample content, even if you'd edited or deleted it before, so you can just delete it again if you'd rather not have it around."),
    ]),

    helpSection("Staying in Sync Across Devices", [
      p("As long as you're signed in, everything you enter automatically backs up to the cloud and stays in sync across every phone, tablet, or computer you sign into with that same email."),
      p("The ⇄ icon on the Plot Workspace screen shows whether that's currently up to date (green) or not (red — tap it to retry). If you're ever offline, don't worry: nothing is lost, it just catches up the next time you have a connection and tap that icon (or open the app again)."),
    ]),

    helpSection("Settings", [
      p("Tap the ⚙ gear icon from anywhere to open Settings. From here you can:"),
      ul([
        "Switch between Light, Dark, or System appearance.",
        "Switch your Brand View if you work across more than one brand.",
        "See which email you're signed in as, and Sign Out.",
        "Edit My Info — update your First Name, Last Name, and Mobile Number any time (your email itself can't be changed here, since that's how you sign in).",
        "Delete My Account — permanently removes your account. Every plot you've saved transfers to your farm's admin first, so nothing is lost, but this can't be undone and you'll need to sign back in (creating a fresh account) to keep using the app afterward. You'll be asked to confirm twice, including typing the word DELETE, before anything happens.",
        "Open this Help guide, or (for admins) Manage Users.",
      ]),
    ]),

    helpSection("For Admins", [
      p("If your account has admin access, you'll see a couple of extra things other users don't:"),
      sub("All Plots (Admin)"),
      p("Browse every teammate's saved plots in one place — every registered user gets their own card here, even one who hasn't saved a plot yet. Tap any plot to open and edit it directly — a banner at the top reminds you whose plot you're in the whole time you're working on it. When you're done, tap “Save Changes” to write your edits back to their account, or “Discard Admin Edit” to back out without saving anything. Tap the “☰” on any card to see that person's First Name, Last Name, Email, and Phone."),
      sub("Manage Users"),
      p("Reachable from Settings, this lists everyone who's ever signed in (admin(s) first, then everyone else alphabetically by last name), and lets you:"),
      ul([
        "Make Admin / Remove Admin — give or take away admin access.",
        "☰ (the button on each card) — edit that person's First Name, Last Name, and Mobile Number directly, the same as they could for themselves from their own Settings.",
        "Merge Into… — for when the same person ends up with two accounts (usually from signing in with a different email on a different device). This moves all of one account's plots onto the other and removes the duplicate. Nothing is lost.",
        "Delete — permanently removes someone's account and all their saved plots. Because this can't be undone, you'll be asked to confirm twice, including typing the word DELETE.",
      ]),
    ]),

    helpSection("Troubleshooting & Common Questions", [
      sub("I said no to the location request by mistake"),
      p("Easiest fix: just type your Latitude and Longitude into the GPS Location fields by hand — everything else works fine without it. To let the app ask for your location again automatically, you'll need to re-enable Location permission for this app or website in your phone or browser's own Settings (look for Settings → Privacy/Permissions → Location, or the site/app's own entry there — the exact wording depends on your device)."),
      sub("I don't see any of my plots"),
      p("This almost always means you're signed in with a different email than usual. Check Settings to see which email is shown next to “Signed in as.” If it's not the one you normally use, tap Sign Out and sign back in with the right email."),
      sub("The sync icon is red"),
      p("Tap it to try again, and check your internet connection. Your plots are always safe on this device either way — a red icon just means they haven't finished backing up to the cloud yet."),
      sub("I ended up with two accounts for myself"),
      p("This happens when you sign in with a different email on a different device. Ask an admin to merge them together from Manage Users — nothing is lost, everything ends up on one account."),
      sub("What happens to my plots if I delete my account?"),
      p("They transfer automatically to your farm's admin account before your account is removed — nothing is thrown away. See “Delete My Account” under Settings above."),
      sub("Still stuck?"),
      p("Ask whoever manages this app for your team (your admin) — they can look up your account and saved plots from their own Manage Users and All Plots screens."),
    ]),

    helpSection("Contact Us", [
      p("Have a question this guide didn't answer, found something that doesn't seem right, or just want to talk to a person? Reach out directly:"),
      contactRow("Email", "mikelage@republicseed.com", "mailto:mikelage@republicseed.com"),
      contactRow("Phone", "(712) 420-2348", "tel:+17124202348"),
      p("Tapping either one opens it directly — the email address starts a new message in your phone or computer's own mail app, and the phone number dials right from your device."),
    ]),
  ];

  const screen = h("div", { className: "screen help-screen" }, [
    topBar,
    h("div", { className: "screen-body" }, [h("h2", { className: "screen-heading" }, "Help"), intro, ...sections]),
  ]);

  mount(container, screen);
}
