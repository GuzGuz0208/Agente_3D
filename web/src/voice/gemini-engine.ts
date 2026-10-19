/**
 * Gemini Live adapter (engine 2): translates its WebSocket protocol into the
 * neutral reducers of RealtimeEngineBase. Protocol facts come from the G2 spike
 * (docs/anexos/g2-voz-y-contexto-para-carril-b.md §4):
 *
 *   - the ephemeral token goes in the URL and fixes the whole configuration, so
 *     the client only names the model;
 *   - microphone audio is PCM16 at 16 kHz; server frames arrive as binary JSON;
 *   - a tool response needs no follow-up request;
 *   - barge-in: with the backend default (`activityHandling: NO_INTERRUPTION`, grant
 *     `config.interruption = "client"`) the server never cuts the agent and is deaf
 *     while its turn is open (verified 2026-10-16: no voice activity, no transcript).
 *     The browser applies the 1-second rule with its own voice detector, then cuts
 *     the turn with a client content turn (`turnComplete: true` "unconditionally
 *     interrupts generation") and replays the voice the server did not hear from the
 *     microphone ring. With `START_OF_ACTIVITY_INTERRUPTS` ("server") the provider cuts
 *     by itself and sends an explicit "interrupted" flag, as before;
 *   - style and context are sent as a tagged user note that must not be answered
 *     (a system turn closes the connection);
 *   - text-only output is not supported, so the cloned voice is not available.
 *
 * The provider has no response ids: one local id is made per spoken stretch.
 * Nothing provider-specific leaves this file (R-03).
 */
import type { RealtimeSessionGrant } from "./api";
import { BARGE_CONFIRM_MS, base64ToPcm, openSocket, parseFrame, pcmToBase64, RealtimeEngineBase, type CancelInfo, type ProviderToolCall } from "./realtime-base";
import { mayBeSpeech } from "./transcript-filter";
import type { ContextEnvelope, StyleDecision } from "./types";

