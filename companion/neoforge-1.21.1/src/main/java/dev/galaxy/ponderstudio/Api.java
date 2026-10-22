package dev.galaxy.ponderstudio;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.modsmith.bridge.Bridge;
import dev.modsmith.bridge.Handler;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import net.minecraft.SharedConstants;
import net.minecraft.client.Minecraft;
import net.neoforged.fml.ModList;

public final class Api {
	static final List<String> METHODS = List.of("status", "preview", "play", "scenes", "control", "state");
	private static String version = "0";

	private Api() {
	}

	static void register(String companionVersion) {
		version = companionVersion;
		Bridge.register(PonderStudioCompanion.PREFIX + "status", p -> onClient(Api::status));
		Bridge.register(PonderStudioCompanion.PREFIX + "preview", ponder(p -> onClient(() -> Studio.preview(p))));
		Bridge.register(PonderStudioCompanion.PREFIX + "play", ponder(p -> onClient(() -> Studio.play(p))));
		Bridge.register(PonderStudioCompanion.PREFIX + "scenes", ponder(p -> onClient(Studio::scenes)));
		Bridge.register(PonderStudioCompanion.PREFIX + "control", ponder(p -> onClient(() -> Studio.control(p))));
		Bridge.register(PonderStudioCompanion.PREFIX + "state", ponder(p -> onClient(Studio::state)));
		Bridge.LOGGER.info("Ponder Studio companion {} registered {} bridge methods", companionVersion, METHODS.size());
	}

	static String modVersion(String id) {
		return ModList.get().getModContainerById(id).map(c -> c.getModInfo().getVersion().toString()).orElse(null);
	}

	static boolean hasPonder() {
		return ModList.get().isLoaded("ponder");
	}

	static boolean hasCreate() {
		return ModList.get().isLoaded("create");
	}

	private static JsonElement status() {
		JsonObject o = new JsonObject();
		o.addProperty("protocol", PonderStudioCompanion.PROTOCOL);
		o.addProperty("companion", version);
		o.addProperty("minecraft", SharedConstants.getCurrentVersion().getName());
		o.addProperty("loader", "neoforge");
		o.addProperty("ponder", modVersion("ponder"));
		o.addProperty("create", modVersion("create"));
		o.addProperty("inWorld", Minecraft.getInstance().level != null);
		JsonArray methods = new JsonArray();
		METHODS.forEach(m -> methods.add(PonderStudioCompanion.PREFIX + m));
		o.add("methods", methods);
		JsonArray capabilities = new JsonArray();
		if (hasPonder()) {
			capabilities.add("preview");
			capabilities.add("play_registered");
			capabilities.add("pause");
			capabilities.add("speed");
			capabilities.add("seek_by_replay");
		}
		if (hasCreate()) {
			capabilities.add("kinetics");
		}
		o.add("capabilities", capabilities);
		o.add("screen", hasPonder() ? Studio.state() : new JsonObject());
		return o;
	}

	private static Handler ponder(Handler h) {
		return p -> {
			if (!hasPonder()) {
				throw new IllegalStateException("Ponder is not installed in this game. Add Create (which includes Ponder) to the run configuration.");
			}
			return h.handle(p);
		};
	}

	interface ClientCall {
		JsonElement run() throws Exception;
	}

	static CompletableFuture<JsonElement> onClient(ClientCall call) {
		CompletableFuture<JsonElement> out = new CompletableFuture<>();
		Minecraft.getInstance().execute(() -> {
			try {
				out.complete(call.run());
			} catch (Throwable t) {
				out.completeExceptionally(t);
			}
		});
		return out;
	}

	static void event(String name, JsonObject data) {
		Bridge.event(PonderStudioCompanion.PREFIX + name, data);
	}
}
