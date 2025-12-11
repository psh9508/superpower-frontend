type Scene = "intro" | "capture" | "loading" | "result";
type FacingMode = "environment" | "user";
type CaptureStatusVariant = "info" | "success" | "error";
type S3Location = { bucket: string; key: string };

const queryParams = new URLSearchParams(window.location.search);
const mockParam = (queryParams.get("mock") || "").toLowerCase();
const mockDisabled = ["0", "false", "off"].includes(mockParam);
const DEV_DEFAULT_MOCK = import.meta.env.DEV && !mockDisabled;
const ALERT_LOG_ENABLED =
  import.meta.env.DEV ||
  ["1", "true", "on"].includes(
    (queryParams.get("debugLog") || queryParams.get("debug") || "").toLowerCase()
  );
const MOCK_CAPTURE_MODE =
  (!mockDisabled && queryParams.get("mode") === "mock") ||
  ["1", "true"].includes(mockParam) ||
  DEV_DEFAULT_MOCK;
const initialConnectionId =
  queryParams.get("connectionId") ||
  queryParams.get("ws") ||
  (() => {
    try {
      return localStorage.getItem("connectionId");
    } catch {
      return null;
    }
  })() ||
  null;
const SOCKET_URL = "wss://8eycp5n6sf.execute-api.ap-northeast-2.amazonaws.com/production/";
const PRESIGN_ENDPOINT =
  "https://eiotnpeybc.execute-api.ap-northeast-2.amazonaws.com/Prod/get-input-url";
const UPLOAD_TYPE = "image/jpeg";
const UPLOAD_QUALITY = 0.92;
const FILE_EXTENSION = "jpg";
const MAX_CAPTURE_WIDTH = 720;
const LOADING_DURATION_MS = 60_000;
const LOADING_TIMEOUT_MS = 60_000;
const LOADING_TIMEOUT_SEC = LOADING_TIMEOUT_MS / 1000;
const MIN_LOADING_DURATION_MS = 3_000;
const LOADING_PROGRESS_INTERVAL_MS = 250;
const WS_RECONNECT_TIMEOUT_MS = 4_000;
const CONNECTION_ID_TIMEOUT_MS = 5_000;
const TIMEOUT_POPUP_VISIBLE_MS = 2600;
const TIMEOUT_POPUP_FADE_MS = 800;
const MOCK_SAMPLE_IMAGE_URL = "/demo-sample.jpg";
const MOBILE_ONLY_MESSAGE = "이 서비스는 모바일 브라우저에서만 촬영할 수 있어요. 스마트폰으로 접속해주세요.";

interface AppState {
  currentScene: Scene;
  stream: MediaStream | null;
  facingMode: FacingMode;
  isUploading: boolean;
  isCameraReady: boolean;
  jobId: string | null;
  lastUploadKey: string | null;
  loadingProgress: number;
  loadingStart: number | null;
  loadingTimer: number | null;
  pollTimer: number | null;
  pollAbort: AbortController | null;
  petImageUrl: string | null;
  petImageId: string | null;
  emotionSaving: boolean;
  connectionId: string | null;
  socket: WebSocket | null;
  wsStatus: "disconnected" | "connecting" | "connected";
}

const state: AppState = {
  currentScene: "intro",
  stream: null,
  facingMode: "environment",
  isUploading: false,
  isCameraReady: false,
  jobId: null,
  lastUploadKey: null,
  loadingProgress: 0,
  loadingStart: null,
  loadingTimer: null,
  pollTimer: null,
  pollAbort: null,
  petImageUrl: null,
  petImageId: null,
  emotionSaving: false,
  connectionId: initialConnectionId,
  socket: null,
  wsStatus: "disconnected",
};

const connectionIdWaiters: Array<(id: string) => void> = [];

