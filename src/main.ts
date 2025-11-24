const video = document.getElementById("video") as HTMLVideoElement | null;
const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
const openBtn = document.getElementById("open") as HTMLButtonElement | null;
const snapBtn = document.getElementById("snap") as HTMLButtonElement | null;
const switchBtn = document.getElementById("switch") as HTMLButtonElement | null;
const saveBtn = document.getElementById("save") as HTMLButtonElement | null;
const stopBtn = document.getElementById("stop") as HTMLButtonElement | null;
const uploadOverlay = document.getElementById("upload-overlay") as HTMLDivElement | null;
const waitingPanel = document.getElementById("waiting-panel") as HTMLDivElement | null;
const waitingTitle = document.getElementById("waiting-title") as HTMLDivElement | null;
const waitingDesc = document.getElementById("waiting-desc") as HTMLDivElement | null;
const waitingPulse = document.getElementById("waiting-pulse") as HTMLDivElement | null;
const waitingImage = document.getElementById("waiting-image") as HTMLImageElement | null;
const waitingTimer = document.getElementById("waiting-timer") as HTMLDivElement | null;
const captureSlot = document.getElementById("capture-slot") as HTMLDivElement | null;
const waitingClose = document.getElementById("waiting-close") as HTMLButtonElement | null;
const wsClose = document.getElementById("ws-close") as HTMLButtonElement | null;
const wsBox = document.getElementById("ws-box") as HTMLElement | null;
const wsToggle = document.getElementById("ws-toggle") as HTMLButtonElement | null;
const previewGrid = document.getElementById("preview-grid") as HTMLDivElement | null;
const splashScreen = document.getElementById("splash-screen") as HTMLElement | null;
const cameraStage = document.getElementById("camera-stage") as HTMLElement | null;
const expressionOverlay = document.getElementById("expression-overlay") as HTMLDivElement | null;
const expressionIcon = document.getElementById("expression-icon") as HTMLDivElement | null;
const expressionLabel = document.getElementById("expression-label") as HTMLParagraphElement | null;
const captureCountdown = document.getElementById("capture-countdown") as HTMLParagraphElement | null;
const rerollBtn = document.getElementById("expression-reroll") as HTMLButtonElement | null;
const timeoutOverlay = document.getElementById("timeout-overlay") as HTMLDivElement | null;
const timeoutRetryBtn = document.getElementById("timeout-retry") as HTMLButtonElement | null;
const isLocalMode =
  ["localhost", "127.0.0.1", "::1"].includes(location.hostname) ||
  location.protocol === "file:";
const LOCAL_FALLBACK_IMAGE = "static/다운로드.jpg";
const PRESIGN_ENDPOINT = "https://jxvrngbw4b.execute-api.ap-northeast-2.amazonaws.com/Prod/get-input-url";
const STEP_FUNCTION_ENDPOINT = "https://liggexjgk3.execute-api.ap-northeast-2.amazonaws.com/make-image";
const UPLOAD_TYPE = "image/jpeg";
const UPLOAD_QUALITY = 0.92;
const UPLOAD_EXTENSION = "jpg";
const MAX_CANVAS_WIDTH = 720;
const WAITING_TIMEOUT_SEC = 60;
const EXPRESSION_SPIN_DURATION_MS = 3000;
const EXPRESSION_SPIN_INTERVAL_MS = 120;
const CAPTURE_TIME_LIMIT_SEC = 10;
const filePicker = document.getElementById("file-picker") as HTMLInputElement | null;
const uploadFilesBtn = document.getElementById("upload-files") as HTMLButtonElement | null;
let pendingFiles: File[] = [];
type S3Location = { bucket: string; key: string };
type ExpressionOption = { icon: string; label: string };
const EXPRESSION_OPTIONS: ExpressionOption[] = [
  { icon: "😄", label: "웃는 표정" },
  { icon: "🤪", label: "바보 표정" },
  { icon: "😡", label: "화난 표정" },
  { icon: "😎", label: "자신감 표정" },
  { icon: "😱", label: "놀란 표정" },
  { icon: "😢", label: "슬픈 표정" },
];

