import { el } from "@fullcalendar/core/internal-common";
import type { HomeAssistant } from "../types";
import type { ConversationResult } from "./conversation";
import type { ResolvedMediaSource } from "./media_source";
import type { SpeechMetadata } from "./stt";

export interface AssistPipeline {
  id: string;
  name: string;
  language: string;
  conversation_engine: string;
  conversation_language: string | null;
  prefer_local_intents?: boolean;
  stt_engine: string | null;
  stt_language: string | null;
  tts_engine: string | null;
  tts_language: string | null;
  tts_voice: string | null;
  wake_word_entity: string | null;
  wake_word_id: string | null;
}

export interface AssistDevice {
  device_id: string;
  pipeline_entity: string;
}

export interface AssistPipelineMutableParams {
  name: string;
  language: string;
  conversation_engine: string;
  conversation_language: string | null;
  prefer_local_intents?: boolean;
  stt_engine: string | null;
  stt_language: string | null;
  tts_engine: string | null;
  tts_language: string | null;
  tts_voice: string | null;
  wake_word_entity: string | null;
  wake_word_id: string | null;
}

export interface AssistRunListing {
  pipeline_run_id: string;
  timestamp: string;
}

interface PipelineEventBase {
  timestamp: string;
}

interface PipelineRunStartEvent extends PipelineEventBase {
  type: "run-start";
  data: {
    pipeline: string;
    language: string;
    runner_data: {
      stt_binary_handler_id: number | null;
      timeout: number;
    };
  };
}
interface PipelineRunEndEvent extends PipelineEventBase {
  type: "run-end";
  data: Record<string, never>;
}

interface PipelineErrorEvent extends PipelineEventBase {
  type: "error";
  data: {
    code: string;
    message: string;
  };
}

interface PipelineWakeWordStartEvent extends PipelineEventBase {
  type: "wake_word-start";
  data: {
    engine: string;
    metadata: SpeechMetadata;
  };
}

interface PipelineWakeWordEndEvent extends PipelineEventBase {
  type: "wake_word-end";
  data: { wake_word_output: { ww_id: string; timestamp: number } };
}

interface PipelineSTTStartEvent extends PipelineEventBase {
  type: "stt-start";
  data: {
    engine: string;
    metadata: SpeechMetadata;
  };
}
interface PipelineSTTEndEvent extends PipelineEventBase {
  type: "stt-end";
  data: {
    stt_output: { text: string };
  };
}

interface PipelineIntentStartEvent extends PipelineEventBase {
  type: "intent-start";
  data: {
    engine: string;
    language: string;
    prefer_local_intents: boolean;
    intent_input: string;
  };
}
interface PipelineIntentEndEvent extends PipelineEventBase {
  type: "intent-end";
  data: {
    processed_locally: boolean;
    intent_output: ConversationResult;
  };
}

interface PipelineTTSStartEvent extends PipelineEventBase {
  type: "tts-start";
  data: {
    engine: string;
    language: string;
    voice: string;
    tts_input: string;
  };
}
interface PipelineTTSEndEvent extends PipelineEventBase {
  type: "tts-end";
  data: {
    tts_output: ResolvedMediaSource;
  };
}

export type PipelineRunEvent =
  | PipelineRunStartEvent
  | PipelineRunEndEvent
  | PipelineErrorEvent
  | PipelineWakeWordStartEvent
  | PipelineWakeWordEndEvent
  | PipelineSTTStartEvent
  | PipelineSTTEndEvent
  | PipelineIntentStartEvent
  | PipelineIntentEndEvent
  | PipelineTTSStartEvent
  | PipelineTTSEndEvent;

export type PipelineRunOptions = (
  | {
      start_stage: "intent" | "tts";
      input: { text: string };
    }
  | {
      start_stage: "stt";
      input: { sample_rate: number };
    }
  | {
      start_stage: "wake_word";
      input: {
        sample_rate: number;
        timeout?: number;
        audio_seconds_to_buffer?: number;
      };
    }
) & {
  end_stage: "stt" | "intent" | "tts";
  pipeline?: string;
  conversation_id?: string | null;
};

export interface PipelineRun {
  init_options?: PipelineRunOptions;
  events: PipelineRunEvent[];
  stage: "ready" | "wake_word" | "stt" | "intent" | "tts" | "done" | "error";
  run: PipelineRunStartEvent["data"];
  error?: PipelineErrorEvent["data"];
  wake_word?: PipelineWakeWordStartEvent["data"] &
    Partial<PipelineWakeWordEndEvent["data"]> & { done: boolean };
  stt?: PipelineSTTStartEvent["data"] &
    Partial<PipelineSTTEndEvent["data"]> & { done: boolean };
  intent?: PipelineIntentStartEvent["data"] &
    Partial<PipelineIntentEndEvent["data"]> & { done: boolean };
  tts?: PipelineTTSStartEvent["data"] &
    Partial<PipelineTTSEndEvent["data"]> & { done: boolean };
}