const scenes = new Map<Scene, HTMLElement>();
const root = document.querySelector<HTMLElement>("[data-app-root]");
const bootAlert = document.getElementById("boot-alert") as HTMLDivElement | null;
const startBtn = document.getElementById("cta-start") as HTMLButtonElement | null;
const backBtn = document.getElementById("capture-back") as HTMLButtonElement | null;
const shutterBtn = document.getElementById("capture-shutter") as HTMLButtonElement | null;
const switchBtn = document.getElementById("capture-switch") as HTMLButtonElement | null;
const statusBox = document.getElementById("capture-status") as HTMLDivElement | null;
const statusText = document.getElementById("status-message") as HTMLSpanElement | null;
const statusMeta = document.getElementById("status-meta") as HTMLElement | null;
const videoEl = document.getElementById("camera-preview") as HTMLVideoElement | null;
const canvasEl = document.getElementById("capture-canvas") as HTMLCanvasElement | null;
const flashLayer = document.getElementById("capture-flash") as HTMLDivElement | null;
const loadingProgressFill = document.getElementById("loading-progress-fill") as HTMLSpanElement | null;
const loadingProgressText = document.getElementById("loading-progress-text") as HTMLSpanElement | null;
const loadingTimerText = document.getElementById("loading-timer-text") as HTMLSpanElement | null;
const loadingStatusMessage = document.getElementById(
  "loading-status-message"
) as HTMLParagraphElement | null;
const loadingRetryBtn = document.getElementById("loading-retry") as HTMLButtonElement | null;
const resultImage = document.getElementById("result-image") as HTMLImageElement | null;
const resultImagePlaceholder = document.getElementById(
  "result-image-placeholder"
) as HTMLDivElement | null;
const resultImageMeta = document.getElementById("result-image-meta") as HTMLParagraphElement | null;
const emotionInput = document.getElementById("emotion-input") as HTMLTextAreaElement | null;
const resultRetryBtn = document.getElementById("result-retry") as HTMLButtonElement | null;
const resultSaveBtn = document.getElementById("result-save") as HTMLButtonElement | null;
const resultToast = document.getElementById("result-toast") as HTMLParagraphElement | null;
const weeklyEvolveBtn = document.getElementById("btn-weekly-evolve") as HTMLButtonElement | null;
const evolveHomeBtn = document.getElementById("btn-evolved-home") as HTMLButtonElement | null;
const evolveProgressBar = document.getElementById("evolve-progress") as HTMLDivElement | null;
const evolvePercentLabel = document.getElementById("evolve-percent") as HTMLSpanElement | null;
const evolveStatusLabel = document.getElementById("evolve-status") as HTMLParagraphElement | null;
const alertLogPanel = document.getElementById("alert-log-panel") as HTMLDivElement | null;
const alertLogTextarea = document.getElementById("alert-log-text") as HTMLTextAreaElement | null;
const alertLogCopyBtn = document.getElementById("alert-log-copy") as HTMLButtonElement | null;
const wsIndicator = document.getElementById("ws-indicator") as HTMLDivElement | null;
const loadingPreview = document.getElementById("loading-preview") as HTMLDivElement | null;
const loadingPreviewImg = document.getElementById("loading-preview-image") as HTMLImageElement | null;
const loadingProgressMeta = document.getElementById("loading-progress-meta") as HTMLDivElement | null;
const devModal = document.getElementById("dev-modal") as HTMLDivElement | null;
const devModalCloseBtn = document.getElementById("dev-modal-close") as HTMLButtonElement | null;

let loadingPreviewTimer: number | null = null;
let loadingPreviewUrl: string | null = null;

function init() {
  if (!root) {
    showBootError("앱의 핵심 영역을 찾지 못했어요. 새로고침 후 다시 시도해주세요.");
    return;
  }

  if (!ALERT_LOG_ENABLED && alertLogPanel) {
    alertLogPanel.remove();
  }

  if (state.connectionId) {
    try {
      localStorage.setItem("connectionId", state.connectionId);
    } catch {
      // ignore
    }
  }

  document.querySelectorAll<HTMLElement>("[data-scene]").forEach((el) => {
    const sceneName = el.dataset.scene as Scene | undefined;
    if (sceneName) {
      scenes.set(sceneName, el);
    }
  });

  startBtn?.addEventListener("click", () => {
    if (!state.socket || state.wsStatus !== "connected") {
      initWebSocket();
    }
    showScene("capture");
  });
  backBtn?.addEventListener("click", handleBackToIntro);
  switchBtn?.addEventListener("click", toggleFacingMode);
  shutterBtn?.addEventListener("click", handleCapture);
  loadingRetryBtn?.addEventListener("click", handleLoadingRetry);
  resultRetryBtn?.addEventListener("click", handleResultRetry);
  resultSaveBtn?.addEventListener("click", handleEmotionSave);
  weeklyEvolveBtn?.addEventListener("click", startMegaEvolutionSequence);
  evolveHomeBtn?.addEventListener("click", () => {
    showScene("intro");
  });
  initWebSocket();
  alertLogCopyBtn?.addEventListener("click", handleAlertLogCopy);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopCamera();
    } else if (state.currentScene === "capture") {
      void activateCamera();
    }
  });

  window.addEventListener("beforeunload", () => {
    stopCamera();
    closeWebSocket();
  });

  showScene("intro");
  const captureHint = shouldBlockForNonMobile()
    ? MOBILE_ONLY_MESSAGE
    : "촬영 준비가 완료되면 여기서 안내해드릴게요.";
  setCaptureStatus(captureHint);
  updateCaptureControls();
  markAppReady();
  updateWsIndicator("disconnected");

  devModalCloseBtn?.addEventListener("click", () => {
    hideDevelopmentPopup(true);
  });
}

function showScene(next: Scene) {
  const prev = state.currentScene;
  state.currentScene = next;
  scenes.forEach((el, key) => {
    el.classList.toggle("is-active", key === next);
  });

  if (next === "capture" && prev !== "capture") {
    setUploading(false);
    if (shouldBlockForNonMobile()) {
      stopCamera();
      state.isCameraReady = false;
      setCaptureStatus(MOBILE_ONLY_MESSAGE, "error");
      updateCaptureControls();
      return;
    }
    void activateCamera();
  }
  if (prev === "capture" && next !== "capture") {
    stopCamera();
  }
  if (prev === "loading" && next !== "loading") {
    stopLoadingLoop();
  }
  if (prev === "result" && next !== "result") {
    clearEmotionState();
  }
  updateCaptureControls();
}

function handleBackToIntro() {
  if (state.isUploading) return;
  showScene("intro");
}

function toggleFacingMode() {
  const previousFacingMode = state.facingMode;
  state.facingMode = state.facingMode === "environment" ? "user" : "environment";
  updatePreviewMirror();
  void activateCamera(true, previousFacingMode);
}

