// src/delivery-steal.ts
import { AgentSession, ExtensionRunner } from "@earendil-works/pi-coding-agent";
var boundSessionSends = /* @__PURE__ */ new Map();
var lastHostSession;
var agentSessionPatched = false;
var bindCoreObserved = false;
function hostSessionIdToSteal(session) {
  const sm = session.sessionManager;
  if (!sm) return void 0;
  if (sm.persist === false) return void 0;
  if (session._resourceLoader?.noExtensions === true) return void 0;
  try {
    const name = sm.getSessionName?.();
    if (typeof name === "string" && name.startsWith("workflow:")) return void 0;
  } catch {
  }
  if (typeof session.sendCustomMessage !== "function") return void 0;
  try {
    const sid = sm.getSessionId?.();
    if (typeof sid === "string" && sid) return sid;
  } catch {
    return void 0;
  }
  return void 0;
}
function captureHostSessionSend(session) {
  const sid = hostSessionIdToSteal(session);
  if (!sid) return;
  lastHostSession = session;
  boundSessionSends.set(sid, (message, options) => session.sendCustomMessage(message, options));
}
function patchAgentSessionCapture() {
  if (agentSessionPatched) return;
  agentSessionPatched = true;
  try {
    const proto = AgentSession.prototype;
    const original = proto._bindExtensionCore;
    if (typeof original !== "function") return;
    proto._bindExtensionCore = function patchedBindExtensionCore(runner) {
      try {
        captureHostSessionSend(this);
      } catch {
      }
      return original.apply(this, [runner]);
    };
  } catch {
  }
}
function patchBindCoreObserve() {
  if (bindCoreObserved) return;
  bindCoreObserved = true;
  try {
    const proto = ExtensionRunner.prototype;
    const original = proto.bindCore;
    if (typeof original !== "function") return;
    proto.bindCore = function patchedBindCore(...args) {
      return original.apply(this, args);
    };
  } catch {
  }
}
function installDeliverySteal() {
  patchAgentSessionCapture();
  patchBindCoreObserve();
}
installDeliverySteal();

// extensions/lazy-extension.ts
var REPLAY_EVENTS = ["session_start", "resources_discover"];
var BLOCKING_EVENTS = [
  "session_shutdown",
  "session_before_switch",
  "session_before_fork",
  "session_before_compact",
  "session_compact",
  "session_tree",
  "before_agent_start",
  "before_provider_request",
  "before_provider_headers",
  "input",
  "tool_call",
  "tool_result",
  "tool_execution_end",
  "agent_start",
  "agent_end",
  "agent_settled",
  "message_start",
  "message_end",
  "turn_end",
  "model_select",
  "thinking_level_select",
  "context"
];
function tryRefreshAutocomplete(pi) {
  try {
    const ui = pi.ui;
    ui?.addAutocompleteProvider?.((provider) => provider);
  } catch {
  }
}
function wrapRuntimePi(pi, pending, realCommands) {
  const origOn = pi.on.bind(pi);
  const origRegisterCommand = pi.registerCommand.bind(pi);
  return new Proxy(pi, {
    get(target, prop, receiver) {
      if (prop === "on") {
        return (event, handler) => {
          origOn(event, handler);
          const saved = pending.get(event);
          if (!saved) return;
          try {
            void handler(saved.event, saved.ctx);
          } catch (error) {
            const message = error instanceof Error ? error.stack ?? error.message : String(error);
            console.error(`[pi-lazy-extension] replay ${event} failed: ${message}`);
          }
        };
      }
      if (prop === "registerCommand") {
        return (name, options) => {
          realCommands.set(name, options.handler);
          return origRegisterCommand(name, options);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
function installDeferred(pi, load, options = {}) {
  const pending = /* @__PURE__ */ new Map();
  const realCommands = /* @__PURE__ */ new Map();
  const runtimePi = wrapRuntimePi(pi, pending, realCommands);
  let ready;
  const ensure = () => {
    if (!ready) {
      ready = load().then((mod) => {
        if (typeof mod.default !== "function") {
          throw new Error("Extension runtime does not export a factory");
        }
        return mod.default(runtimePi);
      }).then((result) => {
        tryRefreshAutocomplete(pi);
        return result;
      });
      void ready.catch((error) => {
        const message = error instanceof Error ? error.stack ?? error.message : String(error);
        console.error(`[pi-lazy-extension] deferred install failed: ${message}`);
      });
    }
    return ready;
  };
  for (const command of options.commands ?? []) {
    pi.registerCommand(command.name, {
      description: command.description,
      handler: async (args, ctx) => {
        await ensure();
        const handler = realCommands.get(command.name);
        if (!handler) {
          throw new Error(`/${command.name} failed to load`);
        }
        return handler(args, ctx);
      }
    });
  }
  const on = pi.on;
  for (const event of REPLAY_EVENTS) {
    on(event, (e, ctx) => {
      pending.set(event, { event: e, ctx });
      if (event === "session_start") {
        setTimeout(() => {
          void ensure();
        }, 250);
      }
    });
  }
  for (const event of BLOCKING_EVENTS) {
    on(event, async () => {
      if (event === "session_shutdown" && !ready) return;
      await ensure();
    });
  }
}

// extensions/bootstrap.ts
installDeliverySteal();
function bootstrap_default(pi) {
  installDeferred(pi, () => import("./runtime.js"), {
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
      { name: "codebase-audit", description: "Run the codebase-audit workflow" }
    ]
  });
}
export {
  bootstrap_default as default
};