export const processEvent = (
  run: PipelineRun | undefined,
  event: PipelineRunEvent,
  options?: PipelineRunOptions
): PipelineRun | undefined => {
  if (event.type === "run-start") {
    run = {
      init_options: options,
      stage: "ready",
      run: event.data,
      events: [event],
    };
    return run;
  }

  if (!run) {
    // eslint-disable-next-line no-console
    console.warn("Received unexpected event before receiving session", event);
    return undefined;
  }

  if (event.type === "wake_word-start") {
    run = {
      ...run,
      stage: "wake_word",
      wake_word: { ...event.data, done: false },
    };
  } else if (event.type === "wake_word-end") {
    run = {
      ...run,
      wake_word: { ...run.wake_word!, ...event.data, done: true },
    };
  } else if (event.type === "stt-start") {
    run = {
      ...run,
      stage: "stt",
      stt: { ...event.data, done: false },
    };
  } else if (event.type === "stt-end") {
    run = {
      ...run,
      stt: { ...run.stt!, ...event.data, done: true },
    };
  } else if (event.type === "intent-start") {
    run = {
      ...run,
      stage: "intent",
      intent: { ...event.data, done: false },
    };
  } else if (event.type === "intent-end") {
    run = {
      ...run,
      intent: { ...run.intent!, ...event.data, done: true },
    };
  } else if (event.type === "tts-start") {
    run = {
      ...run,
      stage: "tts",
      tts: { ...event.data, done: false },
    };
  } else if (event.type === "tts-end") {
    run = {
      ...run,
      tts: { ...run.tts!, ...event.data, done: true },
    };
  } else if (event.type === "run-end") {
    run = { ...run, stage: "done" };
  } else if (event.type === "error") {
    run = { ...run, stage: "error", error: event.data };
  } else {
    run = { ...run };
  }

  run.events = [...run.events, event];

  return run;
};

export const runDebugAssistPipeline = (
  hass: HomeAssistant,
  callback: (run: PipelineRun) => void,
  options: PipelineRunOptions
) => {
  let run: PipelineRun | undefined;

  const unsubProm = runAssistPipeline(
    hass,
    (updateEvent) => {
      run = processEvent(run, updateEvent, options);

      if (updateEvent.type === "run-end" || updateEvent.type === "error") {
        unsubProm.then((unsub) => unsub());
      }

      if (run) {
        callback(run);
      }
    },
    options
  );

  return unsubProm;
};

export const runAssistPipeline = (
  hass: HomeAssistant,
  callback: (event: PipelineRunEvent) => void,
  options: PipelineRunOptions
) =>
  hass.connection.subscribeMessage<PipelineRunEvent>(callback, {
    ...options,
    type: "assist_pipeline/run",
  });

export const listAssistPipelineRuns = (
  hass: HomeAssistant,
  pipeline_id: string
) =>
  hass.callWS<{
    pipeline_runs: AssistRunListing[];
  }>({
    type: "assist_pipeline/pipeline_debug/list",
    pipeline_id,
  });

export const getAssistPipelineRun = (
  hass: HomeAssistant,
  pipeline_id: string,
  pipeline_run_id: string
) =>
  hass.callWS<{
    events: PipelineRunEvent[];
  }>({
    type: "assist_pipeline/pipeline_debug/get",
    pipeline_id,
    pipeline_run_id,
  });

export const listAssistPipelines = (hass: HomeAssistant) =>
  hass.callWS<{
    pipelines: AssistPipeline[];
    preferred_pipeline: string | null;
  }>({
    type: "assist_pipeline/pipeline/list",
  });

export const getAssistPipeline = (hass: HomeAssistant, pipeline_id?: string) =>
  hass.callWS<AssistPipeline>({
    type: "assist_pipeline/pipeline/get",
    pipeline_id,
  });

export const createAssistPipeline = (
  hass: HomeAssistant,
  pipeline: AssistPipelineMutableParams
) =>
  hass.callWS<AssistPipeline>({
    type: "assist_pipeline/pipeline/create",
    ...pipeline,
  });

export const updateAssistPipeline = (
  hass: HomeAssistant,
  pipeline_id: string,
  pipeline: AssistPipelineMutableParams
) =>
  hass.callWS<AssistPipeline>({
    type: "assist_pipeline/pipeline/update",
    pipeline_id,
    ...pipeline,
  });

export const setAssistPipelinePreferred = (
  hass: HomeAssistant,
  pipeline_id: string
) =>
  hass.callWS({
    type: "assist_pipeline/pipeline/set_preferred",
    pipeline_id,
  });

