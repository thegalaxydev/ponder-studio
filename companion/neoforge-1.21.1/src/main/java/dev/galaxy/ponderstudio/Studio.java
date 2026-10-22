package dev.galaxy.ponderstudio;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import net.createmod.ponder.api.level.PonderLevel;
import net.createmod.ponder.api.registration.StoryBoardEntry;
import net.createmod.ponder.foundation.PonderIndex;
import net.createmod.ponder.foundation.PonderScene;
import net.createmod.ponder.foundation.PonderStoryBoardEntry;
import net.createmod.ponder.foundation.registration.PonderSceneRegistry;
import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.NbtAccounter;
import net.minecraft.nbt.NbtIo;
import net.minecraft.nbt.Tag;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.levelgen.structure.templatesystem.StructurePlaceSettings;
import net.minecraft.world.level.levelgen.structure.templatesystem.StructureTemplate;

final class Studio {
	private Studio() {
	}

	static JsonElement preview(JsonObject p) throws Exception {
		Minecraft mc = Minecraft.getInstance();
		if (mc.level == null) {
			throw new IllegalStateException("Open a world in the game first; Ponder scenes are built inside a loaded world");
		}
		byte[] bytes = Base64.getDecoder().decode(p.get("structure").getAsString());
		JsonObject board = p.getAsJsonObject("storyboard");
		List<String> warnings = new ArrayList<>(unresolvedBlocks(bytes));
		StructureTemplate template = PonderSceneRegistry.loadSchematic(new ByteArrayInputStream(bytes));
		PonderLevel level = new PonderLevel(BlockPos.ZERO, mc.level);
		template.placeInWorld(level, BlockPos.ZERO, BlockPos.ZERO, new StructurePlaceSettings(), level.random, Block.UPDATE_CLIENTS);
		level.createBackup();
		Storyboard storyboard = new Storyboard(board);
		String namespace = Storyboard.str(board, "namespace", PonderStudioCompanion.MOD_ID);
		ResourceLocation component = ResourceLocation.parse(Storyboard.str(board, "component", "minecraft:stone"));
		StoryBoardEntry entry = new PonderStoryBoardEntry(storyboard.program(), namespace, ResourceLocation.fromNamespaceAndPath(namespace, "studio_preview"), component);
		PonderScene scene = PonderSceneRegistry.compileScene(new PreviewLocalization(), entry, level);
		scene.begin();
		warnings.addAll(storyboard.warnings());
		StudioScreen screen = new StudioScreen(new ArrayList<>(List.of(scene)), "preview");
		mc.setScreen(screen);
		int startAt = Storyboard.integer(p, "startAt", 0);
		if (startAt > 0) {
			screen.seek(startAt);
		}
		screen.paused = Storyboard.bool(p, "paused", false);
		JsonObject out = screen.describe();
		JsonArray w = new JsonArray();
		warnings.forEach(w::add);
		out.add("warnings", w);
		return out;
	}

	static JsonElement play(JsonObject p) {
		Minecraft mc = Minecraft.getInstance();
		if (mc.level == null) {
			throw new IllegalStateException("Open a world in the game first; Ponder scenes are built inside a loaded world");
		}
		ResourceLocation component = ResourceLocation.parse(p.get("component").getAsString());
		List<PonderScene> scenes = new ArrayList<>(PonderIndex.getSceneAccess().compile(component));
		if (scenes.isEmpty()) {
			throw new IllegalArgumentException("No Ponder scenes are registered for " + component);
		}
		JsonArray ids = new JsonArray();
		scenes.forEach(s -> ids.add(s.getId().toString()));
		if (p.has("sceneId") && !p.get("sceneId").isJsonNull()) {
			String wanted = p.get("sceneId").getAsString();
			List<PonderScene> match = scenes.stream().filter(s -> s.getId().toString().equals(wanted)).toList();
			if (match.isEmpty()) {
				throw new IllegalArgumentException(component + " has no scene " + wanted + " (it has " + ids + ")");
			}
			scenes = new ArrayList<>(match);
		}
		StudioScreen screen = new StudioScreen(scenes, "registered");
		mc.setScreen(screen);
		JsonObject out = screen.describe();
		out.add("scenes", ids);
		return out;
	}

	static JsonElement scenes() {
		JsonArray out = new JsonArray();
		Collection<Map.Entry<ResourceLocation, StoryBoardEntry>> entries = PonderIndex.getSceneAccess().getRegisteredEntries();
		for (Map.Entry<ResourceLocation, StoryBoardEntry> e : entries) {
			JsonObject o = new JsonObject();
			o.addProperty("component", e.getKey().toString());
			o.addProperty("namespace", e.getValue().getNamespace());
			o.addProperty("schematic", e.getValue().getSchematicLocation().toString());
			out.add(o);
		}
		return out;
	}

	static JsonElement control(JsonObject p) {
		StudioScreen screen = Minecraft.getInstance().screen instanceof StudioScreen s ? s : null;
		if (screen == null) {
			throw new IllegalStateException("No Ponder Studio scene is open in the game");
		}
		String action = p.get("action").getAsString();
		switch (action) {
			case "pause" -> screen.paused = true;
			case "resume" -> screen.paused = false;
			case "toggle" -> screen.paused = !screen.paused;
			case "restart" -> screen.restart();
			case "seek" -> screen.seek(p.get("tick").getAsInt());
			case "speed" -> screen.speed = Math.max(0.1f, Math.min(8f, p.get("speed").getAsFloat()));
			case "close" -> {
				Minecraft.getInstance().setScreen(null);
				JsonObject closed = new JsonObject();
				closed.addProperty("open", false);
				return closed;
			}
			default -> throw new IllegalArgumentException("Unknown control " + action);
		}
		return screen.describe();
	}

	static JsonObject state() {
		StudioScreen screen = Minecraft.getInstance().screen instanceof StudioScreen s ? s : null;
		if (screen == null) {
			JsonObject o = new JsonObject();
			o.addProperty("open", false);
			return o;
		}
		return screen.describe();
	}

	static List<String> unresolvedBlocks(byte[] bytes) {
		Set<String> missing = new LinkedHashSet<>();
		try {
			CompoundTag nbt = NbtIo.readCompressed(new ByteArrayInputStream(bytes), NbtAccounter.unlimitedHeap());
			List<ListTag> palettes = new ArrayList<>();
			if (nbt.contains("palette", Tag.TAG_LIST)) {
				palettes.add(nbt.getList("palette", Tag.TAG_COMPOUND));
			}
			if (nbt.contains("palettes", Tag.TAG_LIST)) {
				ListTag all = nbt.getList("palettes", Tag.TAG_LIST);
				for (int i = 0; i < all.size(); i++) {
					palettes.add(all.getList(i));
				}
			}
			for (ListTag palette : palettes) {
				for (int i = 0; i < palette.size(); i++) {
					String name = palette.getCompound(i).getString("Name");
					ResourceLocation id = ResourceLocation.tryParse(name);
					if (id == null || !BuiltInRegistries.BLOCK.containsKey(id)) {
						missing.add(name);
					}
				}
			}
		} catch (Exception e) {
			return List.of("The structure could not be read: " + e.getMessage());
		}
		return missing.stream().map(n -> "Unknown block " + n + " is shown as air in the game, because no installed mod adds it").toList();
	}
}
