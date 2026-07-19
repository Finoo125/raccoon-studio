# Raccoon Studio

AI-powered creative studio built on ComfyUI.

## Quick start — Windows 11 (one command)

1. Make an empty folder where you want it installed (e.g. `C:\RaccoonStudio`).
2. Open that folder, type `cmd` in the address bar, and press **Enter** (opens a
   Command Prompt already in that folder).
3. Paste this **one command** and press Enter:

```bat
powershell -ExecutionPolicy Bypass -NoProfile -Command "if(-not(Get-Command git -ea SilentlyContinue)){winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements --disable-interactivity;$env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')};git clone https://github.com/Finoo125/raccoon-studio.git .;& '.\bootstrap.ps1'"
```

That installs Git (if needed), clones the repo into the folder, and runs the
installer. When it finishes, launch with **`Raccoon Studio.bat`** (or the
Desktop shortcut).

> Already have the repo cloned? Just run `powershell -ExecutionPolicy Bypass -File bootstrap.ps1`
> from inside the folder, or double-click `install-windows.bat`.

## Add-ons (Patreon)

Raccoon Studio ships as a **core** product that is free for everyone, plus optional **add-on** features for Patreon supporters.

### Core vs add-ons

| Feature | Who gets it |
|---|---|
| Generate Images, Generate Videos, Gallery | Everyone (core) |
| Photo Editing | Patreon supporters |
| Movie Maker + Director AI | Patreon supporters |

Locked add-on code still ships in every build — supporters get a signed key that unlocks it client-side and server-side. There is no separate download.

### How supporters unlock add-ons

1. Obtain your unlock key from Patreon (a single token string).
2. Open Raccoon Studio and navigate to **Add-ons** in the top menu.
3. Paste the key into the input field and click **Unlock**.
