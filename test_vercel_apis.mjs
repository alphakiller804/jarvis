import "dotenv/config";
import statusHandler from "./api/status.ts";
import youtubeHandler from "./api/youtube.ts";
import chatHandler from "./api/chat.ts";
import memoryHandler from "./api/memory.ts";
import actionHandler from "./api/action.ts";

function createMockReqRes(method, body = {}, query = {}, headers = {}) {
  let statusCode = 200;
  let responseData = null;
  let headersSet = {};

  const req = {
    method,
    body,
    query,
    headers,
  };

  const res = {
    status(code) {
      statusCode = code;
      return res;
    },
    setHeader(name, val) {
      headersSet[name] = val;
      return res;
    },
    json(data) {
      responseData = data;
      return res;
    },
    end() {
      return res;
    },
    getStatusCode: () => statusCode,
    getData: () => responseData,
  };

  return { req, res };
}

async function runTests() {
  console.log("==================================================");
  console.log("       VERCEL SERVERLESS API TEST SUITE           ");
  console.log("==================================================");

  // 1. Test /api/status
  {
    const { req, res } = createMockReqRes("GET");
    await statusHandler(req, res);
    const data = res.getData();
    if (res.getStatusCode() === 200 && data.status === "ONLINE") {
      console.log("[OK] /api/status ->", data.status, "Environment:", data.environment);
    } else {
      throw new Error(`api/status failed: ${JSON.stringify(data)}`);
    }
  }

  // 2. Test /api/youtube
  {
    const { req, res } = createMockReqRes("GET", {}, { q: "Tumse Koi Pyara" });
    await youtubeHandler(req, res);
    const data = res.getData();
    if (res.getStatusCode() === 200 && data.success && data.videoId) {
      console.log(`[OK] /api/youtube -> Found videoId: ${data.videoId} (${data.url})`);
    } else {
      throw new Error(`api/youtube failed: ${JSON.stringify(data)}`);
    }
  }

  // 3. Test /api/memory
  {
    // GET
    const { req: getReq, res: getRes } = createMockReqRes("GET");
    await memoryHandler(getReq, getRes);
    const list = getRes.getData();
    if (list.success && list.preferences.length > 0) {
      console.log(`[OK] /api/memory GET -> ${list.preferences.length} default preferences loaded`);
    } else {
      throw new Error(`api/memory GET failed: ${JSON.stringify(list)}`);
    }

    // POST
    const { req: postReq, res: postRes } = createMockReqRes("POST", {
      key: "preferred_assistant_name",
      value: "JARVIS Production",
      category: "persona",
    });
    await memoryHandler(postReq, postRes);
    const postData = postRes.getData();
    if (postData.success) {
      console.log(`[OK] /api/memory POST -> Saved '${postData.key}'='${postData.value}'`);
    } else {
      throw new Error(`api/memory POST failed: ${JSON.stringify(postData)}`);
    }
  }

  // 4. Test /api/action
  {
    const { req, res } = createMockReqRes("POST", {
      tool: "play_youtube",
      args: { query: "Tumse Koi Pyara" },
    });
    await actionHandler(req, res);
    const data = res.getData();
    if (res.getStatusCode() === 200 && data.success) {
      console.log("[OK] /api/action ->", data.message);
    } else {
      throw new Error(`api/action failed: ${JSON.stringify(data)}`);
    }
  }

  // 5. Test /api/chat (End-to-End Gemini Intent Resolution)
  {
    const { req, res } = createMockReqRes("POST", {
      message: "YouTube par Tumse Koi Pyara song chalao",
    });
    await chatHandler(req, res);
    const data = res.getData();
    if (res.getStatusCode() === 200 && data.success) {
      console.log("[OK] /api/chat -> Gemini Response:", data.response);
      if (data.action) {
        console.log("     Action Dispatched:", data.action.tool, JSON.stringify(data.action.args));
      }
      if (data.media) {
        console.log("     Media Detected:", data.media.type, "videoId:", data.media.videoId);
      }
    } else {
      throw new Error(`api/chat failed: ${JSON.stringify(data)}`);
    }
  }

  console.log("==================================================");
  console.log("  ALL VERCEL SERVERLESS ENDPOINTS PASSED (100%)   ");
  console.log("==================================================");
}

runTests().catch((err) => {
  console.error("Test Suite Error:", err);
  process.exit(1);
});

