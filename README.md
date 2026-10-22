# Ponder Studio

A [Modsmith](https://github.com/thegalaxydev/modsmith) extension for viewing, creating and editing [Create](https://modrinth.com/mod/create) Ponder tutorials.

- Open a Ponder structure (`assets/<mod>/ponder/**/*.nbt`) to see it in 3D and edit its blocks.
- Lay out the tutorial on a timeline: reveals, captions, highlights, interaction hints, camera turns, kinetic speeds, block changes and moving sections.
- Play it through the real Ponder in the project's own development client, with pause, restart, speed and seeking.
- Export the Java storyboard, scene registration and lang entries, then build and launch.
- Import storyboards that were written by hand in Java.

## Requirements

- Modsmith 0.1.13 or newer. Ponder Studio uses companion mods, bridge events and binary file writes, which arrived in 0.1.13. Blocks are drawn with their textures and models from Modsmith 0.1.16; with older versions they are coloured boxes. Modsmith 0.1.17 adds Create's connected textures and draws blocks that are saved without all of their properties, such as blocks placed in the editor.
- For playback and export: a NeoForge 1.21.1 project with Create 6 as a runtime mod of the development client.

Verified with NeoForge 21.1.262, Minecraft 1.21.1, Create 6.0.10 and Ponder 1.0.82+mc1.21.1 (bundled in Create) on Windows 11.

## Using it

### Opening a structure

Click a `.nbt` file under `src/main/resources/assets/<mod>/ponder/`. If a storyboard already uses it, the storyboard opens. Otherwise Ponder Studio shows the structure and offers **Create storyboard**. The **Ponder** panel on the left rail lists the project's storyboards, structures that have none yet, and the scenes registered in the running game.

Blocks are drawn with the models and textures from the project, its mods (such as Create) and Minecraft, following each block state's blockstate file: rotations, multipart pieces such as redstone wire, tinted grass, leaves and water, and connected textures such as Create's casings. Parts that the game draws in code, such as the spinning middle of a shaft, belts, chests, fluids and the steam engine's piston, are not models, so they appear as simple shapes or are left out; powered shafts are drawn with a plain shaft.

### Build mode

- Right-drag orbits, middle-drag or Shift+right-drag pans, and the wheel zooms.
- Tools: select (click, Shift+click for a box between two blocks, drag for a marquee; Ctrl adds and Alt removes), place, remove, replace, and eyedropper.
- Block states are edited in the properties panel, and the typed NBT inspector edits block-entity data (tree or SNBT).
- Ctrl+C and Ctrl+V copy and paste blocks with their data. Delete removes the selection.
- The layer bar shows all layers, one layer, or a layer and everything below it.
- The base plate offset and size, and whether it is shown, are scene settings.
- Ctrl+Z and Ctrl+Y undo and redo structure edits and storyboard edits.

Blocks that Ponder Studio does not know, block-entity data and NBT types are kept as they are. A structure that is opened and saved without changes is written back byte for byte. All 178 structures in Create 6.0.10 are checked against this in the tests.

### Storyboard mode

The timeline has five tracks: Structure, Text, Highlights, Camera and Kinetics. Use the **+** on a track to add an action at the playhead, for the selected blocks or named selection.

- Drag an action to move it and drag its end to resize it. Moves snap to 5 ticks (hold Alt for 1 tick), and Ctrl+wheel zooms the timeline.
- Times are whole ticks; seconds are shown at 20 ticks per second.
- Ctrl+D duplicates the selected action, Delete removes it, and Space plays or pauses the preview.
- **Selections** saves the current blocks under a name, so actions can refer to them. Problems such as a selection that points at air or a caption anchored to a missing block are marked on the timeline and listed under Problems in the scene properties.

Actions that overlap run at the same time, as they do in Ponder. Only gaps become `idle` calls.

The preview in the editor shows which blocks are visible, captions, outlines and the camera with the blocks' textures, but not Create's animation. **Play in Minecraft** sends the storyboard to the development client and opens it in the real Ponder screen. The second set of playback buttons controls that screen, and seeking replays from the start, as Ponder does.

### Saving

A storyboard is saved as `src/main/ponderstudio/<scene id>.ponderstudio.json` beside the structure, which stays a separate `.nbt` file. If either file changed on disk since it was opened, Ponder Studio asks before overwriting it.

### Export

**Export…** shows the files it will write before writing anything:

- `<package>.ponder.scenes.<Name>Scene` with the storyboard,
- `<package>.ponder.PonderStudioPlugin`, which registers every storyboard in the project,
- `<package>.ponder.PonderStudioClient`, which adds the plugin during client setup when Ponder is installed,
- the scene titles and captions in `assets/<mod>/lang/en_us.json`.

If the project does not compile against Create and Ponder yet, the dialog offers to add `ponderstudio.gradle` with compile-only dependencies from Create's maven and apply it from `build.gradle`.

Ponder Studio records what it wrote in `src/main/ponderstudio/ponderstudio.lock.json`. A file that was changed by hand, or that Ponder Studio did not write, is listed and left alone unless you tick it. Lang entries are merged into the existing file and keep its indentation; hand-written entries are kept, and entries Ponder Studio no longer needs are removed. Exporting twice gives the same files.

Export uses a version adapter for the project's loader, Minecraft version and the installed Create and Ponder. The only adapter so far is NeoForge 1.21.1 with Ponder 1.x and Create 6.x.

Open the exported scene in the game with **Play** in the Ponder panel, or with `/ponder <item>` for the item the scene is registered on.

### Importing Java

**Import Java…** reads a storyboard method from a Java file in `src/main/java` and creates a new storyboard from it. The source file is not changed. Statements outside this subset are listed with their line numbers as not imported:

- `CreateSceneBuilder scene = new CreateSceneBuilder(builder)`
- `scene.title`, `configureBasePlate`, `showBasePlate`, `scaleSceneView`
- `scene.idle`, `idleSeconds`, `markAsFinished`, `rotateCameraY`, `addKeyframe`
- `scene.world()`: `showSection`, `hideSection`, `setKineticSpeed`, `showIndependentSection`, `makeSectionIndependent`, `moveSection`, `rotateSection`
- `scene.overlay()`: `showText(...).text(...).pointAt(...).placeNearTarget().colored(...).attachKeyFrame().independent(...)`, `showOutline`, `showControls(...).rightClick().leftClick().scroll().whileSneaking().whileCTRL()`
- `Selection`, `BlockPos` and `Vec3` local variables built from `util.select()` (`position`, `fromTo`, `cuboid`, `layer`, `layersFrom`, `column`, `everywhere`, `.add`), `util.grid()` and `util.vector()`

Loops, conditions, helper methods and other custom code are reported, not run.

## Document format

`.ponderstudio.json` files are indented JSON. Actions refer to named selections by id, and are kept in the order they were authored:

```json
{
  "format": "ponderstudio",
  "version": 1,
  "scene": { "namespace": "cogdemo", "id": "shaft_demo", "title": "Relaying rotation with shafts", "component": "create:shaft", "tags": [] },
  "structure": { "file": "src/main/resources/assets/cogdemo/ponder/shaft_demo.nbt", "schematic": "shaft_demo" },
  "basePlate": { "x": 0, "z": 0, "size": 5, "show": true },
  "length": 140,
  "selections": [{ "id": "sel1", "name": "Cogwheel", "boxes": [[5, 1, 2, 5, 1, 2]] }],
  "actions": [
    { "id": "a1", "type": "show", "at": 0, "selection": "sel1", "direction": "down" },
    { "id": "a2", "type": "kinetic", "at": 25, "selection": "sel1", "speed": 32 },
    { "id": "a3", "type": "text", "at": 30, "duration": 80, "text": "The cogwheel turns.", "placeNearTarget": true, "keyframe": true, "anchor": { "kind": "face", "pos": [5, 1, 2], "face": "east" } }
  ]
}
```

Action types: `show`, `hide`, `block_state`, `move`, `rotate`, `text`, `outline`, `input`, `rotate_camera`, `keyframe` and `kinetic`. A newer `version` is refused rather than read partly.

## Building

```bash
npm install
npm run fetch-libs
npm run build
npm test
```

`fetch-libs` downloads Create 6.0.10 from Modrinth, checks its SHA-512 and extracts the Ponder and Flywheel jars that the companion mod compiles against. `build` bundles the web code, builds the companion mod with Gradle (JDK 21 or newer) and packs `dist/galaxy.ponder-studio-<version>.zip`, which can be installed from Settings, Extensions in Modsmith.

The companion mod (`companion/neoforge-1.21.1`) is client-only. It registers bridge methods under `ext.galaxy.ponder-studio.` and reports the Create and Ponder versions it finds. Create and Ponder are optional dependencies, so projects without them still launch.

## Limitations

- Only NeoForge 1.21.1 is supported for playback and export. Fabric and other versions need their own adapter and companion build.
- The editor preview draws block models but not what the game draws in code (spinning parts, belts, fluids) or animation; use **Play in Minecraft** for that.
- Selecting blocks by clicking inside the Minecraft window is not supported; select them in Ponder Studio's viewport.
- Java import covers the subset above.
- Extension frames were not tried on Linux.

## License

Apache-2.0
