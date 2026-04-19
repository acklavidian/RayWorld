# Modular Asset Pipeline

Development tooling for scanning, classifying, and validating modular 3D assets and hand-authored maps.

## Pipeline Steps

Run in order:

```sh
deno task asset:scan       # 1. Scan FBX directory → scan_manifest.json
deno task asset:classify   # 2. Classify assets → classified_assets.json
deno task asset:library    # 3. Enrich → asset_library.json
deno task asset:validate   # 4. Validate the library
deno task map:example      # 5. Generate example_test_corridor_map.json
deno task map:validate data/modular/example_test_corridor_map.json  # 6. Validate map
```

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

### Data (`data/modular/`)

| File | Type | Purpose |
|------|------|---------|
| `scan_manifest.json` | Generated | Raw scan of asset files |
| `classified_assets.json` | Generated | Classification with confidence scores |
| `asset_library.json` | Generated | Full enriched asset records |
| `socket_compatibility.json` | Static | Socket connection rules |
| `example_test_corridor_map.json` | Generated | Example map for testing |

## Asset Classification

Assets are classified by filename pattern matching on `SM_*` names. Classification confidence:
- **0.95** — Exact structural keyword match (Wall, Floor, Door, etc.)
- **0.75** — Fuzzy/inferred match
- **0.30** — Unknown (requires manual review)

## Map Format

Maps are JSON files with grid-based placements:
- Grid cells have configurable size (default 2x2x2 meters)
- Placements reference asset IDs with position and rotation (0/90/180/270)
- Socket compatibility is checked between adjacent cells
- Footprint overlap detection prevents invalid layouts