export const deleteAssistPipeline = (hass: HomeAssistant, pipelineId: string) =>
  hass.callWS<void>({
    type: "assist_pipeline/pipeline/delete",
    pipeline_id: pipelineId,
  });

export const fetchAssistPipelineLanguages = (hass: HomeAssistant) =>
  hass.callWS<{ languages: string[] }>({
    type: "assist_pipeline/language/list",
  });

export const listAssistDevices = (hass: HomeAssistant) =>
  hass.callWS<AssistDevice[]>({
    type: "assist_pipeline/device/list",
  });


export const startWebRtcAssistPipeline = async (
  hass: HomeAssistant,
  callback: (event: PipelineRunEvent) => void,
) => {
  // Browser support required for WebRTC
  if (typeof RTCPeerConnection === "undefined") {
    throw new Error("WebRTC not supported in this browser");
  }
  const config = {
    sdpSemantics: 'unified-plan',
    iceServers: [
        {
            urls: ['stun:stun1.l.google.com:19302', 'stun:stun3.l.google.com:19302']
        }
    ]
}


  let peerConnection = new RTCPeerConnection(config);
  let channel = peerConnection.createDataChannel("chat");
  channel.onopen = () => {
    console.log("datachannel open");
  };
  channel.onclose = () => {
    console.log("datachannel close");
  };
  channel.onmessage = (event) => {
    console.log("datachannel message", event.data);
    callback(event)
  };
  channel.onstatechange = () => {
    console.log("datachannel state:", channel.readyState);
  };
  peerConnection.ondatachannel = (event) => {
    console.log("datachannel Received ");
    const receiveChannel = event.channel;
    receiveChannel.onmessage = (event) => {
      console.log("ondatachannel message:", event.data);
      callback(event);
    };
  };
  peerConnection.onsignalingstatechange = (ev) => {
    switch ((ev.target as RTCPeerConnection).signalingState) {
      case "stable":
        console.log("Connection established");
        break;
      default:
        console.log(
          "Signaling state changed",
          (ev.target as RTCPeerConnection).signalingState
        );
    }
  };
  peerConnection.oniceconnectionstatechange = () => {
    console.log("ICE connection state changed:", peerConnection.iceConnectionState);
    if (peerConnection.iceConnectionState === "failed") {
      console.error("ICE connection failed. Closing peer connection.");
      peerConnection.close();
    }
  };
  peerConnection.onconnectionstatechange = () => {
    console.log("Connection state changed:", peerConnection.connectionState);
    if (peerConnection.connectionState === "failed") {
      console.error("Connection failed. Cleaning up.");
      peerConnection.close();
    }
  };
  // Setup callbacks to render remote stream once media tracks are discovered.
  let remoteStream = new MediaStream();
  const addTrack = async (event: RTCTrackEvent) => {
    console.log("Track added: " + event.track.kind);
    remoteStream.addTrack(event.track);
  };
  peerConnection.ontrack = addTrack;
  peerConnection.addTransceiver("audio", { direction: "sendrecv" });

  const offerOptions: RTCOfferOptions = {
    offerToReceiveAudio: true,
    offerToReceiveVideo: false,
  };

  console.log("start createOffer", offerOptions);
  const offer: RTCSessionDescriptionInit =
    await peerConnection.createOffer(offerOptions);

  console.log("end createOffer", offer);
  console.log("start setLocalDescription");
  await peerConnection.setLocalDescription(offer);
  console.log("end setLocalDescription");

  const answer = await hass.callWS<string>({
    type: "assist_pipeline/run_webrtc",
    "offer_sdp": offer.sdp,
  });
  console.log("Received answer: " + answer);

  // Initiate the stream with the remote device
  const remoteDesc = new RTCSessionDescription({
    type: "answer",
    sdp: answer,
  });
  try {
    console.log("start setRemoteDescription", remoteDesc);
    await peerConnection.setRemoteDescription(remoteDesc);
  } catch (err: any) {
    console.log("Failed to connect WebRTC stream: " + err.message);
    peerConnection.close();
    throw err;
  }
  let p = new Promise(function (resolve, event) {
    setTimeout(() => {
      console.log("Timeout");
      resolve();
    }, 5000);
  });
  console.log("end setRemoteDescription - connection state: " + peerConnection.connectionState);
  await p;
  console.log("end setRemoteDescription - connection state: " + peerConnection.connectionState);
  return {
    sendData: (message: string) => {
      if (channel.readyState === "open") {
        console.log("Sending text: " + message);
        channel.send(message);
      } else {
        console.error("Cannot send data. DataChannel is not open. Current state:", channel.readyState);
      }
    },
    sendAudio: (message: string) => {
      console.log("Sending audio")
      channel.send(message);
    }
  }
}
