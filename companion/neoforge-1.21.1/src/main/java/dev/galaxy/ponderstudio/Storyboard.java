package dev.galaxy.ponderstudio;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import net.createmod.catnip.math.Pointing;
import net.createmod.ponder.api.PonderPalette;
import net.createmod.ponder.api.element.ElementLink;
import net.createmod.ponder.api.element.InputElementBuilder;
import net.createmod.ponder.api.element.TextElementBuilder;
import net.createmod.ponder.api.element.WorldSectionElement;
import net.createmod.ponder.api.scene.PonderStoryBoard;
import net.createmod.ponder.api.scene.SceneBuilder;
import net.createmod.ponder.api.scene.SceneBuildingUtil;
import net.createmod.ponder.api.scene.Selection;
import net.minecraft.commands.arguments.blocks.BlockStateParser;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.Vec3;

public final class Storyboard {
	private final JsonObject board;
	private final List<String> warnings = new ArrayList<>();

	public Storyboard(JsonObject board) {
		this.board = board;
	}

	public List<String> warnings() {
		return warnings;
	}

	public PonderStoryBoard program() {
		return this::program;
	}

	private void program(SceneBuilder builder, SceneBuildingUtil util) {
		warnings.clear();
		SceneBuilder scene = Api.hasCreate() ? CreateSupport.wrap(builder) : builder;
		scene.title(str(board, "sceneId", "scene"), str(board, "title", "Untitled scene"));
		if (board.has("basePlate") && board.get("basePlate").isJsonObject()) {
			JsonObject bp = board.getAsJsonObject("basePlate");
			scene.configureBasePlate(integer(bp, "x", 0), integer(bp, "z", 0), integer(bp, "size", 5));
		}
		if (board.has("scale")) {
			scene.scaleSceneView(board.get("scale").getAsFloat());
		}
		if (bool(board, "showBasePlate", true)) {
			scene.showBasePlate();
		}
		Map<String, ElementLink<WorldSectionElement>> links = new HashMap<>();
		int now = 0;
		JsonArray actions = board.has("actions") ? board.getAsJsonArray("actions") : new JsonArray();
		for (JsonElement el : actions) {
			JsonObject a = el.getAsJsonObject();
			int at = integer(a, "at", now);
			if (at > now) {
				scene.idle(at - now);
				now = at;
			}
			try {
				apply(scene, util, a, links);
			} catch (RuntimeException e) {
				warnings.add("Action " + str(a, "id", "?") + " (" + str(a, "type", "?") + "): " + e.getMessage());
			}
		}
		int end = integer(board, "end", now);
		if (end > now) {
			scene.idle(end - now);
		}
		scene.markAsFinished();
	}

	private void apply(SceneBuilder scene, SceneBuildingUtil util, JsonObject a, Map<String, ElementLink<WorldSectionElement>> links) {
		String type = str(a, "type", "");
		switch (type) {
			case "show" -> scene.world().showSection(selection(util, a), direction(a, "direction", Direction.DOWN));
			case "hide" -> scene.world().hideSection(selection(util, a), direction(a, "direction", Direction.UP));
			case "text" -> {
				TextElementBuilder t = scene.overlay().showText(integer(a, "duration", 60)).text(str(a, "text", ""));
				if (a.has("color") && !a.get("color").isJsonNull()) {
					t.colored(palette(a.get("color").getAsString()));
				}
				Vec3 anchor = anchor(util, a);
				if (anchor != null) {
					t.pointAt(anchor);
				} else {
					t.independent(integer(a, "screenY", 0));
				}
				if (bool(a, "placeNearTarget", false)) {
					t.placeNearTarget();
				}
				if (bool(a, "keyframe", false)) {
					t.attachKeyFrame();
				}
			}
			case "outline" -> scene.overlay().showOutline(palette(str(a, "color", "white")), str(a, "id", "outline"), selection(util, a), integer(a, "duration", 60));
			case "input" -> {
				Vec3 anchor = anchor(util, a);
				if (anchor == null) {
					throw new IllegalArgumentException("an input hint needs a block, face or point");
				}
				InputElementBuilder in = scene.overlay().showControls(anchor, Pointing.valueOf(str(a, "pointing", "down").toUpperCase(Locale.ROOT)), integer(a, "duration", 60));
				switch (str(a, "click", "")) {
					case "right" -> in.rightClick();
					case "left" -> in.leftClick();
					case "scroll" -> in.scroll();
					default -> {
					}
				}
				if (a.has("item") && !a.get("item").isJsonNull() && !a.get("item").getAsString().isEmpty()) {
					ResourceLocation id = ResourceLocation.parse(a.get("item").getAsString());
					if (!BuiltInRegistries.ITEM.containsKey(id)) {
						throw new IllegalArgumentException("unknown item " + id);
					}
					in.withItem(new ItemStack(BuiltInRegistries.ITEM.get(id)));
				}
				if (bool(a, "sneaking", false)) {
					in.whileSneaking();
				}
				if (bool(a, "ctrl", false)) {
					in.whileCTRL();
				}
			}
			case "rotate_camera" -> scene.rotateCameraY(a.get("degrees").getAsFloat());
			case "kinetic" -> {
				if (!Api.hasCreate()) {
					throw new IllegalStateException("kinetic speed needs Create in the game");
				}
				CreateSupport.setKineticSpeed(scene, selection(util, a), a.get("speed").getAsFloat());
			}
			case "block_state" -> scene.world().setBlocks(selection(util, a), blockState(str(a, "state", "")), bool(a, "particles", false));
			case "move" -> {
				JsonArray o = a.getAsJsonArray("offset");
				scene.world().moveSection(link(scene, util, a, links), new Vec3(o.get(0).getAsDouble(), o.get(1).getAsDouble(), o.get(2).getAsDouble()), integer(a, "duration", 20));
			}
			case "rotate" -> {
				JsonArray r = a.getAsJsonArray("rotation");
				scene.world().rotateSection(link(scene, util, a, links), r.get(0).getAsDouble(), r.get(1).getAsDouble(), r.get(2).getAsDouble(), integer(a, "duration", 20));
			}
			case "keyframe" -> scene.addKeyframe();
			default -> throw new IllegalArgumentException("unsupported action type " + type);
		}
	}

