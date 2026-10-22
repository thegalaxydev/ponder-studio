package dev.galaxy.ponderstudio;

import com.google.gson.JsonObject;
import java.util.List;
import net.createmod.ponder.foundation.PonderScene;
import net.createmod.ponder.foundation.ui.PonderUI;

final class StudioScreen extends PonderUI {
	static volatile StudioScreen current;
	final String source;
	boolean paused;
	float speed = 1f;
	private float accumulator;
	private int lastSent = -1;
	private boolean lastPaused;
	private boolean lastFinished;

	StudioScreen(List<PonderScene> scenes, String source) {
		super(scenes);
		this.source = source;
		current = this;
	}

	@Override
	public void tick() {
		if (!paused) {
			accumulator += speed;
			while (accumulator >= 1f) {
				accumulator -= 1f;
				super.tick();
			}
		}
		PonderScene scene = getActiveScene();
		int time = scene.getCurrentTime();
		boolean finished = scene.isFinished();
		if (time != lastSent && (time % 5 == 0 || finished) || paused != lastPaused || finished != lastFinished) {
			lastSent = time;
			lastPaused = paused;
			lastFinished = finished;
			Api.event("state", describe());
		}
	}

	void restart() {
		seekToTime(0);
		accumulator = 0;
	}

	void seek(int tick) {
		int target = Math.max(0, tick);
		seekToTime(target);
		accumulator = 0;
	}

	@Override
	public void removed() {
		super.removed();
		if (current == this) {
			current = null;
		}
		JsonObject closed = new JsonObject();
		closed.addProperty("open", false);
		Api.event("state", closed);
	}

	JsonObject describe() {
		PonderScene scene = getActiveScene();
		JsonObject o = new JsonObject();
		o.addProperty("open", true);
		o.addProperty("source", source);
		o.addProperty("sceneId", scene.getId().toString());
		o.addProperty("title", scene.getTitle());
		o.addProperty("component", scene.getLocation().toString());
		o.addProperty("currentTime", scene.getCurrentTime());
		o.addProperty("totalTime", scene.getTotalTime());
		o.addProperty("finished", scene.isFinished());
		o.addProperty("paused", paused);
		o.addProperty("speed", speed);
		return o;
	}
}
