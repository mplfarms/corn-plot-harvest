CORN PLOT HARVEST — SHUTDOWN BUILD
==================================

WHAT THIS IS
Two files that replace the app with a screen reading "No Longer Exists",
and clear the app off devices that already have it installed.
Nothing is deleted: the real app is one revert away, and every plot a rep
has entered stays on their phone.

  index.html  — the "No Longer Exists" screen
  sw.js       — wipes the cached app off installed devices, then removes
                itself

TO SHUT ACCESS OFF
1. Unzip. You get index.html and sw.js (two files, no folder).
2. Open your repo's public folder in Finder.
3. Drag BOTH files INTO public — do NOT drag a folder onto public, and do
   not replace the whole public folder. Click Replace when asked.
   Only these two files change; css, js, icons, data, template stay put.
4. In GitHub Desktop you should see exactly 2 changed files:
      public/index.html
      public/sw.js
5. Commit to main and push. Netlify redeploys in about a minute.

WHAT HAPPENS
- Anyone opening cornplot.mplfarms.com gets the "No Longer Exists"
  screen.
- A phone with the app installed: the next time it has a signal, the
  browser picks up the new sw.js, which erases the cached app. The next
  time they open the app they get that screen instead. Someone with it
  open in front of them right now keeps seeing the old screen until they
  close and reopen it.
- Their entered plots are NOT deleted. They stay on the device and come
  back when access is restored.
- The Netlify functions are untouched, so nothing on the server side is
  lost.

TO RESTORE ACCESS
Easiest: GitHub Desktop, History tab, right-click the shutdown commit,
"Revert changes in commit", then push. That puts the real index.html and
sw.js back, Netlify redeploys, and devices reinstall the app shell the
same way they pick up any normal update.

Faster but temporary: Netlify, Deploys tab, open the deploy from just
before the shutdown, and click "Publish deploy". That rolls the live
site back immediately, but your repo still holds the shutdown files, so
follow up with the revert above.

IF YOU WANT IT DEAD IMMEDIATELY INSTEAD
Netlify, project cornplotentry, Project configuration > General > Danger
zone > Disable project. That takes the whole site and its functions
offline at once, but does nothing to a phone that already has the app
cached — which is exactly what these two files handle. Using both is the
belt-and-braces version: push this build, give everyone a day
to pick it up, then disable the project.