let stream: MediaStream | null = null;
let hasCapture = false;
let currentFacing: "environment" | "user" = "environment";
let waitingTimeout: number | null = null;
let waitingInterval: number | null = null;
let waitingRemaining = WAITING_TIMEOUT_SEC;
let expressionInterval: number | null = null;
let expressionTimeout: number | null = null;
let captureCountdownTimer: number | null = null;
let captureTimeRemaining = CAPTURE_TIME_LIMIT_SEC;
let isSpinningExpression = false;
let isCaptureWindowActive = false;
let expressionOverlayHideTimeout: number | null = null;
let isTimeoutState = false;

function setButtonState() {
  const hasStream = Boolean(stream);
  const allowSnap = isCaptureWindowActive && (hasStream || isLocalMode);
  if (snapBtn) snapBtn.disabled = !allowSnap;
  if (stopBtn) stopBtn.disabled = !hasStream;
  if (switchBtn) switchBtn.disabled = !hasStream;
  if (saveBtn) saveBtn.disabled = !hasCapture;
  if (rerollBtn) {
    const stageVisible = cameraStage ? !cameraStage.classList.contains("is-hidden") : false;
    rerollBtn.disabled = !stageVisible || isSpinningExpression;
  }
  updateSwitchLabel();
  updateVideoTransform();
}

function updateSwitchLabel() {
  if (!switchBtn) return;
  const label = currentFacing === "environment" ? "전면 전환" : "후면 전환";
  switchBtn.textContent = "🔄";
  switchBtn.setAttribute("aria-label", label);
  switchBtn.setAttribute("title", label);
}

function updateVideoTransform() {
  if (!video) return;
  const isFront = currentFacing === "user";
  video.style.transform = isFront ? "scaleX(-1)" : "scaleX(1)";
}

function setExpressionOverlayHidden(hidden: boolean) {
  if (!expressionOverlay) return;
  expressionOverlay.classList.toggle("is-hidden", hidden);
}

function showExpressionOverlay() {
  if (expressionOverlayHideTimeout !== null) {
    window.clearTimeout(expressionOverlayHideTimeout);
    expressionOverlayHideTimeout = null;
  }
  setExpressionOverlayHidden(false);
}

function hideExpressionOverlayAfter(delayMs: number) {
  if (expressionOverlayHideTimeout !== null) {
    window.clearTimeout(expressionOverlayHideTimeout);
  }
  expressionOverlayHideTimeout = window.setTimeout(() => {
    if (!isTimeoutState) {
      setExpressionOverlayHidden(true);
    }
    expressionOverlayHideTimeout = null;
  }, delayMs);
}

function toggleSplashScreen(showSplash: boolean) {
  if (splashScreen) {
    splashScreen.classList.toggle("is-hidden", !showSplash);
  }
  if (cameraStage) {
    cameraStage.classList.toggle("is-hidden", showSplash);
  }
  if (openBtn) {
    openBtn.disabled = !showSplash;
  }
  if (showSplash) {
    setExpressionOverlayHidden(true);
    setTimeoutState(false);
  } else {
    showExpressionOverlay();
    setTimeoutState(false);
  }
}

function isSplashVisible(): boolean {
  return splashScreen ? !splashScreen.classList.contains("is-hidden") : false;
}

function setTimeoutState(active: boolean) {
  isTimeoutState = active;
  if (timeoutOverlay) {
    timeoutOverlay.classList.toggle("is-visible", active);
  }
  if (active) {
    setExpressionOverlayHidden(true);
  } else {
    if (!isSplashVisible()) {
      showExpressionOverlay();
    }
  }
}

async function openCamera(facing: "environment" | "user" = currentFacing): Promise<boolean> {
  if (!video) return false;
  try {
    currentFacing = facing;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facing },
      },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    alert(`카메라 접근 실패: ${message}`);
    stream = null;
    return false;
  } finally {
    setButtonState();
    updateVideoTransform();
  }
}

function updateExpressionStatus(icon: string, text: string) {
  if (expressionIcon) {
    expressionIcon.textContent = icon;
  }
  if (expressionLabel) {
    expressionLabel.textContent = text;
  }
}

function setCaptureCountdownMessage(message?: string) {
  if (!captureCountdown) return;
  captureCountdown.textContent = message || "";
}

function refreshCaptureCountdown() {
  if (!isCaptureWindowActive) {
    setCaptureCountdownMessage();
    return;
  }
  setCaptureCountdownMessage(`${captureTimeRemaining}초`);
}

