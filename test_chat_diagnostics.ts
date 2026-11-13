import "dotenv/config";
import chatHandler from "./api/chat.js";

interface TestResult {
  code: number;
  data: any;
}

async function callChat(msg: string): Promise<TestResult> {
  let result: TestResult = { code: 0, data: null };
  const req: any = {
    method: "POST",
    headers: {},
    body: {
      message: msg,
      agentUrl: "http://127.0.0.1:3001",
    },
    socket: { remoteAddress: "127.0.0.1" },
  };
  const res: any = {
    setHeader: () => {},
    status: (code: number) => ({
      json: (data: any) => {
        result = { code, data };
      },
    }),
  };
  await chatHandler(req, res);
  return result;
}

async function run() {
  console.log("=================================================");
  console.log("    JARVIS FULL-STACK API & INTENT DIAGNOSTICS   ");
  console.log("=================================================");

  let pass = 0;
  let fail = 0;

  function assert(name: string, ok: boolean, details?: string) {
    if (ok) {
      pass++;
      console.log(` [PASS] ${name}${details ? ` -> ${details}` : ""}`);
    } else {
      fail++;
      console.log(` [FAIL] ${name}${details ? ` -> ${details}` : ""}`);
    }
  }

  // 1. "Jarvis, computer band kar do."
  console.log("\n--- TEST 1: Roman Urdu Shutdown Intent & Confirmation ---");
  const r1 = await callChat("Jarvis, computer band kar do.");
  assert(
    "Shutdown intent asks for confirmation",
    r1.code === 200 &&
      r1.data.action?.requires_confirmation === true &&
      r1.data.response.includes("confirm shutdown"),
    r1.data.response
  );

  // 2. "cancel shutdown"
  console.log("\n--- TEST 2: Cancel Shutdown Intent ---");
  const r2 = await callChat("cancel shutdown");
  assert(
    "Cancel shutdown executes shutdown /a",
    r2.code === 200 &&
      r2.data.action?.args?.action === "cancel_shutdown" &&
      r2.data.response.includes("cancelled"),
    r2.data.response
  );

  // 3. "Jarvis, volume 50 percent karo."
  console.log("\n--- TEST 3: Volume Automation ---");
  const r3 = await callChat("Jarvis, volume 50 percent karo.");
  assert(
    "Volume set to 50%",
    r3.code === 200 &&
      r3.data.action?.tool === "system_control" &&
      r3.data.action?.args?.value === 50,
    r3.data.response
  );

  // 4. "Jarvis, open Chrome."
  console.log("\n--- TEST 4: Application Launch ---");
  const r4 = await callChat("Jarvis, open Chrome.");
  assert(
    "Launch Chrome detected",
    r4.code === 200 &&
      r4.data.action?.tool === "launch_application" &&
      r4.data.action?.args?.app_name === "Chrome",
    r4.data.response
  );

  // 5. "Jarvis, YouTube par song chalao."
  console.log("\n--- TEST 5: YouTube Media Playback ---");
  const r5 = await callChat("Jarvis, YouTube par Atif Aslam song chalao.");
  assert(
    "YouTube query and media resolved",
    r5.code === 200 &&
      (r5.data.action?.tool === "play_youtube" || r5.data.media?.type === "youtube"),
    r5.data.response
  );

  // 6. AI conversational query
  console.log("\n--- TEST 6: General AI Conversation ---");
  const r6 = await callChat("What is Python?");
  assert(
    "AI generates conversational response",
    r6.code === 200 &&
      typeof r6.data.response === "string" &&
      r6.data.response.length > 10,
    r6.data.response.slice(0, 80) + "..."
  );

  console.log("\n=================================================");
  console.log(` TOTAL: ${pass + fail} | PASSED: ${pass} | FAILED: ${fail}`);
  console.log("=================================================");

  if (fail > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

