import type { CSSResultGroup, PropertyValues, TemplateResult } from "lit";
import { css, LitElement, html, nothing } from "lit";
import { mdiAlertCircle, mdiMicrophone, mdiSend, mdiVolumeMedium} from "@mdi/js";
import { customElement, property, query, state } from "lit/decorators";
import { classMap } from "lit/directives/class-map";
import type { HomeAssistant } from "../types";
import {
  webRtcOffer,
  type AssistPipeline,
} from "../data/assist_pipeline";
import { supportsFeature } from "../common/entity/supports-feature";
import { ConversationEntityFeature } from "../data/conversation";
import { AudioRecorder } from "../util/audio-recorder";
import "./ha-alert";
import "./ha-textfield";
import type { HaTextField } from "./ha-textfield";
import { documentationUrl } from "../util/documentation-url";
import { showAlertDialog } from "../dialogs/generic/show-dialog-box";

interface AssistMessage {
  who: string;
  text?: string | TemplateResult;
  audio?: HTMLAudioElement;
  error?: boolean;
}

@customElement("ha-assist-webrtc-chat")
export class HaAssistWebRTCChat extends LitElement {
  @property({ attribute: false }) public hass!: HomeAssistant;

  @property({ attribute: false }) public pipeline?: AssistPipeline;

  @property({ type: Boolean, attribute: false })
  public startListening?: boolean;

  @query("#message-input") private _messageInput!: HaTextField;

  @query("#scroll-container") private _scrollContainer!: HTMLDivElement;

  @state() private _conversation: AssistMessage[] = [];

  @state() private _showSendButton = false;

  @state() private _processing = false;

  private _conversationId: string | null = null;

  private _isListening = false;

  private _clientAudioStream?: MediaStream;

  private _audioBuffer?: Int16Array[];

  private _stt_binary_handler_id?: number | null;

  private _peerConnection?: RTCPeerConnection;

  private _dataChannel?: RTCDataChannel;

  private _remoteStream?: MediaStream;

  protected willUpdate(changedProperties: PropertyValues): void {
    if (!this.hasUpdated || changedProperties.has("pipeline")) {
      this._conversation = [
        {
          who: "hass",
          text: this.hass.localize("ui.dialogs.voice_command.how_can_i_help"),
        },
      ];
    }
  }

  protected firstUpdated(changedProperties: PropertyValues): void {
    super.firstUpdated(changedProperties);
    if (this.pipeline) {
      this._startConnection();
    }
    // if (
    //   this.startListening &&
    //   this.pipeline &&
    //   this.pipeline.stt_engine &&
    //   AudioRecorder.isSupported
    // ) {
    //   this._toggleListening();
    // }
    setTimeout(() => this._messageInput.focus(), 0);
  }

  protected updated(changedProps: PropertyValues) {
    super.updated(changedProps);
    if (changedProps.has("_conversation")) {
      this._scrollMessagesBottom();
    }
  }

  public disconnectedCallback() {
    super.disconnectedCallback();
    this._cleanUp();
    if (this._clientAudioStream) {
      this._clientAudioStream.getTracks().forEach((track) => track.stop());
      this._clientAudioStream = undefined;
    }
    this._pauseAudio();
    this._conversation = [];
    this._conversationId = null;
  }