function clearExpressionSpin() {
  if (expressionInterval !== null) {
    window.clearInterval(expressionInterval);
    expressionInterval = null;
  }
  if (expressionTimeout !== null) {
    window.clearTimeout(expressionTimeout);
    expressionTimeout = null;
  }
  isSpinningExpression = false;
  expressionOverlay?.classList.remove("is-spinning");
}

function getRandomExpression(): ExpressionOption {
  return EXPRESSION_OPTIONS[Math.floor(Math.random() * EXPRESSION_OPTIONS.length)];
}

function startExpressionSpin() {
  clearExpressionSpin();
  setTimeoutState(false);
  updateExpressionStatus("🎲", "표정을 뽑는 중...");
  isSpinningExpression = true;
  showExpressionOverlay();
  expressionOverlay?.classList.add("is-spinning");
  expressionInterval = window.setInterval(() => {
    const option = getRandomExpression();
    updateExpressionStatus(option.icon, `${option.label} 준비!`);
  }, EXPRESSION_SPIN_INTERVAL_MS);
  expressionTimeout = window.setTimeout(() => {
    finalizeExpressionSelection();
  }, EXPRESSION_SPIN_DURATION_MS);
}

function finalizeExpressionSelection() {
  clearExpressionSpin();
  const option = getRandomExpression();
  updateExpressionStatus(option.icon, `${option.label}!`);
  hideExpressionOverlayAfter(1000);
  startCaptureWindow();
}

function startCaptureWindow() {
  endCaptureWindow(false);
  isCaptureWindowActive = true;
  captureTimeRemaining = CAPTURE_TIME_LIMIT_SEC;
  refreshCaptureCountdown();
  setTimeoutState(false);
  captureCountdownTimer = window.setInterval(() => {
    captureTimeRemaining -= 1;
    if (captureTimeRemaining <= 0) {
      updateExpressionStatus("🎲", "시간 초과! GAME START 버튼을 눌러 다시 시도하세요.");
      endCaptureWindow(true);
    } else {
      refreshCaptureCountdown();
    }
  }, 1000);
  setButtonState();
}

function endCaptureWindow(timedOut = false, message?: string) {
  if (captureCountdownTimer !== null) {
    window.clearInterval(captureCountdownTimer);
    captureCountdownTimer = null;
  }
  captureTimeRemaining = CAPTURE_TIME_LIMIT_SEC;
  isCaptureWindowActive = false;
  if (timedOut) {
    setCaptureCountdownMessage("시간 초과! GAME START 버튼을 눌러 다시 도전하세요.");
  } else if (message) {
    setCaptureCountdownMessage(message);
  } else {
    setCaptureCountdownMessage();
  }
  if (timedOut && expressionLabel) {
    const stageVisible = cameraStage ? !cameraStage.classList.contains("is-hidden") : false;
    expressionLabel.textContent = stageVisible
      ? "시간 초과! 다시 뽑기 버튼으로 재도전하세요."
      : "시간 초과! GAME START 버튼을 눌러 다시 시도하세요.";
  }
  setTimeoutState(timedOut);
  setButtonState();
}

function resetGameFlow(message?: string) {
  clearExpressionSpin();
  endCaptureWindow(false);
  const isStageVisible = cameraStage ? !cameraStage.classList.contains("is-hidden") : false;
  const defaultMessage = isStageVisible
    ? "다시 뽑기 버튼으로 표정을 뽑아보세요."
    : "GAME START 버튼을 눌러 표정을 뽑아보세요.";
  updateExpressionStatus("🎲", message || defaultMessage);
  if (isStageVisible) {
    showExpressionOverlay();
  } else {
    setExpressionOverlayHidden(true);
  }
}

function handleCaptureComplete() {
  endCaptureWindow(false, "촬영 완료!");
  if (expressionLabel) {
    expressionLabel.textContent = "촬영 완료! 다시 뽑기 버튼으로 새로운 표정을 뽑아보세요.";
  }
  setExpressionOverlayHidden(true);
  setTimeoutState(false);
  setButtonState();
}

