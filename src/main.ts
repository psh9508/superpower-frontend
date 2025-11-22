const video = document.getElementById("video") as HTMLVideoElement | null;
const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
const openBtn = document.getElementById("open") as HTMLButtonElement | null;
const snapBtn = document.getElementById("snap") as HTMLButtonElement | null;
const switchBtn = document.getElementById("switch") as HTMLButtonElement | null;
const saveBtn = document.getElementById("save") as HTMLButtonElement | null;
const stopBtn = document.getElementById("stop") as HTMLButtonElement | null;
const isLocalMode =
  ["localhost", "127.0.0.1", "::1"].includes(location.hostname) ||
  location.protocol === "file:";
const LOCAL_FALLBACK_IMAGE = "static/다운로드.jpg";
const PRESIGN_ENDPOINT = "https://jxvrngbw4b.execute-api.ap-northeast-2.amazonaws.com/Prod/get-input-url";
const UPLOAD_TYPE = "image/jpeg";
const UPLOAD_QUALITY = 0.92;
const UPLOAD_EXTENSION = "jpg";

let stream: MediaStream | null = null;
let hasCapture = false;
let currentFacing: "environment" | "user" = "environment";

function setButtonState() {
  const hasStream = Boolean(stream);
  const allowSnap = hasStream || isLocalMode;
  if (snapBtn) snapBtn.disabled = !allowSnap;
  if (stopBtn) stopBtn.disabled = !hasStream;
  if (switchBtn) switchBtn.disabled = !hasStream;
  if (saveBtn) saveBtn.disabled = !hasCapture;
  updateSwitchLabel();
  updateVideoTransform();
}

function updateSwitchLabel() {
  if (!switchBtn) return;
  switchBtn.textContent = currentFacing === "environment" ? "전면 전환" : "후면 전환";
}

function updateVideoTransform() {
  if (!video) return;
  const isFront = currentFacing === "user";
  video.style.transform = isFront ? "scaleX(-1)" : "scaleX(1)";
}

async function openCamera(facing: "environment" | "user" = currentFacing) {
  if (!video) return;
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    alert(`카메라 접근 실패: ${message}`);
    stream = null;
  } finally {
    setButtonState();
    updateVideoTransform();
  }
}

async function takePhoto() {
  if (isLocalMode) {
    const ok = await drawLocalFallback();
    if (ok) {
      hasCapture = true;
      setButtonState();
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

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const targetW = canvas.width;
  const targetH = canvas.height;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const vAspect = vw / vh;
  const cAspect = targetW / targetH;

  let sx = 0;
  let sy = 0;
  let sw = vw;
  let sh = vh;

  if (vAspect > cAspect) {
    sw = Math.floor(vh * cAspect);
    sx = Math.floor((vw - sw) / 2);
  } else if (vAspect < cAspect) {
    sh = Math.floor(vw / cAspect);
    sy = Math.floor((vh - sh) / 2);
  }

  ctx.save();
  if (currentFacing === "user") {
    ctx.scale(-1, 1);
    ctx.drawImage(video, sx, sy, sw, sh, -targetW, 0, targetW, targetH);
  } else {
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, targetW, targetH);
  }
  ctx.restore();
  hasCapture = true;
  setButtonState();
}

async function generateImage() {
  if (!hasCapture) {
    alert("이미지를 먼저 촬영해주세요.");
    return;
  }

  if (!canvas) {
    alert("캔버스가 준비되지 않았습니다.");
    return;
  }

  const connectionId = getWebSocketConnectionId();
  if (!connectionId) {
    alert('WebSocket connectionId를 찾을 수 없습니다.');
    return;
  }

  const fileName = `${connectionId}.${UPLOAD_EXTENSION}`;

  try {
    const presignedUrl = await fetchPresignedUrl(fileName, UPLOAD_TYPE);
    const blob = await canvasToBlob(canvas, UPLOAD_TYPE, UPLOAD_QUALITY);
    await uploadToPresignedUrl(presignedUrl, blob, UPLOAD_TYPE);
    alert("이미지를 업로드했습니다.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[upload] failed:", error);
    alert(`이미지 업로드 실패: ${message}`);
  }
}

function stopCamera() {
  if (!stream) return;
  stream.getTracks().forEach((track) => track.stop());
  stream = null;
  hasCapture = false;
  if (video) {
    video.srcObject = null;
    video.style.transform = "scaleX(1)";
  }
  setButtonState();
}

openBtn?.addEventListener("click", () => {
  void openCamera();
});
snapBtn?.addEventListener("click", takePhoto);
saveBtn?.addEventListener("click", generateImage);
stopBtn?.addEventListener("click", stopCamera);
switchBtn?.addEventListener("click", () => {
  const nextFacing = currentFacing === "environment" ? "user" : "environment";
  openCamera(nextFacing);
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

  const targetW = canvas.width;
  const targetH = canvas.height;
  const imgAspect = img.width / img.height;
  const canvasAspect = targetW / targetH;
  let drawW = targetW;
  let drawH = targetH;
  if (imgAspect > canvasAspect) {
    drawH = targetW / imgAspect;
  } else if (imgAspect < canvasAspect) {
    drawW = targetH * imgAspect;
  }
  const dx = (targetW - drawW) / 2;
  const dy = (targetH - drawH) / 2;

  ctx.clearRect(0, 0, targetW, targetH);
  ctx.drawImage(img, dx, dy, drawW, drawH);
  return true;
}

setButtonState();
setWsIndicator("disconnected");
renderWsMessages();
initWebSocket();