function hasCameraSupport(): boolean {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

function shouldBlockForNonMobile(): boolean {
  return !isMobileDevice() && !MOCK_CAPTURE_MODE;
}

function isMobileDevice(): boolean {
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData && typeof uaData.mobile === "boolean") {
    return uaData.mobile;
  }
  return /Android|iPhone|iPad|iPod|Windows Phone|Mobi/i.test(navigator.userAgent);
}

async function activateCamera(forceRestart = false, previousFacingMode?: FacingMode) {
  if (!videoEl) return;
  updatePreviewMirror();
  if (shouldBlockForNonMobile()) {
    setCaptureStatus(MOBILE_ONLY_MESSAGE, "error");
    state.isCameraReady = false;
    updateCaptureControls();
    return;
  }
  if (MOCK_CAPTURE_MODE) {
    setCaptureStatus("모의 캡처 모드: 샘플 이미지를 사용해요.", "info");
    state.isCameraReady = true;
    updateCaptureControls();
    return;
  }
  if (!hasCameraSupport()) {
    setCaptureStatus("카메라를 찾지 못했어요. 모바일 브라우저에서 다시 시도해주세요.", "error");
    state.isCameraReady = false;
    updateCaptureControls();
    return;
  }

  const previousStream = state.stream;
  const fallbackFacingMode = previousFacingMode ?? state.facingMode;

  if (!forceRestart && state.stream) {
    videoEl.srcObject = state.stream;
    await videoEl.play().catch(() => undefined);
    state.isCameraReady = true;
    updateCaptureControls();
    setCaptureStatus("셔터를 눌러주세요!", "success");
    return;
  }

  setCaptureStatus(forceRestart ? "카메라를 전환하는 중입니다..." : "카메라를 준비하는 중입니다...");
  updateCaptureControls();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: state.facingMode,
        width: { ideal: 720 },
        height: { ideal: 1280 },
      },
    });
    videoEl.srcObject = stream;
    await videoEl.play().catch(() => undefined);
    state.stream = stream;
    state.isCameraReady = true;
    if (previousStream && previousStream !== stream) {
      previousStream.getTracks().forEach((track) => track.stop());
    }
    setCaptureStatus("셔터를 눌러주세요!", "success");
  } catch (error) {
    console.error("[camera] failed", error);
    if (previousStream) {
      state.stream = previousStream;
      state.facingMode = fallbackFacingMode;
      videoEl.srcObject = previousStream;
      await videoEl.play().catch(() => undefined);
      state.isCameraReady = true;
      setCaptureStatus("카메라 전환에 실패했어요. 이전 카메라를 계속 사용할게요.", "info");
    } else {
      state.stream = null;
      state.isCameraReady = false;
      setCaptureStatus("카메라 접근에 실패했어요. 모바일 브라우저나 다른 환경에서 다시 시도해주세요.", "error");
    }
  } finally {
    updateCaptureControls();
  }
}

function stopCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }
  if (videoEl) {
    videoEl.srcObject = null;
  }
  state.stream = null;
  state.isCameraReady = false;
  updateCaptureControls();
}

function updateCaptureControls() {
  const canCapture = state.currentScene === "capture" && state.isCameraReady && !state.isUploading;
  if (shutterBtn) {
    shutterBtn.disabled = !canCapture;
  }
  if (switchBtn) {
    switchBtn.disabled = state.isUploading || !hasCameraSupport();
  }
  if (backBtn) {
    backBtn.disabled = state.isUploading;
  }
}

function updatePreviewMirror() {
  if (!videoEl) return;
  const shouldMirror = state.facingMode === "user";
  videoEl.classList.toggle("is-mirrored", shouldMirror);
}

async function handleCapture() {
  if (shouldBlockForNonMobile()) {
    setCaptureStatus(MOBILE_ONLY_MESSAGE, "error");
    return;
  }
  if (state.isUploading || !state.isCameraReady) return;
  const canUseCamera = Boolean(videoEl && canvasEl && state.stream);
  try {
    animateFlash();
    state.loadingStart = performance.now();
    const blob = canUseCamera && videoEl && canvasEl ? await captureFrame(videoEl, canvasEl) : await fetchMockCaptureBlob();
    showLoadingPreview(blob);
    const connectionId = await ensureWebSocketConnected();
    console.log("[connectionId]", connectionId);
    setUploading(true);

    setCaptureStatus("사진을 업로드하는 중이에요...", "info", "S3 업로드 준비 중");

    const fileName = buildFileName(connectionId);
    const presignedUrl = await fetchPresignedUrl(fileName, UPLOAD_TYPE);
    console.log("[presign]", presignedUrl);
    await uploadToPresignedUrl(presignedUrl, blob, UPLOAD_TYPE);
    const location = extractS3Location(presignedUrl);
    state.lastUploadKey = location.key;
    setCaptureStatus("이제 펫 생성을 요청하고 있어요…", "info");

    // const jobId = await requestGenerationJob(location);
    // state.jobId = jobId;

    // setCaptureStatus(
    //   jobId
    //     ? "사진 업로드 완료! 곧 펫 생성 씬으로 이동할게요."
    //     : "사진 업로드 완료! 생성 상태를 기다리고 있어요.",
    //   jobId ? "success" : "info",
    //   jobId ? `jobId: ${jobId}` : undefined
    // );
    window.setTimeout(() => beginLoadingPhase(""), 800);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "알 수 없는 오류가 발생했어요. 다시 시도해주세요.";
    const errorDetail =
      error instanceof Error
        ? `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ""}`
        : String(error);
    setCaptureStatus(message, "error");
    const alertText = `촬영/업로드 중 문제가 발생했습니다:\n${message}\n\n[DEBUG]\n${errorDetail}`;
    logAlertMessage(alertText);
    if (ALERT_LOG_ENABLED) {
      alert(alertText);
    } else {
      console.error(alertText);
    }
  } finally {
    setUploading(false);
  }
}