async function startGameRound(source: "splash" | "reroll" = "reroll") {
  if (isSpinningExpression) return;
  clearExpressionSpin();
  endCaptureWindow(false);
  if (source === "splash") {
    toggleSplashScreen(false);
  }
  setButtonState();
  const needsCameraStart = !isLocalMode && (!stream || source === "splash");
  if (needsCameraStart) {
    updateExpressionStatus("🎲", "카메라를 준비하고 있어요...");
    const ready = await openCamera("user");
    if (!ready) {
      updateExpressionStatus("🎲", "카메라 접근을 허용한 뒤 다시 시도해주세요.");
      if (source === "splash") {
        toggleSplashScreen(true);
      }
      resetGameFlow();
      return;
    }
  } else if (isLocalMode) {
    setButtonState();
  }
  startExpressionSpin();
}

async function takePhoto() {
  if (!isCaptureWindowActive) {
    alert("GAME START 버튼으로 표정을 뽑은 뒤 촬영해주세요.");
    return;
  }

  if (isLocalMode) {
    const ok = await drawLocalFallback();
    if (ok) {
      hasCapture = true;
      setButtonState();
      showWaitingPanel(false);
      clearWaitingTimeout();
      setWaitingStatus("pending");
      clearResultImage();
      resetWaitingCountdown();
      handleCaptureComplete();
    }
    return;
  }

  if (!video || !canvas || !stream) {
    alert("카메라가 아직 준비되지 않았습니다.");
    return;
  }

  if (!video.videoWidth || !video.videoHeight) {
    alert("비디오 프레임이 준비 중입니다. 잠시만 기다려주세요.");
    return;
  }

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const { targetW, targetH } = resizeCanvasForSource(vw, vh);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.save();
  if (currentFacing === "user") {
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, vw, vh, -targetW, 0, targetW, targetH);
  } else {
    ctx.drawImage(video, 0, 0, vw, vh, 0, 0, targetW, targetH);
  }
  ctx.restore();
  hasCapture = true;
  setButtonState();
  await renderPreviewFromCanvas();
  showWaitingPanel(false);
  clearWaitingTimeout();
  setWaitingStatus("pending");
  clearResultImage();
  resetWaitingCountdown();
  handleCaptureComplete();
}

async function generateImage() {
  if (!hasCapture && pendingFiles.length === 0) {
    alert("이미지를 먼저 촬영해주세요.");
    return;
  }

  if (!canvas && pendingFiles.length === 0) {
    alert("캔버스가 준비되지 않았습니다.");
    return;
  }

  const connectionId = getWebSocketConnectionId();
  if (!connectionId) {
    alert('WebSocket connectionId를 찾을 수 없습니다.');
    return;
  }

  if (pendingFiles.length > 0) {
    try {
      setWaitingStatus("pending");
      setUploading(true);
      startWaitingTimeout();
      const locations = await uploadPendingFiles(connectionId, pendingFiles);
      animateSendSuccess();
      clearPendingFiles();
      hasCapture = false;
      setButtonState();
      await startStepFunction(locations);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[upload] failed:", error);
      alert(`이미지 업로드 실패: ${message}`);
    } finally {
      setUploading(false);
      showWaitingPanel(!hasCapture);
    }
    return;
  }

  const fileName = `${connectionId}/${connectionId}.${UPLOAD_EXTENSION}`;
  const canvasEl = canvas;
  if (!canvasEl) {
    alert("캔버스가 준비되지 않았습니다.");
    return;
  }

  try {
    setWaitingStatus("pending");
    setUploading(true);
    startWaitingTimeout();
    const presignedUrl = await fetchPresignedUrl(fileName, UPLOAD_TYPE);
    const blob = await canvasToBlob(canvasEl, UPLOAD_TYPE, UPLOAD_QUALITY);
    await uploadToPresignedUrl(presignedUrl, blob, UPLOAD_TYPE);
    animateSendSuccess();
    const location = extractS3Location(presignedUrl);
    await startStepFunction([location]);
    hasCapture = false;
    setButtonState();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[upload] failed:", error);
    alert(`이미지 업로드 실패: ${message}`);
  } finally {
    setUploading(false);
    showWaitingPanel(!hasCapture);
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  hasCapture = false;
  pendingFiles = [];
  clearPendingFiles();
  if (video) {
    video.srcObject = null;
    video.style.transform = "scaleX(1)";
  }
  resetGameFlow();
  toggleSplashScreen(true);
  setTimeoutState(false);
  setButtonState();
}

openBtn?.addEventListener("click", () => {
  void startGameRound("splash");
});
rerollBtn?.addEventListener("click", () => {
  void startGameRound("reroll");
});
timeoutRetryBtn?.addEventListener("click", () => {
  setTimeoutState(false);
  void startGameRound("reroll");
});
snapBtn?.addEventListener("click", takePhoto);
saveBtn?.addEventListener("click", generateImage);
stopBtn?.addEventListener("click", stopCamera);
switchBtn?.addEventListener("click", () => {
  const nextFacing = currentFacing === "environment" ? "user" : "environment";
  void openCamera(nextFacing);
});
uploadFilesBtn?.addEventListener("click", () => {
  filePicker?.click();
});
filePicker?.addEventListener("change", () => {
  if (!filePicker.files || filePicker.files.length === 0) return;
  void handleSelectedFiles(Array.from(filePicker.files));
  filePicker.value = "";
});
waitingClose?.addEventListener("click", () => {
  setWaitingStatus("pending");
  clearResultImage();
  showWaitingPanel(false);
});
wsToggle?.addEventListener("click", () => {
  toggleWsBox();
});
wsClose?.addEventListener("click", () => {
  toggleWsBox(false);
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopCamera();
  }
});

