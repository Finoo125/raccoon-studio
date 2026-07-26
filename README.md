# Raccoon Studio

AI-powered creative studio built on ComfyUI.

## Quick start — Windows 11 (one command)

1. Make a folder where you want it installed (e.g. `C:\RaccoonStudio`).
2. Open that folder, type `cmd` in the address bar, and press **Enter** (opens a
   Command Prompt already in that folder — do this rather than typing `cd`, so a
   path with spaces in it can't trip you up).
3. Paste this **one command** and press Enter:

```bat
powershell -ExecutionPolicy Bypass -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; irm https://raw.githubusercontent.com/Finoo125/raccoon-studio/main/bootstrap.ps1 | iex"
```

That installs Git (if needed), clones the repo into a `raccoon-studio` subfolder,
and runs the installer. When it finishes, launch with **`Raccoon Studio.bat`**
inside that subfolder (or the Desktop shortcut).

> **AMD (experimental, RDNA3/RDNA4 only):** the command above installs the CPU
> build on an AMD machine — the ROCm path is opt-in. To test it, use this
> instead:
>
> ```bat
> powershell -ExecutionPolicy Bypass -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Finoo125/raccoon-studio/main/bootstrap.ps1))) -Gpu amd"
> ```

> Already have the repo cloned? Just run `powershell -ExecutionPolicy Bypass -File bootstrap.ps1`
> from inside the folder, or double-click `install-windows.bat`.

## Quick start — Linux (one command)

Ubuntu 24.04 / 26.04 · Arch · Fedora 44+, with an NVIDIA driver installed.

1. Open a terminal in the folder where you want it installed (e.g. `cd ~/apps`).
2. Paste this **one command** and press Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/Finoo125/raccoon-studio/main/bootstrap.sh | bash
```

That installs Git (if needed), clones the repo into a `raccoon-studio` subfolder,
and runs the installer. It will ask for your password once — system packages need
`sudo`. When it finishes, launch with **`./start.sh`** from inside that folder (or
the **Raccoon Studio** entry in your application menu / Desktop).

> Want the optional ControlNet + IP-Adapter models (~9 GB) right away? Append the
> flag: `... | bash -s -- --with-controlnet`.

> Already have the repo cloned? Just run `bash bootstrap.sh` — or `bash install-linux.sh` — from inside the folder.

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