type Msg = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Msg => (v && typeof v === "object" ? (v as Msg) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const NOTE = "[NOTA DEL SISTEMA, no la respondas ni la menciones]";
/** Ends the server turn from the client. Verified: the model stays silent and listens to the voice that follows. */
const CUT_NOTE = `${NOTE} La persona te interrumpió. No digas nada ahora: escucha lo que dice a continuación y responde solo a eso.`;
/**
 * «Silenciar»: verified 2026-10-18 that with CUT_NOTE the model may answer the note by repeating
 * what it was saying (dropped, never heard, but the server stays busy until it "finishes"). The
 * mute asks explicitly for silence and no repetition.
 */
const MUTE_NOTE = `${NOTE} La persona pidió silencio. Quédese callado: no responda a esta nota, no repita ni continúe lo que estaba diciendo; espere su próxima pregunta.`;
/** Wait for late transcription fragments before closing a user utterance. */
const FINALIZE_MS = 300;
/** Local voice detector: consecutive voiced 20 ms frames that open a possible interruption. */
const LOCAL_ONSET_FRAMES = 2;
/** Local voice detector: silence that closes it (pauses between words are shorter). */
const LOCAL_HANGOVER_MS = 300;
/** Voice replayed before the local onset, like the provider's own prefix padding. */
const REPLAY_PAD_MS = 300;
/** After a confirmed interruption the server should report the replayed voice within this. */
const ADOPT_TIMEOUT_MS = 5000;
const REPLAY_CHUNK = 3200; // 200 ms at 16 kHz
/** A model turn that never shows up does not keep the browser watching for it forever. */
const BUSY_TIMEOUT_MS = 10_000;

export class GeminiLiveEngine extends RealtimeEngineBase {
  readonly id = "gemini" as const;
  protected readonly inputRate = 16_000 as const;
  /** 1-second rule by default; 0 when the credential leaves barge-in to the provider (set in openTransport). */
  protected override bargeConfirmMs = BARGE_CONFIRM_MS;
  /** A client content turn interrupts the current generation, so the style note waits for the gap between turns. */
  protected override readonly styleWaitsForIdle = true;

  private ws: WebSocket | null = null;
  private ready = false;
  private audioEpoch: number | null = null;
  /** Local id of the stretch of speech being received. */
  private generation: string | null = null;
  /** The server is still inside a model turn. */
  private serverTurnOpen = false;
  /** Drop model output until the server closes the turn we interrupted locally. */
  private dropping = false;
  private userKey: string | null = null;
  private userStopped = false;
  private finalizeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly cancelledCalls = new Set<string>();
  /** The server does not cut the agent (NO_INTERRUPTION): the browser does, with the 1-second rule. */
  private clientBarge = true;
  /** A client cut is due (sent at the end of the tick, unless a typed question carries it). */
  private cutPending = false;
  /** A client cut was sent in the current server turn. */
  private cutSent = false;
  /** User utterance opened by the local voice detector while the server could not hear. */
  private localKey: string | null = null;
  private localStartT = 0;
  private voicedFrames = 0;
  /** The local utterance was confirmed and replayed: the server's next activity is that same voice. */
  private adopting = false;
  private adoptTimer: ReturnType<typeof setTimeout> | undefined;
  /** A model turn was asked for (question, note, tool result, end of speech) and has not closed yet. */
  private serverBusy = false;
  private busyTimer: ReturnType<typeof setTimeout> | undefined;
  /** After a cut, the model may answer the cut note (silence) before anything else: not played. */
  private muteNoteReply = false;
  private mutedOutput = false;
  private muteTimer: ReturnType<typeof setTimeout> | undefined;

  protected get transportReady(): boolean {
    return this.ready && this.ws?.readyState === WebSocket.OPEN;
  }

  protected sessionRequestExtras(): Record<string, unknown> {
    // The credential fixes the instructions, so the style in force goes with the request.
    return this.currentStyle ? { style: this.currentStyle } : {};
  }

  protected async openTransport(grant: RealtimeSessionGrant): Promise<void> {
    const base = grant.connect.url;
    const url = /[?&]access_token=/.test(base) ? base : `${base}${base.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(grant.connect.token)}`;
    const ws = await openSocket(url);
    this.ws = ws;
    this.ready = false;
    this.audioEpoch = null;
    this.generation = null;
    this.serverTurnOpen = false;
    this.dropping = false;
    this.userKey = null;
    this.cancelledCalls.clear();
    this.resetLocalBarge();
    // An older backend says nothing: the provider default (START_OF_ACTIVITY_INTERRUPTS) cuts by itself.
    this.clientBarge = grant.config?.interruption === "client";
    // The local detector only calls a voice over after LOCAL_HANGOVER_MS of silence, so the wait
    // grows by that much: voice that stopped before 1 s is known to be noise by then.
    this.bargeConfirmMs = this.clientBarge ? BARGE_CONFIRM_MS + LOCAL_HANGOVER_MS : 0;
    const model = grant.model.startsWith("models/") ? grant.model : `models/${grant.model}`;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("setup timeout")), 8000);
      ws.onmessage = (ev) => {
        const msg = parseFrame(ev.data);
        if (!msg?.setupComplete) return;
        clearTimeout(timer);
        this.ready = true;
        ws.onmessage = (e) => this.onMessage(e.data);
        resolve();
      };
      ws.onclose = () => {
        clearTimeout(timer);
        reject(new Error("closed before setup"));
      };
      ws.send(JSON.stringify({ setup: { model } }));
    });
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ready = false;
      this.transportClosed(`code ${ev.code}`);
    };
  }

  protected closeTransport(): void {
    clearTimeout(this.finalizeTimer);
    this.resetLocalBarge();
    const ws = this.ws;
    this.ws = null;
    this.ready = false;
    if (!ws) return;
    ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close();
    } catch {
      // already closed
    }
  }

  protected dropTransportForTest(): void {
    this.ws?.close();
  }

  private send(msg: Msg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  // ── Outbound ───────────────────────────────────────────────────────────────

  protected sendAudioFrame(pcm: Int16Array): void {
    this.audioEpoch ??= this.now() - (pcm.length / this.inputRate) * 1000;
    this.send({ realtimeInput: { audio: { data: pcmToBase64(pcm), mimeType: `audio/pcm;rate=${this.inputRate}` } } });
    if (this.clientBarge) this.watchLocalVoice();
  }

  protected sendUserText(text: string): void {
    if (this.serverDeaf) {
      // The server ignores input while it prepares or speaks an answer: the question itself ends that turn.
      this.cutPending = false;
      this.cutSent = true;
      this.mark("client_cut", { by: "text" });
      this.send({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true } });
      this.expectAnswer();
      return;
    }
    this.send({ realtimeInput: { text } });
    this.expectAnswer();
  }

  protected sendNote(text: string): void {
    this.send({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true } });
    this.expectAnswer();
  }

  protected sendGreeting(spokenBrief: string): void {
    // The figures of the greeting come from the live brief, never from the model (R-22).
    this.send({ realtimeInput: { text: `${NOTE} Preséntate ahora diciendo exactamente este texto, sin añadir ni cambiar cifras: «${spokenBrief}»` } });
    this.expectAnswer();
  }

  protected sendToolOutput(call: ProviderToolCall, output: Record<string, unknown>): void {
    if (this.cancelledCalls.delete(call.callId)) return; // the provider withdrew this call
    this.send({ toolResponse: { functionResponses: [{ id: call.callId, name: call.name, response: output }] } });
    this.expectAnswer();
  }

  protected sendSeed(context: ContextEnvelope): void {
    const turns = context.recent_turns.slice(-8).map((t) => ({ role: t.role === "user" ? "user" : "model", parts: [{ text: t.text }] }));
    turns.push({ role: "user", parts: [{ text: `${NOTE} ${this.describeContext(context)}` }] });
    this.send({ clientContent: { turns, turnComplete: false } });
  }

  protected sendStyle(style: StyleDecision): void {
    this.send({ clientContent: { turns: [{ role: "user", parts: [{ text: `${NOTE} ${this.styleNote(style)}` }] }], turnComplete: false } });
  }

  protected cancelGeneration(generationId: string, info: CancelInfo): void {
    // After a local stop the provider may keep sending the old turn, which is dropped until it closes.
    if (this.generation === generationId) {
      this.generation = null;
      this.dropping = this.serverTurnOpen;
    }
    // Without provider barge-in the server would stay deaf until it believes the answer was
    // played: end its turn. Deferred to the end of the tick so a typed question can carry it.
    if (this.serverDeaf && !info.byProvider && !this.cutSent && !this.cutPending) {
      this.cutPending = true;
      queueMicrotask(() => this.flushCut());
    }
  }

  protected override bargeConfirmed(key: string): void {
    if (!this.clientBarge || key !== this.localKey) return;
    this.flushCut();
    // The server did not hear the voice that cut the agent: send it again from the microphone ring.
    const pcm = this.recentMicAudio(this.localStartT - REPLAY_PAD_MS);
    if (pcm && pcm.length > 0) {
      for (let i = 0; i < pcm.length; i += REPLAY_CHUNK) {
        this.send({ realtimeInput: { audio: { data: pcmToBase64(pcm.subarray(i, i + REPLAY_CHUNK)), mimeType: `audio/pcm;rate=${this.inputRate}` } } });
      }
      // The provider's audio offsets now count the replayed stretch twice.
      if (this.audioEpoch !== null) this.audioEpoch -= (pcm.length / this.inputRate) * 1000;
    }
    this.mark("voice_replayed", { ms: Math.round(((pcm?.length ?? 0) / this.inputRate) * 1000) });
    this.adopting = true;
    clearTimeout(this.adoptTimer);
    this.adoptTimer = setTimeout(() => {
      // The server never reported it (too quiet for its detector): close it as an empty turn.
      if (!this.adopting || this.userKey !== this.localKey) return;
      this.adopting = false;
      this.localKey = null;
      this.stopUser();
      this.closeUser();
    }, ADOPT_TIMEOUT_MS);
  }

  /** Ends the open server turn from the client (documented: `turnComplete: true` interrupts unconditionally). */
  private flushCut(): void {
    this.cutPending = false;
    if (!this.serverDeaf || this.cutSent || !this.transportReady) return;
    this.cutSent = true;
    this.mark("client_cut");
    const note = this.turnMuted ? MUTE_NOTE : CUT_NOTE;
    this.send({ clientContent: { turns: [{ role: "user", parts: [{ text: note }] }], turnComplete: true } });
    this.muteNoteReply = true;
    this.mutedOutput = false;
    clearTimeout(this.muteTimer);
    this.muteTimer = setTimeout(() => (this.muteNoteReply = false), BUSY_TIMEOUT_MS);
  }

  /** A request the model must answer aloud: what it says next is not the reply to a cut note. */
  private expectAnswer(): void {
    this.muteNoteReply = false;
    this.markBusy();
  }

  /**
   * Local voice detector, while the server is deaf (its turn is open and the agent is
   * heard). It opens a possible interruption for the base (duck + 1-second rule); voice
   * that ends before the rule is noise the server never heard, closed here.
   */
  private watchLocalVoice(): void {
    const voice = this.localVoice;
    if (!voice) return;
    const t = this.now();
    if (this.localKey === null) {
      this.voicedFrames = voice.speaking ? this.voicedFrames + 1 : 0;
      if (this.voicedFrames < LOCAL_ONSET_FRAMES || !this.serverDeaf || this.userKey !== null) return;
      this.voicedFrames = 0;
      this.localStartT = t - LOCAL_ONSET_FRAMES * 20;
      this.mark("local_voice_start");
      this.localKey = this.openUser(this.localStartT);
      return;
    }
    if (this.userKey !== this.localKey) {
      this.localKey = null; // superseded by the server or closed elsewhere
      this.adopting = false;
      return;
    }
    if (this.adopting) return; // confirmed: the server's detector takes it from here
    const quiet = voice.lastVoiceAt === null || t - voice.lastVoiceAt > LOCAL_HANGOVER_MS;
    if (!quiet) return;
    // Shorter than the 1-second rule: noise. The agent goes on at full volume.
    this.localKey = null;
    this.mark("local_voice_noise");
    this.stopUser(voice.lastVoiceAt ?? t);
    this.closeUser();
  }

  /** Without provider barge-in the server hears nothing while it prepares or speaks an answer. */
  private get serverDeaf(): boolean {
    return this.clientBarge && (this.serverTurnOpen || this.serverBusy);
  }

  /** A context refresh waits while the server turn is open or a local voice is being weighed (docs/08 §7.1). */
  protected override providerBusy(): boolean {
    return this.serverDeaf || this.localKey !== null || this.adopting || this.muteNoteReply || this.dropping;
  }

  /** While the server is deaf, voice must pass the 1-second rule before it cuts the answer. */
  protected override answerProtected(): boolean {
    return super.answerProtected() || this.serverDeaf;
  }

  private markBusy(): void {
    if (!this.clientBarge) return;
    this.serverBusy = true;
    clearTimeout(this.busyTimer);
    this.busyTimer = setTimeout(() => (this.serverBusy = false), BUSY_TIMEOUT_MS);
  }

  private resetLocalBarge(): void {
    clearTimeout(this.adoptTimer);
    clearTimeout(this.busyTimer);
    clearTimeout(this.muteTimer);
    this.serverBusy = false;
    this.muteNoteReply = false;
    this.mutedOutput = false;
    this.cutPending = false;
    this.cutSent = false;
    this.localKey = null;
    this.adopting = false;
    this.voicedFrames = 0;
  }

  // ── Inbound ────────────────────────────────────────────────────────────────

  private offsetToClock(offset: unknown): number | undefined {
    const seconds = Number.parseFloat(str(offset));
    return this.audioEpoch !== null && Number.isFinite(seconds) ? this.audioEpoch + seconds * 1000 : undefined;
  }

  private openUser(tStart?: number): string {
    this.closeUser();
    const key = crypto.randomUUID();
    this.userKey = key;
    this.userStopped = false;
    this.userSpeechStarted(key, tStart);
    return key;
  }

  private stopUser(tEnd?: number): void {
    if (!this.userKey || this.userStopped) return;
    this.userStopped = true;
    this.userSpeechStopped(this.userKey, tEnd);
    this.scheduleFinalize();
  }

  private scheduleFinalize(): void {
    clearTimeout(this.finalizeTimer);
    this.finalizeTimer = setTimeout(() => {
      // The transcription can trail the end of the speech: stay open until there is text.
      if (this.userKey && this.userUtteranceText(this.userKey)) this.closeUser();
    }, FINALIZE_MS);
  }

  private closeUser(): void {
    clearTimeout(this.finalizeTimer);
    const key = this.userKey;
    if (!key) return;
    this.userKey = null;
    if (!this.userStopped) this.userSpeechStopped(key);
    this.userTranscript(key, "", { final: true, append: true });
  }

  private ensureGeneration(): string {
    if (this.generation) return this.generation;
    // The model is answering: the user's turn is over, even if no activity event said so.
    // Not a voice the local detector is still weighing: it may yet interrupt this answer.
    if (this.localKey === null || this.userKey !== this.localKey) this.stopUser();
    const id = `gem-${crypto.randomUUID()}`;
    this.generation = id;
    // A new server turn: a cut sent for an earlier one does not count for it.
    if (!this.serverTurnOpen) this.cutSent = false;
    this.serverTurnOpen = true;
    // The core may drop it at once (the answer to a noise transcript): then `dropping` is set.
    this.generationStarted(id);
    return id;
  }

  private endGeneration(): void {
    const id = this.generation;
    if (!id) return;
    this.generation = null;
    this.agentTranscript(id, "", { final: true, append: true });
    this.generationDone(id);
  }

  private onMessage(data: unknown): void {
    const msg = parseFrame(data);
    if (!msg) return;

    // Context size of the session so far: drives the token threshold of the refresh.
    if (msg.usageMetadata) {
      const usage = obj(msg.usageMetadata);
      this.contextUsage(Number(usage.promptTokenCount ?? usage.totalTokenCount ?? 0));
    }

    if (msg.voiceActivity) {
      const activity = obj(msg.voiceActivity);
      const kind = str(activity.type);
      if (kind === "ACTIVITY_START") {
        this.muteNoteReply = false; // the server listens to the person: its next answer is for them
        if (this.localKey !== null && this.userKey === this.localKey) {
          // The voice the local detector already opened (replayed, or heard once the turn closed):
          // same utterance, from now on followed by the server's detector.
          clearTimeout(this.adoptTimer);
          this.adopting = false;
          this.localKey = null;
          this.userStopped = false;
          this.mark("local_voice_adopted");
        } else {
          this.openUser(this.offsetToClock(activity.audioOffset));
        }
      } else if (kind === "ACTIVITY_END") {
        this.stopUser(this.offsetToClock(activity.audioOffset));
        this.markBusy(); // the server starts its answer now and stops listening
      }
    }

    if (msg.serverContent) {
      const content = obj(msg.serverContent);

      if (content.inputTranscription) {
        const text = str(obj(content.inputTranscription).text);
        let key = this.userKey !== null && this.userUtteranceText(this.userKey) !== null ? this.userKey : null;
        // Fallback when no activity event announced the utterance. A fragment that trails an
        // answer already in flight belongs to a closed utterance and is not a new turn, and a
        // fragment with no Latin letter (noise turned into «公主») opens nothing.
        if (text && key === null && this.generation === null && !this.serverTurnOpen && mayBeSpeech(text)) key = this.openUser();
        if (text && key !== null) {
          this.userTranscript(key, text, { final: false, append: true });
          if (this.userStopped) this.scheduleFinalize();
        }
      }

      if (content.interrupted) {
        this.dropping = false;
        const id = this.generation;
        this.generation = null;
        this.providerInterrupted(id);
      }

      const parts = arr(obj(content.modelTurn).parts);
      const spoken = str(obj(content.outputTranscription).text);
      if (this.muteNoteReply && (parts.length > 0 || spoken)) {
        // Late output of the cut turn (still open) is dropped; once it closed, this is the model's
        // reply to the cut note itself (verified: ~1 s of silence, «<no speech detected>»).
        if (!this.serverTurnOpen) {
          this.mutedOutput = true;
          this.markBusy();
        }
      } else {
        // `dropping` is checked per part: starting a generation can set it (a dropped noise answer).
        for (const part of parts) {
          const inline = obj(obj(part).inlineData);
          if (this.dropping) break;
          if (typeof inline.data === "string" && inline.data) this.agentAudio(this.ensureGeneration(), base64ToPcm(inline.data));
        }
        if (spoken && !this.dropping) this.agentTranscript(this.ensureGeneration(), spoken, { final: false, append: true });
      }

      if (content.generationComplete) this.endGeneration();
      if (content.turnComplete) {
        if (this.muteNoteReply && this.mutedOutput) this.muteNoteReply = false;
        this.serverTurnOpen = false;
        this.serverBusy = false;
        clearTimeout(this.busyTimer);
        this.cutSent = false;
        this.dropping = false;
        this.endGeneration();
      }
    }

    if (msg.toolCall) {
      this.stopUser();
      const acknowledgement = this.generation;
      for (const raw of arr(obj(msg.toolCall).functionCalls)) {
        const call = obj(raw);
        this.toolRequested({ callId: str(call.id), name: str(call.name), args: obj(call.args), generationId: acknowledgement });
      }
      // Whatever was said before the call was the acknowledgement; the answer is a new stretch.
      this.endGeneration();
    }

    if (msg.toolCallCancellation) {
      for (const id of arr(obj(msg.toolCallCancellation).ids)) this.cancelledCalls.add(str(id));
    }

    if (msg.goAway) this.transportExpiring("el proveedor anunció el cierre de la conexión");
  }
}