updateSwitchLabel();

// WebSocket 접속 코드
const SOCKET_URL = "wss://9ad8ivmy7e.execute-api.ap-northeast-2.amazonaws.com/dev/";
const wsStatus = document.getElementById("ws-status");
const wsMessages = document.getElementById("ws-messages");
const wsCounter = document.getElementById("ws-counter");

type WsIndicatorState = "disconnected" | "connecting" | "connected";

function setWsIndicator(state: WsIndicatorState) {
  if (!wsStatus) return;
  wsStatus.classList.remove("is-connecting", "is-connected");
  if (state === "connecting") {
    wsStatus.classList.add("is-connecting");
    wsStatus.setAttribute("title", "WebSocket 상태: 연결 중 (지연 연결)");
  } else if (state === "connected") {
    wsStatus.classList.add("is-connected");
    wsStatus.setAttribute("title", "WebSocket 상태: 연결됨");
  } else {
    wsStatus.setAttribute("title", "WebSocket 상태: 미연결");
  }
}

type WsMessage = { text: string; timestamp: Date };
const wsMessageQueue: WsMessage[] = [];
const WS_MESSAGE_LIMIT = 10;

function renderWsMessages() {
  if (!wsMessages) return;
  wsMessages.innerHTML = "";
  if (wsMessageQueue.length === 0) {
    const emptyEl = document.createElement("div");
    emptyEl.className = "ws-box__empty";
    emptyEl.textContent = "아직 받은 메시지가 없습니다.";
    wsMessages.appendChild(emptyEl);
  } else {
    wsMessageQueue.forEach((message) => {
      const item = document.createElement("div");
      item.className = "ws-message";
      const timeEl = document.createElement("span");
      timeEl.className = "ws-message__time";
      timeEl.textContent = message.timestamp.toLocaleTimeString("ko-KR", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const textEl = document.createElement("div");
      textEl.textContent = message.text;
      item.appendChild(timeEl);
      item.appendChild(textEl);
      wsMessages.appendChild(item);
    });
  }
  if (wsCounter) {
    wsCounter.textContent = String(wsMessageQueue.length);
  }
}

function pushWsMessage(rawMessage: unknown) {
  const text =
    typeof rawMessage === "string"
      ? rawMessage
      : (() => {
          try {
            return JSON.stringify(rawMessage);
          } catch {
            return String(rawMessage);
          }
        })();
  wsMessageQueue.unshift({ text, timestamp: new Date() });
  if (wsMessageQueue.length > WS_MESSAGE_LIMIT) {
    wsMessageQueue.pop();
  }
  renderWsMessages();
}

function logConnectionId(message: unknown) {
  if (!message || typeof message !== "object") return;
  if ("connectionId" in message) {
    const connectionId = (message as { connectionId?: string }).connectionId;
    console.info("[WS] connectionId:", connectionId);
    (window as any).__connectionId = connectionId;
  }
}

function initWebSocket() {
  console.log("[WS] connecting to", SOCKET_URL);
  setWsIndicator("connecting");
  const socket = new WebSocket(SOCKET_URL);
  (window as any).__socket = socket;

  socket.addEventListener("open", () => {
    console.log("[WS] connected. readyState:", socket.readyState);
    setWsIndicator("connected");
    try {
      socket.send(JSON.stringify({ action: "ping" }));
    } catch (error) {
      console.warn("[WS] 초기 메시지 전송 실패:", error);
    }
  });

  socket.addEventListener("message", (event) => {
    console.log("[WS] message:", event.data);
    try {
      const parsed = JSON.parse(event.data);
      logConnectionId(parsed);
      handleWsPayload(parsed);
      pushWsMessage(parsed);
    } catch {
      pushWsMessage(event.data);
    }
  });

  socket.addEventListener("close", (event) => {
    console.log("[WS] closed", {
      code: event.code,
      reason: event.reason || "(no reason)",
      wasClean: event.wasClean,
      readyState: socket.readyState,
    });
    setWsIndicator("disconnected");
  });

  socket.addEventListener("error", (error) => {
    console.error("[WS] error:", error);
    setWsIndicator("disconnected");
  });

  setTimeout(() => {
    console.log("[WS] state after 2s:", socket.readyState);
  }, 2000);
  setTimeout(() => {
    console.log("[WS] state after 5s:", socket.readyState);
  }, 5000);
}


function getWebSocketConnectionId(): string | null {
  return (window as any).__connectionId || null;
}

async function fetchPresignedUrl(fileName: string, contentType?: string): Promise<string> {
  const url = new URL(PRESIGN_ENDPOINT);
  url.searchParams.set("fileName", fileName);
  url.searchParams.set("key", fileName);
  if (contentType) {
    url.searchParams.set("contentType", contentType);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("[presign] failed", response.status, text);
    throw new Error(`presign 요청 실패 (HTTP ${response.status})`);
  }

  const data = await response.json();
  console.log("[presign] request:", url.toString());
  console.log("[presign] response body:", data);
  const presignedUrl =
    data.presigned_url || data.uploadUrl || data.url || data.presignedUrl;
  if (!presignedUrl || typeof presignedUrl !== "string") {
    throw new Error("응답에서 presigned URL을 찾을 수 없습니다.");
  }
  console.log("[presign] presignedUrl:", presignedUrl);
  return presignedUrl;
}

function canvasToBlob(canvasEl: HTMLCanvasElement, type?: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvasEl.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("이미지 Blob 생성에 실패했습니다."));
          return;
        }
        resolve(blob);
      },
      type,
      quality
    );
  });
}

