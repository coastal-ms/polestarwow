# Coastal PS Guides development

This fork's first local snapshot starts at Polestar commit `fd03e5c55` (0.4.2). The development build has its own addon folders and saved variables. In Forever's AddOns menu, disable the original Polestar group for the character you are testing and enable Coastal PS Guides. Use `/cps` to open it.

## Refresh the development install

Run these commands in PowerShell from the checkout on Coastal's machine.

```powershell
. ./.ref/polestar-dev/enter.ps1
node tools/coastal-dev.js --install $env:WOW_FOREVER_ADDONS
```

Restart Forever once after adding the development addon folders. After refreshing an existing build, use `/reload` in the game. The staging script reads the checkout's addon tree and creates junctions only for Coastal PS Guides. The original install can be re-enabled from WoW.

For the initial snapshot, the guide Lua comes from the fork's checked-in compiled files. The local QuestDB and Codex were rebuilt with Forge from the installed Forever client and cached sources. The local reference data build used `data/local/coastal-reference-corrections.json` for six placeholder Darkspear Islands objectives. A complete Forge release rebuild also needs the Forever TDB trainer data and reference data that agrees with the authored guides.

## Bring in upstream changes

`origin` is the Coastal fork. `upstream` is `fitzforge/polestar`. When upstream publishes changes, fetch and inspect them from the development branch.

```sh
git fetch upstream next
git log --right-only --cherry-pick --oneline HEAD...upstream/next
```

Bring in relevant fixes with cherry-picks, or merge `upstream/next` for a full baseline update. Verify the development build after integrating the changes. Record the upstream revision used for each release so later updates can be compared against it.

## Keep local releases and upstream work separate

Develop and commit on `coastal/dev`. The live addon uses `dist/CoastalPSGuides/`.
To freeze a release, commit the changes you want included, then package that commit.

```powershell
. ./.ref/polestar-dev/enter.ps1
python tools/coastal-release.py 0.1.0 --source HEAD
git tag coastal-v0.1.0 HEAD
```

The ZIP and its checksum go in `dist/releases/0.1.0/`. The ZIP has its own Coastal
release number and records the source commit and hashes of the locally built
Codex and QuestDB. Keep those generated data folders with your release backups
if you want to reproduce the build. The packaging command reads committed addon
files and leaves your live staging directory alone. Use a new version for each
release so the old ZIP stays available.

For an upstream PR, start a separate branch at `upstream/next` and bring over
only the changes intended for the original project. Review the resulting diff
against `upstream/next` before publishing the PR branch. The Coastal packaging
scripts, local releases and unrelated work stay on your local development branch.