  protected render(): TemplateResult {
    const controlHA = !this.pipeline
      ? false
      : this.pipeline.prefer_local_intents ||
        (this.hass.states[this.pipeline.conversation_engine]
          ? supportsFeature(
              this.hass.states[this.pipeline.conversation_engine],
              ConversationEntityFeature.CONTROL
            )
          : true);
    const supportsMicrophone = AudioRecorder.isSupported;
    const supportsSTT = true;   // this.pipeline?.stt_engine;

    return html`
      ${controlHA
        ? nothing
        : html`
            <ha-alert>
              ${this.hass.localize(
          "ui.dialogs.voice_command.conversation_no_control"
        )}
            </ha-alert>
          `}
      <div class="messages">
        <div class="messages-container" id="scroll-container">
          ${this._conversation!.map(
          // New lines matter for messages
          // prettier-ignore
          (message) => html`
                ${message.audio
                  ? html`
                      <div class="message ${classMap({ error: !!message.error, [message.who]: true })}">
                      <ha-svg-icon
                        .path=${mdiVolumeMedium}
                      ></ha-svg-icon>
                      ${message.audio}
                      </div>
                  `
                  : html`<div class="message ${classMap({ error: !!message.error, [message.who]: true })}">${message.text}</div>`}
              `
          )}
        </div>
      </div>
      <div class="input" slot="primaryAction">
        <ha-textfield
          id="message-input"
          @keyup=${this._handleKeyUp}
          @input=${this._handleInput}
          .label=${this.hass.localize(`ui.dialogs.voice_command.input_label`)}
          .iconTrailing=${true}
        >
          <div slot="trailingIcon">
            ${this._showSendButton || !supportsSTT
              ? html`
                  <ha-icon-button
                    class="listening-icon"
                    .path=${mdiSend}
                    @click=${this._handleSendMessage}
                    .disabled=${this._processing}
                    .label=${this.hass.localize(
                      "ui.dialogs.voice_command.send_text"
                    )}
                  >
                  </ha-icon-button>
                `
              : html`
                  ${this._isListening
                    ? html`
                        <div class="bouncer">
                          <div class="double-bounce1"></div>
                          <div class="double-bounce2"></div>
                        </div>
                      `
                    : nothing}

                  <div class="listening-icon">
                    <ha-icon-button
                      .path=${mdiMicrophone}
                      @click=${this._handleListeningButton}
                      .disabled=${this._processing}
                      .label=${this.hass.localize(
                        "ui.dialogs.voice_command.start_listening"
                      )}
                    >
                    </ha-icon-button>
                    ${!supportsMicrophone
                      ? html`
                          <ha-svg-icon
                            .path=${mdiAlertCircle}
                            class="unsupported"
                          ></ha-svg-icon>
                        `
                      : null}
                  </div>
                `}
          </div>
        </ha-textfield>
      </div>
    `;
  }


  private _startTimer() {
    if (!__DEV__) {
      return;
    }
    // eslint-disable-next-line no-console
    console.log("WebRTC start");
  }

  private _stopTimer() {
    if (!__DEV__) {
      return;
    }
    // eslint-disable-next-line no-console
    console.log("WebRTC end");
  }

  private _scrollMessagesBottom() {
    const scrollContainer = this._scrollContainer;
    if (!scrollContainer) {
      return;
    }
    scrollContainer.scrollTo(0, scrollContainer.scrollHeight);
  }

  private _handleKeyUp(ev: KeyboardEvent) {
    const input = ev.target as HaTextField;
    if (!this._processing && ev.key === "Enter" && input.value) {
      this._processText(input.value);
      input.value = "";
      this._showSendButton = false;
    }
  }

  private _handleInput(ev: InputEvent) {
    const value = (ev.target as HaTextField).value;
    if (value && !this._showSendButton) {
      this._showSendButton = true;
    } else if (!value && this._showSendButton) {
      this._showSendButton = false;
    }
  }

  private _handleSendMessage() {
    if (this._messageInput.value) {
      this._processText(this._messageInput.value.trim());
      this._messageInput.value = "";
      this._showSendButton = false;
    }
  }

  private _handleListeningButton(ev) {
    ev.stopPropagation();
    ev.preventDefault();
    this._toggleListening();
  }

  private async _toggleListening() {
    const supportsMicrophone = AudioRecorder.isSupported;
    if (!supportsMicrophone) {
      this._showNotSupportedMessage();
      return;
    }
    if (!this._isListening) {
      this._startListening();
    } else {
      this._stopListening();
    }
  }

  private _addMessage(message: AssistMessage) {
    this._conversation = [...this._conversation!, message];
  }

