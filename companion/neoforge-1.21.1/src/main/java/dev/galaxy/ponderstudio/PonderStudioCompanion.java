package dev.galaxy.ponderstudio;

import net.neoforged.api.distmarker.Dist;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;

@Mod(value = PonderStudioCompanion.MOD_ID, dist = Dist.CLIENT)
public final class PonderStudioCompanion {
	public static final String MOD_ID = "ponder_studio";
	public static final String PREFIX = "ext.galaxy.ponder-studio.";
	public static final int PROTOCOL = 1;

	public PonderStudioCompanion(ModContainer container) {
		Api.register(container.getModInfo().getVersion().toString());
	}
}