async function uploadToPresignedUrl(presignedUrl: string, blob: Blob, contentType: string) {
  // presigned URL은 그대로 사용하고, 헤더는 요청 시 서명에 포함된 값과 동일하게 유지
  const headers: Record<string, string> = { "Content-Type": contentType };
  const response = await fetch(presignedUrl, {
    method: "PUT",
    headers,
    body: blob,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("[upload] failed", response.status, text);
    throw new Error(`S3 업로드 실패 (HTTP ${response.status})`);
  }
}

async function uploadSingleFile(file: File, connectionId: string) {
  const safeName = sanitizeFileName(file.name);
  const fileName = `${connectionId}/${safeName}`;
  const contentType = file.type || "application/octet-stream";
  const presignedUrl = await fetchPresignedUrl(fileName, contentType);
  await uploadToPresignedUrl(presignedUrl, file, contentType);
  return extractS3Location(presignedUrl);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function handleSelectedFiles(files: File[]) {
  pendingFiles = files;
  await renderPreviewImages(
    await Promise.all(
      files.map(async (file) => ({
        src: await readFileAsDataUrl(file),
        alt: file.name,
      }))
    )
  );
  setPreviewMode(files.length > 0);
  hasCapture = files.length > 0;
  setButtonState();
  showWaitingPanel(false);
  clearWaitingTimeout();
  setWaitingStatus("pending");
  clearResultImage();
  resetWaitingCountdown();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error || new Error("파일 읽기 실패"));
    reader.readAsDataURL(file);
  });
}

