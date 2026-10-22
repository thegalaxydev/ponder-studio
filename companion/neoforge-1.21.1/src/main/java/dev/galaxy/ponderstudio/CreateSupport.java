package dev.galaxy.ponderstudio;

import com.simibubi.create.foundation.ponder.CreateSceneBuilder;
import net.createmod.ponder.api.scene.SceneBuilder;
import net.createmod.ponder.api.scene.Selection;

final class CreateSupport {
	private CreateSupport() {
	}

	static SceneBuilder wrap(SceneBuilder builder) {
		return new CreateSceneBuilder(builder);
	}

	static void setKineticSpeed(SceneBuilder scene, Selection selection, float speed) {
		CreateSceneBuilder create = scene instanceof CreateSceneBuilder c ? c : new CreateSceneBuilder(scene);
		create.world().setKineticSpeed(selection, speed);
	}
}
