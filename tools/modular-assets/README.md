# Modular Asset Pipeline

Development tooling for scanning, classifying, converting, and validating modular 3D assets and hand-authored maps.

## Pipeline Steps

Run in order:

```sh
deno task asset:scan       # 1. Scan FBX directory → scan_manifest.json
deno task asset:classify   # 2. Classify assets → classified_assets.json
deno task asset:library    # 3. Enrich → asset_library.json
deno task asset:validate   # 4. Validate the library
deno task asset:convert    # 5. Batch convert FBX → GLB (requires Blender)
deno task map:validate data/modular/example_test_corridor_map.json  # 6. Validate map
```

## Asset Conversion

The conversion step (`convert_to_glb.py`) runs in Blender and applies two normalizations to every asset:

1. **Scale normalization** — the largest XZ dimension is scaled to `TARGET_GRID_SIZE` (4m). Assets that are already within 5% of the target are left unchanged.
2. **Origin normalization** — the mesh origin is moved to bottom-center: XZ centered, Y=0 at the base. This means every asset sits on the ground at its placement position.

Source FBX files: `assets/scifi_assets/fbx/`
Output GLB files: `assets/scifi_assets/glb/` (gitignored — regenerate with `deno task asset:convert`)

## Files

### Tools (`tools/modular-assets/`)

| File | Purpose |
|------|---------|
| `types.ts` | Shared types, constants, socket utilities |
| `scan.ts` | Scan asset directory for FBX/OBJ/GLB files |
| `classify.ts` | Classify assets by role using filename patterns |
| `generate_library.ts` | Enrich classified assets into full library |
| `validate_assets.ts` | Validate asset library for correctness |
| `validate_map.ts` | Validate a map against the asset library |
| `generate_example.ts` | Generate an example test corridor map |
| `convert_to_glb.py` | Blender batch converter: FBX → GLB with normalization |

### Data (`data/modular/`)

| File | Type | Purpose |
|------|------|---------|
| `scan_manifest.json` | Generated | Raw scan of asset files |
| `classified_assets.json` | Generated | Classification with confidence scores |
| `asset_library.json` | Generated | Full enriched asset records (60 assets) |
| `socket_compatibility.json` | Static | Socket connection rules |
| `example_test_corridor_map.json` | Hand-authored | Sci-Fi Complex test map |

## Asset Classification

Assets are classified by filename pattern matching on `SM_*` names. Classification confidence:
- **0.95** — Exact structural keyword match (Wall, Floor, Door, etc.)
- **0.75** — Fuzzy/inferred match
- **0.30** — Unknown (requires manual review)

## Map Format

Maps are JSON files with grid-based placements. Key conventions:

- `cellSize [4, 4, 4]` — each grid unit is 4m in world space
- **Floor/ceiling tiles** at integer grid positions
- **Walls** at half-integer positions on cell edges (e.g. `[-0.5, 0, 0]`)
- **Wall rotation**: `0` = blocks X passage (E/W), `90` = blocks Z passage (N/S)
- **Ceiling flag**: set `"ceiling": true` on placements to skip physics colliders and shadow depth pass
- **Spawn** is in world coordinates (not grid coordinates)

### Placement Fields

| Field | Required | Description |
|-------|----------|-------------|
| `assetId` | Yes | Asset ID from the library |
| `position` | Yes | Grid coordinates `[x, y, z]` — world = position × cellSize |
| `rotation` | Yes | Y-axis rotation in degrees (0, 90, 180, 270) |
| `ceiling` | No | `true` to skip physics and shadow casting |
| `notes` | No | Comment string (ignored at runtime) |
