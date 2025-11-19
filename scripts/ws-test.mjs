#!/usr/bin/env node
import process from "node:process";
import WebSocket from "ws";

const DEFAULT_URL = "wss://4l94wm5wo8.execute-api.ap-northeast-2.amazonaws.com/dev";

const args = parseArgs(process.argv);

if (args.help || args.h) {
  printHelp();
  process.exit(0);
}

const url = args.url ?? args.u ?? process.env.WS_URL ?? DEFAULT_URL;
const rawPayload =
  args.data ??
  args.d ??
  args.message ??
  args.m ??
  ("payload" in args ? args.payload : undefined) ??
  process.env.WS_PAYLOAD;
const autoCloseMs =
  "noClose" in args || "no-close" in args
    ? null
    : args.close
      ? Number(args.close)
      : 10000;
const handshakeTimeout = args.timeout ? Number(args.timeout) : 5000;
const stringifyJson = "json" in args || args.json === "true";

if (!url || !url.startsWith("ws")) {
  console.error("[ws-test] 유효한 ws:// 또는 wss:// URL 을 전달해주세요.");
  process.exit(1);
}

console.log("[ws-test] connecting...", { url, handshakeTimeout });

const socket = new WebSocket(url, { handshakeTimeout });

socket.on("open", () => {
  console.log("[ws-test] connected. readyState =", socket.readyState);
  if (rawPayload) {
    let payloadToSend = rawPayload;
    if (stringifyJson) {
      try {
        payloadToSend = JSON.stringify(JSON.parse(rawPayload));
      } catch (error) {
        console.warn("[ws-test] --json 플래그가 있지만 JSON 파싱 실패, 원문을 그대로 전송합니다.", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    console.log("[ws-test] sending payload:", payloadToSend);
    socket.send(payloadToSend);
  }
});

socket.on("message", (data) => {
  const text = typeof data === "string" ? data : data.toString("utf8");
  console.log("[ws-test] message:", text);
});

socket.on("close", (code, reason) => {
  console.log("[ws-test] closed", { code, reason: reason.toString() });
  process.exit(0);
});

socket.on("error", (error) => {
  console.error("[ws-test] error:", error);
});

if (autoCloseMs) {
  setTimeout(() => {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      console.log(`[ws-test] auto closing after ${autoCloseMs}ms`);
      socket.close();
    }
  }, autoCloseMs).unref();
}

function parseArgs(argv) {
  const acc = {};
  for (let i = 2; i < argv.length; i++) {
    const current = argv[i];
    if (!current.startsWith("-")) continue;
    let key = null;
    if (current.startsWith("--")) {
      key = current.slice(2);
    } else if (current.startsWith("-") && current.length === 2) {
      key = current.slice(1);
    }
    if (!key) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith("-")) {
      acc[key] = next;
      i += 1;
    } else {
      acc[key] = true;
    }
  }
  return acc;
}

function printHelp() {
  console.log(`Usage:
  node scripts/ws-test.mjs [--url wss://example] [--message '{"action":"ping"}'] [--json]

Flags:
  --url, -u        연결할 WebSocket 주소 (기본값: ${DEFAULT_URL})
  --message, --data, -m, -d
                   전송할 문자열 (기본: 전송 안 함)
  --json           메시지를 JSON.parse 한 뒤 다시 stringify 해서 전송
  --close <ms>     지정 시간(ms) 후 자동 종료 (기본: 10000)
  --no-close       자동 종료 비활성화
  --timeout <ms>   WebSocket 핸드셰이크 타임아웃 (기본: 5000)
  --help           도움말 표시

환경 변수:
  WS_URL           --url 과 동일
  WS_PAYLOAD       --message 와 동일
`);
}