	private ElementLink<WorldSectionElement> link(SceneBuilder scene, SceneBuildingUtil util, JsonObject a, Map<String, ElementLink<WorldSectionElement>> links) {
		String key = a.has("section") ? a.get("section").getAsString() : a.get("selection").toString();
		return links.computeIfAbsent(key, k -> scene.world().makeSectionIndependent(selection(util, a)));
	}

	static Selection selection(SceneBuildingUtil util, JsonObject a) {
		JsonArray boxes = a.getAsJsonArray("selection");
		if (boxes == null || boxes.isEmpty()) {
			throw new IllegalArgumentException("the selection is empty");
		}
		Selection out = null;
		for (JsonElement b : boxes) {
			JsonArray c = b.getAsJsonArray();
			Selection s = util.select().fromTo(c.get(0).getAsInt(), c.get(1).getAsInt(), c.get(2).getAsInt(), c.get(3).getAsInt(), c.get(4).getAsInt(), c.get(5).getAsInt());
			out = out == null ? s : out.add(s);
		}
		return out;
	}

	static Vec3 anchor(SceneBuildingUtil util, JsonObject a) {
		if (!a.has("anchor") || !a.get("anchor").isJsonObject()) {
			return null;
		}
		JsonObject an = a.getAsJsonObject("anchor");
		String kind = str(an, "kind", "none");
		switch (kind) {
			case "block" -> {
				JsonArray p = an.getAsJsonArray("pos");
				return util.vector().centerOf(p.get(0).getAsInt(), p.get(1).getAsInt(), p.get(2).getAsInt());
			}
			case "top" -> {
				JsonArray p = an.getAsJsonArray("pos");
				return util.vector().topOf(p.get(0).getAsInt(), p.get(1).getAsInt(), p.get(2).getAsInt());
			}
			case "face" -> {
				JsonArray p = an.getAsJsonArray("pos");
				return util.vector().blockSurface(new BlockPos(p.get(0).getAsInt(), p.get(1).getAsInt(), p.get(2).getAsInt()), direction(an, "face", Direction.UP));
			}
			case "point" -> {
				JsonArray p = an.getAsJsonArray("point");
				return util.vector().of(p.get(0).getAsDouble(), p.get(1).getAsDouble(), p.get(2).getAsDouble());
			}
			default -> {
				return null;
			}
		}
	}

	static BlockState blockState(String text) {
		try {
			return BlockStateParser.parseForBlock(BuiltInRegistries.BLOCK.asLookup(), text, false).blockState();
		} catch (Exception e) {
			throw new IllegalArgumentException("invalid block state " + text + ": " + e.getMessage());
		}
	}

	static PonderPalette palette(String name) {
		return PonderPalette.valueOf(name.toUpperCase(Locale.ROOT));
	}

	static Direction direction(JsonObject o, String key, Direction fallback) {
		if (!o.has(key) || o.get(key).isJsonNull()) {
			return fallback;
		}
		Direction d = Direction.byName(o.get(key).getAsString().toLowerCase(Locale.ROOT));
		if (d == null) {
			throw new IllegalArgumentException("unknown direction " + o.get(key).getAsString());
		}
		return d;
	}

	static String str(JsonObject o, String key, String fallback) {
		return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsString() : fallback;
	}

	static int integer(JsonObject o, String key, int fallback) {
		return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsInt() : fallback;
	}

	static boolean bool(JsonObject o, String key, boolean fallback) {
		return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsBoolean() : fallback;
	}
}
