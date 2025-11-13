const video = document.getElementById("video") as HTMLVideoElement | null;
const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
const openBtn = document.getElementById("open") as HTMLButtonElement | null;
const snapBtn = document.getElementById("snap") as HTMLButtonElement | null;
const switchBtn = document.getElementById("switch") as HTMLButtonElement | null;
const saveBtn = document.getElementById("save") as HTMLButtonElement | null;
const stopBtn = document.getElementById("stop") as HTMLButtonElement | null;

let stream: MediaStream | null = null;
let hasCapture = false;
let currentFacing: "environment" | "user" = "environment";

function setButtonState() {
  const hasStream = Boolean(stream);
  if (snapBtn) snapBtn.disabled = !hasStream;
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

function takePhoto() {
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

function saveImage() {
  if (!canvas) return;

  canvas.toBlob(
    (blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `photo_${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    "image/jpeg",
    0.92,
  );
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
saveBtn?.addEventListener("click", saveImage);
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
