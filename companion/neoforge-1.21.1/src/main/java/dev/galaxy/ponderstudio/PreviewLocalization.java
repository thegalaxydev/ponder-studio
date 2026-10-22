package dev.galaxy.ponderstudio;

import java.util.Map;
import net.createmod.ponder.foundation.registration.PonderLocalization;
import net.minecraft.resources.ResourceLocation;

final class PreviewLocalization extends PonderLocalization {
	@Override
	public String getSpecific(ResourceLocation sceneId, String k) {
		Map<String, String> m = specific.get(sceneId);
		return m != null && m.containsKey(k) ? m.get(k) : super.getSpecific(sceneId, k);
	}

	@Override
	public String getSpecific(ResourceLocation sceneId, String k, Object... params) {
		Map<String, String> m = specific.get(sceneId);
		return m != null && m.containsKey(k) ? String.format(m.get(k), params) : super.getSpecific(sceneId, k, params);
	}
}