  private async _showNotSupportedMessage() {
    this._addMessage({
      who: "hass",
      text:
        // New lines matter for messages
        // prettier-ignore
        html`${this.hass.localize(
          "ui.dialogs.voice_command.not_supported_microphone_browser"
        )}

        ${this.hass.localize(
          "ui.dialogs.voice_command.not_supported_microphone_documentation",
          {
            documentation_link: html`<a
                target="_blank"
                rel="noopener noreferrer"
                href=${documentationUrl(
                  this.hass,
                  "/docs/configuration/securing/#remote-access"
                )}
              >${this.hass.localize(
                  "ui.dialogs.voice_command.not_supported_microphone_documentation_link"
                )}</a>`,
          }
        )}`,
    });
  }

  private _logEvent(msg: string, ...args: unknown[]) {
    if (!__DEV__) {
      return;
    }
    // eslint-disable-next-line no-console
    console.log(msg, ...args);
  }

  private async _startConnection() {
    this._cleanUp();
    if (typeof RTCPeerConnection === "undefined") {
      throw new Error("WebRTC not supported in this browser");
    }
    this._startTimer();
    this._peerConnection = new RTCPeerConnection();
    this._dataChannel = this._peerConnection.createDataChannel("assist");
    this._dataChannel.onmessage = this._dataChannelMessage;
    this._dataChannel.ondatachannelopen = this._dataChannelOpen;
    this._peerConnection.onconnectionstatechange = () => {
      const state = this._peerConnection.connectionState;
      this._logEvent("Connection state changed:", state);
      if (state === "failed") {
        console.error("Connection failed. Cleaning up.");
        this._cleanUp();
      }
    };

    // Setup callbacks to render remote stream once media tracks are discovered.
    this._remoteStream = new MediaStream();
    this._peerConnection.ontrack = this._addTrack;
    // TODO: Check pipeline capabilities
    this._peerConnection.addTransceiver("audio", { direction: "recvonly" });


    // Open the microphone but don't start listening yet. Add the tracks to the
    // media stream.
    this._clientAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this._clientAudioStream.getTracks().forEach((track) => { track.enabled = false; });
    this._isListening = false;
    for (const track of this._clientAudioStream.getAudioTracks()) {
      this._logEvent("Adding audio track to peer connection", track);
      this._peerConnection?.addTrack(track);
    }

    const offerOptions: RTCOfferOptions = {
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    };
    const offer: RTCSessionDescriptionInit = await this._peerConnection.createOffer(offerOptions);
    await this._peerConnection.setLocalDescription(offer);

    this._logEvent("Sending offer");
    let offerEvent = null;
    try {
      offerEvent = await webRtcOffer(
        this.hass,
        this.pipeline!.id,
        offer.sdp,
      )
    } catch (err: any) {
      await showAlertDialog(this, {
        title: "Error starting pipeline",
        text: err.message || err,
      });
      this._cleanUp();
      return;
    }
    this._logEvent("Received answer: " + offerEvent.answer);

    // Initiate the stream
    const remoteDesc = new RTCSessionDescription({
      type: "answer",
      sdp: offerEvent.answer,
    });
    try {
      this._logEvent("start setRemoteDescription", remoteDesc);
      await this._peerConnection.setRemoteDescription(remoteDesc);
    } catch (err: any) {
      this._error = "Failed to connect WebRTC stream: " + err.message;
      this._cleanUp();
    }
    this._logEvent("end setRemoteDescription");
  }

  private _addTrack = async (event: RTCTrackEvent) => {
    if (!this._remoteStream) {
      return;
    }
    this._logEvent("Adding track to remote stream: " + event.track.kind);
    this._remoteStream.addTrack(event.track);
    if (!this.hasUpdated) {
      await this.updateComplete;
    }
    this._stopTimer();
  };