function animateFlash() {
  if (!flashLayer) return;
  flashLayer.classList.add("is-visible");
  window.setTimeout(() => flashLayer.classList.remove("is-visible"), 120);
}

function setUploading(active: boolean) {
  state.isUploading = active;
  updateCaptureControls();
}

function beginLoadingPhase(_jobId?: string | null) {
  resetResultScene();
  resetLoadingView();
  showScene("loading");
  startLoadingProgressTimer();
  // if (jobId) {
  //   startStatusPolling(jobId);
  // } else {
    setLoadingStatusMessage("서버에서 펫을 준비 중이에요.");
  // }
}

function resetLoadingView() {
  state.loadingProgress = 0;
  state.loadingStart = state.loadingStart ?? performance.now();
  updateLoadingProgress(0);
  renderLoadingTimer(0);
  setLoadingStatusMessage("서버에서 펫을 준비 중이에요.");
  toggleLoadingRetry(false);
  hideLoadingPreview();
  setLoadingProgressMetaVisible(true);
}

function startLoadingProgressTimer() {
  stopLoadingProgressTimer();
  state.loadingTimer = window.setInterval(() => updateLoadingProgress(), LOADING_PROGRESS_INTERVAL_MS);
}

function stopLoadingProgressTimer() {
  if (state.loadingTimer !== null) {
    window.clearInterval(state.loadingTimer);
    state.loadingTimer = null;
  }
}

function stopLoadingLoop() {
  stopLoadingProgressTimer();
  stopStatusPolling();
}

function updateLoadingProgress(forcedValue?: number) {
  if (typeof forcedValue === "number") {
    state.loadingProgress = forcedValue;
  } else if (state.loadingStart !== null) {
    const elapsed = performance.now() - state.loadingStart;
    const target = Math.min(100, (elapsed / LOADING_DURATION_MS) * 100);
    state.loadingProgress = Math.max(state.loadingProgress, target);
  }
  const progress = Math.min(100, Math.max(0, state.loadingProgress));
  if (loadingProgressFill) {
    loadingProgressFill.style.width = `${progress}%`;
  }
  if (loadingProgressText) {
    loadingProgressText.textContent = `펫 생성 진행 중… ${progress.toFixed(0)}%`;
  }
  if (state.loadingStart !== null) {
    const elapsed = performance.now() - state.loadingStart;
    renderLoadingTimer(elapsed);
    if (elapsed >= LOADING_TIMEOUT_MS && state.currentScene === "loading") {
      handleLoadingTimeout();
      return;
    }
  }
}

function renderLoadingTimer(elapsedMs: number) {
  if (!loadingTimerText) return;
  const clamped = Math.max(0, Math.min(elapsedMs, LOADING_TIMEOUT_MS));
  const seconds = Math.floor(clamped / 1000);
  const totalSeconds = Math.floor(LOADING_TIMEOUT_SEC);
  loadingTimerText.textContent = `${seconds}/(최대)${totalSeconds}초`;
}

function setLoadingProgressMetaVisible(visible: boolean) {
  if (!loadingProgressMeta) return;
  loadingProgressMeta.classList.toggle("is-hidden", !visible);
}

function showLoadingPreview(blob: Blob) {
  if (!loadingPreview || !loadingPreviewImg) return;
  hideLoadingPreview();
  loadingPreviewUrl = URL.createObjectURL(blob);
  loadingPreviewImg.src = loadingPreviewUrl;
  loadingPreview.hidden = false;
  setLoadingProgressMetaVisible(false);
  loadingPreviewTimer = window.setTimeout(() => {
    setLoadingProgressMetaVisible(true);
    hideLoadingPreview();
  }, 3000);
}

function hideLoadingPreview() {
  if (loadingPreviewTimer !== null) {
    window.clearTimeout(loadingPreviewTimer);
    loadingPreviewTimer = null;
  }
  if (loadingPreview) {
    loadingPreview.hidden = true;
  }
  if (loadingPreviewImg) {
    loadingPreviewImg.src = "";
  }
  if (loadingPreviewUrl) {
    URL.revokeObjectURL(loadingPreviewUrl);
    loadingPreviewUrl = null;
  }
}

function setLoadingStatusMessage(message: string, isError = false) {
  if (!loadingStatusMessage) return;
  loadingStatusMessage.textContent = message;
  loadingStatusMessage.classList.toggle("is-error", isError);
}

function toggleLoadingRetry(show: boolean) {
  if (!loadingRetryBtn) return;
  if (show) {
    loadingRetryBtn.hidden = false;
  } else {
    loadingRetryBtn.hidden = true;
  }
}

function handleLoadingRetry() {
  toggleLoadingRetry(false);
  setLoadingStatusMessage("새 촬영을 준비할게요.");
  showScene("capture");
  setCaptureStatus("다시 촬영을 진행해주세요.", "info");
}

