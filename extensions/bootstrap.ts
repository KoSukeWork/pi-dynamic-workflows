import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installDeliverySteal } from "../src/delivery-steal.js";
import { installDeferred } from "./lazy-extension.js";

// Prototype patch must land before Pi's AgentSession._bindExtensionCore.
installDeliverySteal();

export default function (pi: ExtensionAPI) {
	installDeferred(pi, () => import("./workflow.js"), {
		commands: [
			{ name: "workflows", description: "List and manage dynamic workflows" },
			{ name: "workflows-models", description: "Configure workflow model routing" },
			{ name: "workflows-progress", description: "Show workflow progress" },
			{ name: "workflows-trigger", description: "Enable or disable the workflow keyword trigger" },
			{ name: "effort", description: "Set workflow effort level" },
			{ name: "ultracode", description: "Run an ultracode workflow" },
			{ name: "adversarial-review", description: "Run the adversarial-review workflow" },
			{ name: "code-review", description: "Run the code-review workflow" },
			{ name: "multi-perspective", description: "Run the multi-perspective workflow" },
			{ name: "codebase-audit", description: "Run the codebase-audit workflow" },
		],
	});
}
