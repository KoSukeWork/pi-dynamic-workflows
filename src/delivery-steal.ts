/**
 * Host AgentSession sendCustomMessage steal.
 *
 * Must be installed before Pi calls AgentSession._bindExtensionCore.
 * The workflow factory used to import this via task-panel at load time;
 * the thin bootstrap now imports this module so deferred loading cannot
 * miss bindCore.
 */

import { AgentSession, ExtensionRunner } from "@earendil-works/pi-coding-agent";

export type DeliverySend = (
	message: { customType: string; content: string; display: boolean },
	options: { triggerTurn: boolean; deliverAs: "followUp" },
) => unknown;

export interface StealCandidate {
	sendCustomMessage?: DeliverySend;
	sessionManager?: {
		persist?: boolean;
		getSessionId?: () => string;
		getSessionName?: () => string | undefined;
	};
	_resourceLoader?: { noExtensions?: boolean };
}

const boundSessionSends = new Map<string, DeliverySend>();
let lastHostSession: StealCandidate | undefined;
let agentSessionPatched = false;
let bindCoreObserved = false;

export function hostSessionIdToSteal(session: StealCandidate): string | undefined {
	const sm = session.sessionManager;
	if (!sm) return undefined;
	if (sm.persist === false) return undefined;
	if (session._resourceLoader?.noExtensions === true) return undefined;
	try {
		const name = sm.getSessionName?.();
		if (typeof name === "string" && name.startsWith("workflow:")) return undefined;
	} catch {
		// getSessionName unavailable — keep evaluating
	}
	if (typeof session.sendCustomMessage !== "function") return undefined;
	try {
		const sid = sm.getSessionId?.();
		if (typeof sid === "string" && sid) return sid;
	} catch {
		return undefined;
	}
	return undefined;
}

export function captureHostSessionSend(session: StealCandidate): void {
	const sid = hostSessionIdToSteal(session);
	if (!sid) return;
	lastHostSession = session;
	boundSessionSends.set(sid, (message, options) => session.sendCustomMessage!(message, options));
}

/**
 * If bindCore already ran before the prototype patch, recapture the last host
 * session that looks like this sessionId.
 */
export function recaptureHostSessionSend(sessionId: string): DeliverySend | undefined {
	const existing = boundSessionSends.get(sessionId);
	if (existing) return existing;
	if (lastHostSession) captureHostSessionSend(lastHostSession);
	return boundSessionSends.get(sessionId);
}

export function getBoundSessionSend(sessionId: string): DeliverySend | undefined {
	return boundSessionSends.get(sessionId);
}

export function setBoundSessionSend(sessionId: string, send: DeliverySend): void {
	boundSessionSends.set(sessionId, send);
}

export function deleteBoundSessionSend(sessionId: string): void {
	boundSessionSends.delete(sessionId);
}

export function clearBoundSessionSends(): void {
	boundSessionSends.clear();
	lastHostSession = undefined;
}

export function hasBoundSessionSend(sessionId: string): boolean {
	return boundSessionSends.has(sessionId);
}

export function patchAgentSessionCapture(): void {
	if (agentSessionPatched) return;
	agentSessionPatched = true;
	try {
		const proto = AgentSession.prototype as unknown as {
			_bindExtensionCore?: (runner: unknown) => unknown;
		} & StealCandidate;
		const original = proto._bindExtensionCore;
		if (typeof original !== "function") return;
		proto._bindExtensionCore = function patchedBindExtensionCore(this: StealCandidate, runner: unknown) {
			try {
				captureHostSessionSend(this);
			} catch {
				// never break session construction
			}
			return original.apply(this, [runner]);
		};
	} catch {
		// AgentSession unavailable or shape changed — bind stays fail-closed without steal
	}
}

export function patchBindCoreObserve(): void {
	if (bindCoreObserved) return;
	bindCoreObserved = true;
	try {
		const proto = ExtensionRunner.prototype as unknown as {
			bindCore: (...args: unknown[]) => unknown;
		};
		const original = proto.bindCore;
		if (typeof original !== "function") return;
		proto.bindCore = function patchedBindCore(this: unknown, ...args: unknown[]) {
			return original.apply(this, args);
		};
	} catch {
		// ignore
	}
}

export function installDeliverySteal(): void {
	patchAgentSessionCapture();
	patchBindCoreObserve();
}

installDeliverySteal();