function showTimeoutPopup(message: string) {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("role", "alert");
  wrapper.style.position = "fixed";
  wrapper.style.left = "50%";
  wrapper.style.top = "50%";
  wrapper.style.transform = "translate(-50%, -50%)";
  wrapper.style.padding = "22px 28px";
  wrapper.style.borderRadius = "22px";
  wrapper.style.backdropFilter = "blur(8px)";
  wrapper.style.background = "linear-gradient(135deg, rgba(255,201,214,0.94), rgba(142,128,255,0.94))";
  wrapper.style.color = "#1b0f26";
  wrapper.style.boxShadow = "0 18px 48px rgba(0,0,0,0.22)";
  wrapper.style.fontWeight = "800";
  wrapper.style.fontSize = "18px";
  wrapper.style.textAlign = "center";
  wrapper.style.maxWidth = "420px";
  wrapper.style.width = "calc(100% - 48px)";
  wrapper.style.zIndex = "9999";
  wrapper.style.opacity = "0";
  wrapper.style.transition = `opacity ${TIMEOUT_POPUP_FADE_MS}ms ease`;
  wrapper.textContent = message;

  document.body.appendChild(wrapper);
  requestAnimationFrame(() => {
    wrapper.style.opacity = "1";
  });

  window.setTimeout(() => {
    wrapper.style.opacity = "0";
    window.setTimeout(() => wrapper.remove(), TIMEOUT_POPUP_FADE_MS);
  }, TIMEOUT_POPUP_VISIBLE_MS);
}

function handleLoadingTimeout() {
  stopLoadingLoop();
  showTimeoutPopup("60초 동안 응답이 없어 촬영 화면으로 돌아갈게요.");
  setCaptureStatus("응답이 없어 업로드를 취소했어요. 다시 촬영해 주세요.", "error");
  showScene("capture");
}

// function startStatusPolling(jobId: string) {
//   stopStatusPolling();
//   const abortController = new AbortController();
//   state.pollAbort = abortController;

//   const poll = async () => {
//     if (abortController.signal.aborted) return;
//     try {
//       const payload = await fetchGenerationStatus(jobId, abortController.signal);
//       handleGenerationStatus(payload);
//     } catch (error) {
//       const message =
//         error instanceof Error ? error.message : "상태를 불러오지 못했어요. 다시 시도해주세요.";
//       setLoadingStatusMessage(message, true);
//       toggleLoadingRetry(true);
//       stopStatusPolling();
//       stopLoadingProgressTimer();
//     } finally {
//       if (!abortController.signal.aborted && state.currentScene === "loading") {
//         state.pollTimer = window.setTimeout(poll, POLLING_INTERVAL_MS);
//       }
//     }
//   };

//   void poll();
// }