async function uploadPendingFiles(connectionId: string, files: File[]): Promise<S3Location[]> {
  const locations: S3Location[] = [];
  for (const file of files) {
    const loc = await uploadSingleFile(file, connectionId);
    locations.push(loc);
  }
  return locations;
}

async function renderPreviewFromCanvas() {
  if (!canvas) return;
  const dataUrl = canvas.toDataURL(UPLOAD_TYPE, UPLOAD_QUALITY);
  await renderPreviewImages([{ src: dataUrl, alt: "capture" }]);
  setPreviewMode(true);
}

async function renderPreviewImages(items: { src: string; alt?: string }[]) {
  if (!previewGrid) return;
  previewGrid.innerHTML = "";
  if (items.length === 0) {
    previewGrid.classList.remove("is-visible");
    return;
  }
  items.forEach(({ src, alt }) => {
    const wrapper = document.createElement("div");
    wrapper.className = "preview-item";
    const img = document.createElement("img");
    img.src = src;
    img.alt = alt || "preview";
    wrapper.appendChild(img);
    previewGrid.appendChild(wrapper);
  });
  previewGrid.classList.add("is-visible");
}

function setPreviewMode(showPreviews: boolean) {
  if (!previewGrid) return;
  if (showPreviews) {
    previewGrid.classList.add("is-visible");
  } else {
    previewGrid.classList.remove("is-visible");
  }
}

function clearPendingFiles() {
  pendingFiles = [];
  renderPreviewImages([]);
  setPreviewMode(false);
}

async function drawLocalFallback(): Promise<boolean> {
  if (!canvas) return false;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  const img = new Image();
  img.src = LOCAL_FALLBACK_IMAGE;
  const loaded = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
  });
  if (!loaded) {
    alert("테스트용 이미지를 불러오지 못했습니다.");
    return false;
  }

  const { targetW, targetH } = resizeCanvasForSource(img.width, img.height);
  ctx.clearRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, targetW, targetH);
  await renderPreviewFromCanvas();
  return true;
}

function resizeCanvasForSource(srcW: number, srcH: number): { targetW: number; targetH: number } {
  if (!canvas) return { targetW: 0, targetH: 0 };
  const scale = Math.min(1, MAX_CANVAS_WIDTH / srcW);
  const targetW = Math.max(1, Math.round(srcW * scale));
  const targetH = Math.max(1, Math.round(srcH * scale));
  canvas.width = targetW;
  canvas.height = targetH;
  return { targetW, targetH };
}

function animateSendSuccess() {
  if (!canvas) return;
  createFlyingCopy(canvas);
  setTimeout(() => {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, 600);
}

function createFlyingCopy(source: HTMLCanvasElement) {
  const dataUrl = source.toDataURL(UPLOAD_TYPE, UPLOAD_QUALITY);
  const rect = source.getBoundingClientRect();
  const img = document.createElement("img");
  img.src = dataUrl;
  img.className = "send-fly";
  img.style.width = `${rect.width}px`;
  img.style.height = `${rect.height}px`;
  img.style.left = `${rect.left + window.scrollX}px`;
  img.style.top = `${rect.top + window.scrollY}px`;
  document.body.appendChild(img);
  img.addEventListener("animationend", () => {
    img.remove();
  });
}

function setUploading(isUploading: boolean) {
  if (!uploadOverlay) return;
  if (isUploading) {
    uploadOverlay.classList.add("is-active");
  } else {
    uploadOverlay.classList.remove("is-active");
  }
}

function showWaitingPanel(show: boolean) {
  if (!waitingPanel || !canvas) return;
  if (show) {
    waitingPanel.classList.add("is-active");
    canvas.classList.add("is-hidden");
    captureSlot?.classList.add("is-hidden");
  } else {
    waitingPanel.classList.remove("is-active");
    canvas.classList.remove("is-hidden");
    captureSlot?.classList.remove("is-hidden");
  }
}

function setWaitingStatus(status: "pending" | "done" | "failed") {
  if (!waitingPanel) return;
  const isDone = status === "done";
  const isFailed = status === "failed";
  waitingPanel.classList.toggle("is-done", isDone);
  waitingPanel.classList.toggle("is-failed", isFailed);
  if (waitingPulse) {
    waitingPulse.style.animationPlayState = isDone || isFailed ? "paused" : "running";
  }
  if (waitingImage) {
    waitingImage.style.display = isDone && waitingImage.src ? "block" : "none";
  }
  if (waitingClose) {
    waitingClose.style.display = isDone || isFailed ? "inline-flex" : "none";
  }
  if (waitingTimer) {
    waitingTimer.style.display = status === "pending" ? "block" : "none";
  }
  if (waitingTitle) {
    waitingTitle.textContent = isDone
      ? "처리 완료"
      : isFailed
        ? "처리 실패"
        : "서버 응답을 기다리는 중";
  }
  if (waitingDesc) {
    waitingDesc.textContent = isDone
      ? "이미지 처리가 완료되었습니다. 새로 촬영해보세요."
      : isFailed
        ? "응답 시간이 초과되었습니다. 다시 시도해주세요."
        : "이미지를 전송했습니다. 결과가 도착하면 이곳에 표시됩니다.";
  }
}

function handleWsPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return;
  const type = (payload as { type?: string }).type;
  if (type === "image_complete") {
    clearWaitingTimeout();
    resetWaitingCountdown();
    setWaitingStatus("done");
    const url = (payload as { downloadUrl?: string }).downloadUrl;
    if (url) {
      setResultImage(url);
    }
    showWaitingPanel(true);
  }
}

