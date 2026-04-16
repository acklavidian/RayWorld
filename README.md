# RayWorld

A multiplayer 3D demo built with [Deno](https://deno.com) and [raylib](https://www.raylib.com). Load a Blender scene, host or join a server, and walk around with other players in real time.

## Getting Started

### Prerequisites

**Deno** v2.0 or later — https://deno.com

Install it with one command:

| Platform | Command |
|----------|---------|
| macOS / Linux | `curl -fsSL https://deno.land/install.sh \| sh` |
| Windows (PowerShell) | `irm https://deno.land/install.ps1 \| iex` |

Verify the install worked:

```bash
deno --version
```

### Cloning the repo

This project uses a git submodule for the raylib bindings. Clone it with submodules in one step:

```bash
git clone --recurse-submodules https://github.com/JJLDonley/DenoRaylib550
```

If you already cloned without `--recurse-submodules`, initialise the submodule afterwards:

```bash
git submodule update --init
```

### Scene Setup

The game loads its world from `assets/scene.glb`. You need to export a Blender scene there before running.

In Blender:

1. Add an **Empty** named `player` — this sets the spawn point.
2. Add a mesh named `nav_mesh` — this defines the walkable surfaces (the player is constrained to it).
3. Apply all transforms before exporting: `Ctrl+A` → **All Transforms**.
4. Export as GLB to `assets/scene.glb` (`File → Export → glTF 2.0`, format: **GLB**).

A sample scene (`assets/scene.blend`) is included in the repo if you want a starting point.

### Running in Development

```bash
deno task dev
```

This starts the game with `--watch`, so it reloads automatically when source files change.

### Building a Release Binary

| Platform | Command |
|----------|---------|
| Windows  | `deno task W_Build` |
| Linux    | `deno task L_Build` |
| macOS    | `deno task M_Build` |

Each command produces a standalone `mygame.exe` (or equivalent) that bundles the Deno runtime — no separate install needed on the target machine.

## How to Play

### Main Menu

When the game launches you land on the main menu:

- **Host Game** — starts a local server on port `7777` and connects you to it automatically.
- **Join Game (Browse)** — opens the server browser where you can enter a host address and port to join a remote game.

Up to **8 players** can be in the same session.

### Controls

| Input | Action |
|-------|--------|
| `W A S D` | Move |
| Mouse | Look around |
| `Space` | Jump |
| `ESC` | Return to main menu |

### Multiplayer

To play with others on the same network:

1. One player clicks **Host Game**.
2. Other players click **Join Game (Browse)** and enter the host's IP address with port `7777`.

Players appear as capsules with nametags. Their positions are synced at 20 updates per second with smooth interpolation on your end.