function stopStatusPolling() {
  if (state.pollTimer !== null) {
    window.clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
  if (state.pollAbort) {
    state.pollAbort.abort();
    state.pollAbort = null;
  }
}

// function buildStatusUrl(jobId: string): string {
//   if (PET_STATUS_ENDPOINT.includes("{jobId}")) {
//     return PET_STATUS_ENDPOINT.replace("{jobId}", encodeURIComponent(jobId));
//   }
//   const base = PET_STATUS_ENDPOINT.replace(/\/$/, "");
//   return `${base}/${encodeURIComponent(jobId)}/status`;
// }

// async function fetchGenerationStatus(
//   jobId: string,
//   signal?: AbortSignal
// ): Promise<GenerationStatusPayload> {
//   if (!jobId) {
//     throw new Error("유효하지 않은 jobId 입니다.");
//   }
//   const endpoint = buildStatusUrl(jobId);
//   const response = await fetch(endpoint, { signal });
//   if (!response.ok) {
//     const text = await response.text().catch(() => "");
//     throw new Error(`상태 조회 실패 (HTTP ${response.status}) ${text}`);
//   }
//   const body = await response.json().catch(() => ({}));
//   if (body && typeof body === "object" && "body" in body && typeof body.body === "string") {
//     try {
//       return JSON.parse(body.body);
//     } catch {
//       return body as GenerationStatusPayload;
//     }
//   }
//   return body as GenerationStatusPayload;
// }

// function handleGenerationStatus(payload: GenerationStatusPayload) {
//   if (!payload) return;
//   const status: GenerationStatus = (payload.status as GenerationStatus) || "pending";
//   const progressValue = typeof payload.progress === "number" ? payload.progress : undefined;
//   if (typeof progressValue === "number") {
//     const normalized = Math.min(95, Math.max(0, progressValue));
//     updateLoadingProgress(Math.max(state.loadingProgress, normalized));
//   }
//   if (status === "failed") {
//     setLoadingStatusMessage(
//       payload.error || payload.message || "펫 생성에 실패했어요. 다시 시도해주세요.",
//       true
//     );
//     toggleLoadingRetry(true);
//     stopStatusPolling();
//     stopLoadingProgressTimer();
//     return;
//   }
//   if (status === "completed") {
//     const imageUrl = payload.imageUrl || payload.image_url || payload.outputUrl || null;
//     const imageId = payload.imageId || payload.image_id || payload.id || null;
//     handleGenerationComplete(imageUrl, imageId);
//   } else {
//     setLoadingStatusMessage("서버에서 펫을 준비 중이에요.");
//   }
// }

function handleGenerationComplete(imageUrl: string | null, imageId: string | null) {
  state.petImageUrl = imageUrl;
  state.petImageId = imageId;
  stopStatusPolling();
  stopLoadingProgressTimer();
  hideLoadingPreview();
  const elapsed = state.loadingStart ? performance.now() - state.loadingStart : 0;
  const waitForDuration = Math.max(0, MIN_LOADING_DURATION_MS - elapsed);
  updateLoadingProgress(Math.max(state.loadingProgress, 80));
  setLoadingStatusMessage("펫 이미지가 곧 도착합니다!");
  window.setTimeout(() => {
    updateLoadingProgress(100);
    window.setTimeout(() => showResultScene(), 500);
  }, waitForDuration);
}

function showResultScene() {
  showScene("result");
  renderResultImage(state.petImageUrl);
  if (resultImageMeta) {
    resultImageMeta.textContent = state.petImageId ? `imageId: ${state.petImageId}` : "";
  }
  showResultToast("");
}

function renderResultImage(url: string | null) {
  if (!resultImage || !resultImagePlaceholder) return;
  if (url) {
    resultImage.src = url;
    resultImage.classList.add("is-visible");
    resultImagePlaceholder.classList.add("is-hidden");
  } else {
    resultImage.removeAttribute("src");
    resultImage.classList.remove("is-visible");
    resultImagePlaceholder.classList.remove("is-hidden");
  }
}

function resetResultScene() {
  state.petImageUrl = null;
  state.petImageId = null;
  renderResultImage(null);
  showResultToast("");
  if (emotionInput) {
    emotionInput.value = "";
  }
  setEmotionSaving(false);
}

function handleResultRetry() {
  resetResultScene();
  state.jobId = null;
  state.lastUploadKey = null;
  state.loadingStart = null;
  stopLoadingLoop();
  stopCamera();
  state.isCameraReady = false;
  updateCaptureControls();
  void activateCamera();
  showScene("capture");
  setCaptureStatus("원하는 모습으로 다시 촬영해보세요.", "info");
}

function clearEmotionState() {
  showResultToast("");
  setEmotionSaving(false);
}

async function handleEmotionSave() {
  showDevelopmentPopup();
}

function setEmotionSaving(isSaving: boolean) {
  state.emotionSaving = isSaving;
  if (resultSaveBtn) {
    resultSaveBtn.disabled = isSaving;
    resultSaveBtn.textContent = isSaving ? "저장 중…" : "저장하기";
  }
}

function showResultToast(message: string, isError = false) {
  if (!resultToast) return;
  resultToast.textContent = message;
  resultToast.style.color = isError ? "#b4375f" : "#4b2b76";
}

async function captureFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<Blob> {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error("카메라 스트림이 아직 준비되지 않았어요.");
  }
  const { width, height } = getCanvasSize(video.videoWidth, video.videoHeight);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("이미지를 그릴 수 없습니다.");
  }
  ctx.drawImage(video, 0, 0, width, height);
  return canvasToBlob(canvas, UPLOAD_TYPE, UPLOAD_QUALITY);
}

function getCanvasSize(videoWidth: number, videoHeight: number) {
  if (videoWidth <= MAX_CAPTURE_WIDTH) {
    return { width: videoWidth, height: videoHeight };
  }
  const scale = MAX_CAPTURE_WIDTH / videoWidth;
  return {
    width: Math.round(videoWidth * scale),
    height: Math.round(videoHeight * scale),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("이미지 변환에 실패했습니다."));
        }
      },
      type,
      quality
    );
  });
}