  private _setAudioTrack(audio: HTMLAudioElement) {
    this._logEvent("Setting audio track");
    if (!this._remoteStream) {
      return;
    }
    audio.srcObject = this._remoteStream;
  }

  private _connectionError = () => {
    showAlertDialog(this, { title: "WebRTC not connected." });
    // TODO: Remove all audio
    // this._audio?.removeAttribute("src");
  };

  private _isConnected() {
    return this._dataChannel && this._dataChannel.readyState === "open";
  }

  private _dataChannelOpen() {
    this._logEvent("Data channel opened.");
    this._connected = true;
  }

  private _dataChannelMessage = (ev: MessageEvent) => {
    const event = JSON.parse(new TextDecoder().decode(ev.data));
    console.log("dataChannel message", event);
    if (event.type === "intent-end") {
      this._conversationId = event.data.intent_output.conversation_id;
      const plain = event.data.intent_output.response.speech?.plain;
      if (plain) {
        const hassMessage = this._conversation.at(-1);
        hassMessage.text = plain.speech;
      }
      this.requestUpdate("_conversation");
    } else if (event.type === "error") {
      this._stt_binary_handler_id = undefined;
      const lastMessage = this._conversation.at(-1);
      lastMessage.text = event.data.message;
      lastMessage.error = true;
      this._stopListening();
      this.requestUpdate("_conversation");
    }
  }


  private async _startListening() {
    if (!this._isConnected()) {
      this._connectionError();
      return;
    }

    this._processing = true;
    this._pauseAudio();

    // Open the microphone
    for (const track of this._clientAudioStream!.getAudioTracks()) {
      track.enabled = true;
    }

    const audioEl = new Audio();
    const userMessage: AssistMessage = {
      who: "user",
      audio: audioEl,
      text: "…",
    };
    audioEl.srcObject = this._clientAudioStream!;
    this._addMessage(userMessage);
    this.requestUpdate("_isListening");

    // Prepare to receive audio from the server
    const outputAudioEl = new Audio();
    outputAudioEl.controls = true;
    const hassMessage: AssistMessage = {
      who: "hass",
      audio: outputAudioEl,
    };
    this._setAudioTrack(outputAudioEl);
  }

  private isDataChannelOpen() {
    return this._dataChannel?.readyState === "open";
  }

  private _cleanUp() {
    if (this._peerConnection) {
      this._peerConnection.close();
      this._peerConnection = null;
    }
    if (this._audio()) {
      this._audio().removeAttribute("src");
    }
    this._stopTimer();
  }

  private _stopListening() {
    this._clientAudioStream.getTracks().forEach((track) => { track.enabled = false; });
    this._isListening = false;
    this.requestUpdate("_isListening");
  }

  // Returns an audio element if the last active message is Home Assistant
  private _audio(): HTMLAudioElement | null {
    const conversation = this._conversation.at(-1);
    if (conversation && conversation.who === "hass" && conversation.audio) {
      return conversation.audio;
    }
    return null;
  }

  private _pauseAudio() {
    if (this._audio()) {
      this._audio()?.pause();
    }
  }

  private _unloadAudio = () => {
    this._audio()?.removeAttribute("src");
  };

  private async _processText(text: string) {
    if (!this._isConnected()) {
      this._connectionError();
      return;
    }

    this._processing = true;
    this._pauseAudio();
    this._addMessage({ who: "user", text });

    // Prepare to receive audio from the server
    const outputAudioEl = new Audio();
    outputAudioEl.playsInline = true;
    outputAudioEl.autoplay = true;
    const message: AssistMessage = {
      who: "hass",
      audio: outputAudioEl,
    };
    this._setAudioTrack(outputAudioEl);


    // To make sure the answer is placed at the right user text, we add it before we process it
    this._addMessage(message);

    const hook = (event) => {
      this._logEvent("pipeline event: " + event.type);
      if (event.type === "intent-end") {
        this._conversationId = event.data.intent_output.conversation_id;
        const plain = event.data.intent_output.response.speech?.plain;
        if (plain) {
          message.text = plain.speech;
        }
        this.requestUpdate("_conversation");
        unsub();
      }
      if (event.type === "error") {
        message.text = event.data.message;
        message.error = true;
        this.requestUpdate("_conversation");
        unsub();
      }
    };
    const packet = {
      start_stage: "intent",
      input: { text },
      end_stage: this.pipeline?.tts_engine ? "tts" : "intent",
      pipeline: this.pipeline?.id,
      conversation_id: this._conversationId,
    }

    this._logEvent("Sending input text", packet);

    this._dataChannel!.send(JSON.stringify(packet));
  }