function startWaitingTimeout() {
  clearWaitingTimeout();
  resetWaitingCountdown();
  waitingTimeout = window.setTimeout(() => {
    setWaitingStatus("failed");
    showWaitingPanel(true);
  }, 60_000);
  waitingInterval = window.setInterval(() => {
    waitingRemaining -= 1;
    if (waitingRemaining <= 0) {
      waitingRemaining = 0;
      updateWaitingTimer();
      clearWaitingTimeout();
      setWaitingStatus("failed");
      showWaitingPanel(true);
    } else {
      updateWaitingTimer();
    }
  }, 1000);
}

function clearWaitingTimeout() {
  if (waitingTimeout !== null) {
    window.clearTimeout(waitingTimeout);
    waitingTimeout = null;
  }
  if (waitingInterval !== null) {
    window.clearInterval(waitingInterval);
    waitingInterval = null;
  }
}

function setResultImage(url: string) {
  if (!waitingImage) return;
  waitingImage.src = url;
  waitingImage.style.display = "block";
}

function clearResultImage() {
  if (!waitingImage) return;
  waitingImage.removeAttribute("src");
  waitingImage.style.display = "none";
}

function resetWaitingCountdown() {
  waitingRemaining = WAITING_TIMEOUT_SEC;
  updateWaitingTimer();
}

function updateWaitingTimer() {
  if (!waitingTimer) return;
  waitingTimer.textContent = `남은 시간 ${waitingRemaining}초 / 최대 ${WAITING_TIMEOUT_SEC}초`;
}

setButtonState();
toggleSplashScreen(true);
setWsIndicator("disconnected");
renderWsMessages();
initWebSocket();
resetGameFlow();
toggleWsBox(false);

function toggleWsBox(forceShow?: boolean) {
  if (!wsBox || !wsToggle) return;
  const willShow =
    typeof forceShow === "boolean" ? forceShow : wsBox.classList.contains("is-hidden");

  if (willShow) {
    wsBox.classList.remove("is-hidden");
    wsToggle.classList.add("is-hidden");
    wsToggle.setAttribute("aria-expanded", "true");
  } else {
    wsBox.classList.add("is-hidden");
    wsToggle.classList.remove("is-hidden");
    wsToggle.setAttribute("aria-expanded", "false");
  }
}

function extractS3Location(presignedUrl: string): S3Location {
  const url = new URL(presignedUrl);
  const hostParts = url.hostname.split(".");
  const bucket = hostParts[0] || "";
  const key = decodeURIComponent(url.pathname.replace(/^\//, ""));
  return { bucket, key };
}

async function startStepFunction(images: S3Location[]) {
  if (!images.length) return;
  const payload = images;
  const body = JSON.stringify({ input: payload });
  console.log("[stepfn] request body:", body);
  const response = await fetch(STEP_FUNCTION_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error("[stepfn] failed", response.status, text);
    throw new Error(`Step Functions 호출 실패 (HTTP ${response.status}): ${text || "(no body)"}`);
  }
}