function buildFileName(activeConnectionId?: string | null) {
  const prefix = activeConnectionId || state.connectionId || "emotion-pet";
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}/${stamp}-${random}.${FILE_EXTENSION}`;
}

async function fetchPresignedUrl(fileName: string, contentType: string): Promise<string> {
  const url = new URL(PRESIGN_ENDPOINT);
  const cleanName = state.connectionId ? fileName : sanitizeFileName(fileName);
  url.searchParams.set("fileName", cleanName);
  url.searchParams.set("key", cleanName);
  url.searchParams.set("contentType", contentType);

  console.log("[presign] request url:", url.toString());
  const response = await fetch(url.toString()).catch((error) => {
    throw new Error(`[presign] 네트워크 오류: ${(error as Error).message || String(error)}`);
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`업로드 URL 발급 실패 (HTTP ${response.status}) ${text}`);
  }
  const data = await response.json();
  const presignedUrl =
    data.presigned_url || data.uploadUrl || data.url || data.presignedUrl || data.signedUrl;
  if (!presignedUrl) {
    throw new Error("업로드 URL을 찾을 수 없습니다.");
  }
  console.log("[presign] received url:", presignedUrl);
  return presignedUrl;
}

async function uploadToPresignedUrl(url: string, blob: Blob, contentType: string) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: blob,
    });
  } catch (error) {
    throw new Error(`[upload] 네트워크 오류: ${(error as Error).message || String(error)}`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`S3 업로드 실패 (HTTP ${response.status}) ${text}`);
  }
  console.log("[upload] success:", url);
}

function extractS3Location(presignedUrl: string): S3Location {
  const url = new URL(presignedUrl);
  const [bucket] = url.hostname.split(".");
  const key = decodeURIComponent(url.pathname.replace(/^\//, ""));
  return { bucket, key };
}

function setCaptureStatus(message: string, variant: CaptureStatusVariant = "info", meta?: string) {
  if (statusBox) {
    statusBox.dataset.variant = variant;
  }
  if (statusText) {
    statusText.textContent = message;
  }
  if (statusMeta) {
    const metaMessages: string[] = [];
    if (meta) {
      metaMessages.push(meta);
    }
    if (!isMobileDevice() && !MOCK_CAPTURE_MODE) {
      metaMessages.push("카메라 접근이 필요한 경우 모바일 브라우저에서 접속해주세요.");
    }
    statusMeta.textContent = metaMessages.join(" · ");
    statusMeta.style.display = metaMessages.length ? "inline" : "none";
  }
}

function getActiveConnectionId(): string | null {
  return state.connectionId || null;
}

function setConnectionId(id: string | null) {
  if (!id) return;
  if (state.connectionId === id) return;
  state.connectionId = id;
  try {
    localStorage.setItem("connectionId", id);
  } catch {
    // ignore storage failures
  }
  console.info("[ws] connectionId set:", id);
  if (connectionIdWaiters.length) {
    const waiters = [...connectionIdWaiters];
    connectionIdWaiters.length = 0;
    waiters.forEach((resolver) => resolver(id));
  }
}

function clearConnectionId() {
  state.connectionId = null;
  try {
    localStorage.removeItem("connectionId");
  } catch {
    // ignore
  }
}

async function ensureWebSocketConnected(): Promise<string> {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    const existing = getActiveConnectionId();
    if (existing) return existing;
  }

  initWebSocket();
  if (!state.socket) throw new Error("WebSocket을 초기화하지 못했습니다.");

  const socket = state.socket;
  await waitForSocketOpen(socket);
  const connectionId = await waitForConnectionId();
  return connectionId;
}

function waitForSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (socket.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket 연결이 지연되고 있어요. 잠시 후 다시 시도해주세요."));
    }, WS_RECONNECT_TIMEOUT_MS);
    const handleOpen = () => {
      cleanup();
      resolve();
    };
    const handleClose = () => {
      cleanup();
      reject(new Error("WebSocket이 닫혀 있어요. 다시 시도해주세요."));
    };
    const handleError = () => {
      cleanup();
      reject(new Error("WebSocket 오류가 발생했습니다. 다시 시도해주세요."));
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("close", handleClose);
      socket.removeEventListener("error", handleError);
    };
    socket.addEventListener("open", handleOpen);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("error", handleError);
  });
}

function waitForConnectionId(): Promise<string> {
  if (state.connectionId) {
    return Promise.resolve(state.connectionId);
  }
  return new Promise<string>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("WebSocket 세션 ID를 받지 못했습니다. 잠시 후 다시 시도해주세요."));
    }, CONNECTION_ID_TIMEOUT_MS);
    const resolver = (id: string) => {
      cleanup();
      resolve(id);
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      const idx = connectionIdWaiters.indexOf(resolver);
      if (idx >= 0) {
        connectionIdWaiters.splice(idx, 1);
      }
    };
    connectionIdWaiters.push(resolver);
  });
}

function initWebSocket() {
  if (!SOCKET_URL) return;
  closeWebSocket();
  clearConnectionId();
  try {
    const socket = new WebSocket(SOCKET_URL);
    state.socket = socket;
    console.log("[ws] connecting to", SOCKET_URL);
    updateWsIndicator("connecting");

    socket.addEventListener("open", () => {
      console.log("[ws] connected");
      updateWsIndicator("connected");
      try {
        socket.send(JSON.stringify({ action: "ping" }));
      } catch (error) {
        console.warn("[ws] 초기 메시지 전송 실패:", error);
      }
    });

    socket.addEventListener("message", (event) => {
      handleWebSocketMessage(event.data);
    });

    socket.addEventListener("close", (event) => {
      console.warn("[ws] closed", {
        code: event.code,
        reason: event.reason || "(no reason)",
        wasClean: event.wasClean,
      });
      clearConnectionId();
      state.socket = null;
      updateWsIndicator("disconnected");
    });

    socket.addEventListener("error", (error) => {
      console.error("[ws] error:", error);
      clearConnectionId();
      updateWsIndicator("disconnected");
    });
  } catch (error) {
    console.error("[ws] connect failed:", error);
    updateWsIndicator("disconnected");
  }
}

function handleWebSocketMessage(data: unknown) {
  let payload: unknown = data;
  if (typeof data === "string") {
    try {
      payload = JSON.parse(data);
    } catch {
      payload = data;
    }
  }
  const connectionId = extractConnectionIdFromPayload(payload);
  if (connectionId) {
    setConnectionId(connectionId);
  }

  const imageUrl = extractImageUrlFromPayload(payload);
  const imageId = extractImageIdFromPayload(payload);
  if (imageUrl) {
    handleGenerationComplete(imageUrl, imageId);
  }
}

function extractConnectionIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  const candidates = ["connectionId", "connection_id", "connectionID", "id"];
  for (const key of candidates) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function extractImageUrlFromPayload(payload: unknown): string | null {
  if (!payload) return null;
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.startsWith("http") || trimmed.startsWith("data:")) {
      return trimmed;
    }
    return null;
  }
  if (typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  const candidates = ["downloadUrl", "download_url", "imageUrl", "image_url", "outputUrl", "url"];
  for (const key of candidates) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function extractImageIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  const candidates = ["imageId", "image_id", "id", "jobId", "job_id"];
  for (const key of candidates) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function closeWebSocket() {
  if (state.socket) {
    try {
      state.socket.close();
    } catch {
      // ignore
    }
    state.socket = null;
  }
}

function logAlertMessage(message: string) {
  if (!ALERT_LOG_ENABLED) return;
  if (!alertLogTextarea || !alertLogPanel) return;
  const timestamp = new Date().toISOString().replace("T", " ").replace("Z", "");
  const entry = `[${timestamp}] ${message}`;
  alertLogTextarea.value = alertLogTextarea.value
    ? `${entry}\n\n${alertLogTextarea.value}`
    : entry;
  alertLogPanel.classList.add("is-visible");
  alertLogPanel.hidden = false;
}

function handleAlertLogCopy() {
  if (!alertLogTextarea) return;
  const text = alertLogTextarea.value;
  if (!text) return;

  const fallbackCopy = () => {
    alertLogTextarea.select();
    document.execCommand("copy");
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(fallbackCopy);
  } else {
    fallbackCopy();
  }

  if (alertLogCopyBtn) {
    alertLogCopyBtn.textContent = "복사됨";
    window.setTimeout(() => {
      alertLogCopyBtn.textContent = "전체 복사";
    }, 1200);
  }
}

function updateWsIndicator(status: "disconnected" | "connecting" | "connected") {
  state.wsStatus = status;
  if (!wsIndicator) return;
  wsIndicator.classList.remove("is-connected", "is-connecting");
  if (status === "connected") {
    wsIndicator.classList.add("is-connected");
  } else if (status === "connecting") {
    wsIndicator.classList.add("is-connecting");
  }
}

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9./_+=-]/g, "_");
}

async function fetchMockCaptureBlob(): Promise<Blob> {
  const fallbackUrl = MOCK_SAMPLE_IMAGE_URL;
  const response = await fetch(fallbackUrl);
  if (!response.ok) {
    throw new Error(`모의 캡처 이미지를 불러오지 못했습니다 (HTTP ${response.status})`);
  }
  return await response.blob();
}

type ExtraScene = "weekly" | "evolve" | "evolved";

function activateStandaloneScene(target: Scene | ExtraScene) {
  document.querySelectorAll<HTMLElement>(".scene").forEach((section) => {
    const sceneName = section.dataset.scene;
    section.classList.toggle("is-active", sceneName === target);
  });
}

let evolveTimer: number | null = null;

function clearEvolveTimer() {
  if (evolveTimer !== null) {
    window.clearInterval(evolveTimer);
    evolveTimer = null;
  }
}

function startMegaEvolutionSequence() {
  if (!evolveProgressBar || !evolvePercentLabel || !evolveStatusLabel) {
    activateStandaloneScene("evolve");
    return;
  }
  activateStandaloneScene("evolve");
  clearEvolveTimer();
  let progress = 0;
  evolveProgressBar.style.width = "0%";
  evolvePercentLabel.textContent = "0%";
  evolveStatusLabel.textContent = "SUNNY 프롬프트 적용 중…";

  evolveTimer = window.setInterval(() => {
    progress = Math.min(100, progress + 20);
    evolveProgressBar.style.width = `${progress}%`;
    evolvePercentLabel.textContent = `${progress}%`;

    if (progress === 40) {
      evolveStatusLabel.textContent = "SUNNY 프롬프트 생성 중…";
    } else if (progress === 70) {
      evolveStatusLabel.textContent = "이미지 생성 요청…";
    }

    if (progress >= 100) {
      clearEvolveTimer();
      evolveStatusLabel.textContent = "SUNNY 메가 진화 완료!";
      window.setTimeout(() => activateStandaloneScene("evolved"), 500);
    }
  }, 400);
}

function markAppReady() {
  document.body.classList.add("boot-ready");
}

function showBootError(message: string) {
  document.body.classList.remove("boot-ready");
  if (bootAlert) {
    bootAlert.innerHTML = `<strong>앱 로딩에 실패했어요.</strong><div>${message}</div>`;
  }
}

function showDevelopmentPopup() {
  setEmotionSaving(true);
  if (!devModal) {
    showScene("intro");
    setEmotionSaving(false);
    return;
  }
  devModal.classList.add("is-visible");
  requestAnimationFrame(() => devModal.classList.add("is-active"));
}

function hideDevelopmentPopup(goHome: boolean) {
  if (devModal) {
    devModal.classList.remove("is-active");
    window.setTimeout(() => devModal?.classList.remove("is-visible"), TIMEOUT_POPUP_FADE_MS);
  }
  setEmotionSaving(false);
  if (goHome) {
    showScene("intro");
  }
}

window.addEventListener("error", () => {
  showBootError("앱을 불러오는 중 오류가 발생했어요. 새로고침하거나 네트워크 상태를 확인해주세요.");
});

window.addEventListener("unhandledrejection", () => {
  showBootError("앱을 불러오는 중 오류가 발생했어요. 새로고침하거나 네트워크 상태를 확인해주세요.");
});

try {
  init();
} catch (error) {
  console.error("[app] init failed", error);
  showBootError("앱을 불러오는 중 알 수 없는 오류가 발생했습니다.");
}