  static get styles(): CSSResultGroup {
    return css`
      :host {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: var(--ha-assist-webrtc-chat-min-height, 415px);
      }
      ha-textfield {
        display: block;
        margin: 0 24px 16px;
      }
      .messages {
        flex: 1;
        display: block;
        box-sizing: border-box;
        position: relative;
      }
      .messages-container {
        position: absolute;
        bottom: 0px;
        right: 0px;
        left: 0px;
        padding: 24px;
        box-sizing: border-box;
        overflow-y: auto;
        max-height: 100%;
      }
      .message {
        white-space: pre-line;
        font-size: 18px;
        clear: both;
        margin: 8px 0;
        padding: 8px;
        border-radius: 15px;
      }

      @media all and (max-width: 450px), all and (max-height: 500px) {
        .message {
          font-size: 16px;
        }
      }

      .message p {
        margin: 0;
      }
      .message p:not(:last-child) {
        margin-bottom: 8px;
      }

      .message.user {
        margin-left: 24px;
        margin-inline-start: 24px;
        margin-inline-end: initial;
        float: var(--float-end);
        text-align: right;
        border-bottom-right-radius: 0px;
        background-color: var(--primary-color);
        color: var(--text-primary-color);
        direction: var(--direction);
      }

      .message.hass {
        margin-right: 24px;
        margin-inline-end: 24px;
        margin-inline-start: initial;
        float: var(--float-start);
        border-bottom-left-radius: 0px;
        background-color: var(--secondary-background-color);

        color: var(--primary-text-color);
        direction: var(--direction);
      }

      .message.user a {
        color: var(--text-primary-color);
      }

      .message.hass a {
        color: var(--primary-text-color);
      }

      .message.error {
        background-color: var(--error-color);
        color: var(--text-primary-color);
      }

      .bouncer {
        width: 48px;
        height: 48px;
        position: absolute;
      }
      .double-bounce1,
      .double-bounce2 {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background-color: var(--primary-color);
        opacity: 0.2;
        position: absolute;
        top: 0;
        left: 0;
        -webkit-animation: sk-bounce 2s infinite ease-in-out;
        animation: sk-bounce 2s infinite ease-in-out;
      }
      .double-bounce2 {
        -webkit-animation-delay: -1s;
        animation-delay: -1s;
      }
      @-webkit-keyframes sk-bounce {
        0%,
        100% {
          -webkit-transform: scale(0);
        }
        50% {
          -webkit-transform: scale(1);
        }
      }
      @keyframes sk-bounce {
        0%,
        100% {
          transform: scale(0);
          -webkit-transform: scale(0);
        }
        50% {
          transform: scale(1);
          -webkit-transform: scale(1);
        }
      }

      .listening-icon {
        position: relative;
        color: var(--secondary-text-color);
        margin-right: -24px;
        margin-inline-end: -24px;
        margin-inline-start: initial;
        direction: var(--direction);
        transform: scaleX(var(--scale-direction));
      }

      .listening-icon[active] {
        color: var(--primary-color);
      }

      .unsupported {
        color: var(--error-color);
        position: absolute;
        --mdc-icon-size: 16px;
        right: 5px;
        inset-inline-end: 5px;
        inset-inline-start: initial;
        top: 0px;
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ha-assist-webrtc-chat": HaAssistWebRTCChat;
  }
}
