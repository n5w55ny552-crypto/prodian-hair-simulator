// netlify/functions/simulate.js
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN;

const STAFF_CODES = {
  "GUEST": { name: "일반고객", dailyLimit: 1 },
  "PROD-0001": { name: "직원1", dailyLimit: 8 },
  "PROD-0002": { name: "직원2", dailyLimit: 8 },
  "PROD-0003": { name: "직원3", dailyLimit: 8 },
  "PROD-0004": { name: "직원4", dailyLimit: 8 },
  "PROD-0005": { name: "직원5", dailyLimit: 8 },
  "PROD-0006": { name: "직원6", dailyLimit: 8 },
  "PROD-0007": { name: "직원7", dailyLimit: 8 },
  "PROD-0008": { name: "직원8", dailyLimit: 8 },
  "PROD-0009": { name: "직원9", dailyLimit: 8 },
  "PROD-0010": { name: "직원10", dailyLimit: 8 },
  "MASTER-9999": { name: "대표", dailyLimit: 99999 },
};

const usageLog = {};

function getTodayKey() {
  return new Date().toISOString().split("T")[0];
}

function getUsageCount(code) {
  const key = `${code}_${getTodayKey()}`;
  return usageLog[key] || 0;
}

function incrementUsage(code) {
  const key = `${code}_${getTodayKey()}`;
  usageLog[key] = (usageLog[key] || 0) + 1;
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { action, staffCode, beforeImage, afterImage, predictionId } = body;

    // 결과 조회
    if (action === "check") {
      if (!predictionId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "predictionId 없음" }) };
      }
      const resp = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: { Authorization: `Token ${REPLICATE_TOKEN}` },
      });
      const data = await resp.json();
      return { statusCode: 200, headers, body: JSON.stringify(data) };
    }

    // 시뮬레이션 시작
    if (action === "simulate") {
      if (!staffCode) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "코드를 입력해주세요" }) };
      }

      const staff = STAFF_CODES[staffCode.toUpperCase()];
      if (!staff) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: "유효하지 않은 코드입니다" }) };
      }

      const used = getUsageCount(staffCode);
      if (used >= staff.dailyLimit) {
        return {
          statusCode: 429,
          headers,
          body: JSON.stringify({ error: `오늘 사용 한도(${staff.dailyLimit}회)를 초과했습니다. 자정에 초기화됩니다.` }),
        };
      }

      if (!beforeImage || !afterImage) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "사진을 모두 업로드해주세요" }) };
      }

      // instant-id 최신 버전으로 호출
      const resp = await fetch("https://api.replicate.com/v1/predictions", {
        method: "POST",
        headers: {
          Authorization: `Token ${REPLICATE_TOKEN}`,
          "Content-Type": "application/json",
          "Prefer": "wait",
        },
        body: JSON.stringify({
          version: "f1ca369da43885a347690a98f6b710afbf5f167cb9bf13bd5af512ba4a9f7b63",
          input: {
            image: beforeImage,
            prompt: "a person with this hairstyle, natural photo, high quality, realistic",
            negative_prompt: "ugly, blurry, low quality, deformed",
            width: 640,
            height: 640,
            ip_adapter_scale: 0.8,
            controlnet_conditioning_scale: 0.8,
          },
        }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: data.detail || "Replicate API 오류" }) };
      }

      incrementUsage(staffCode);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          predictionId: data.id,
          staffName: staff.name,
          usedToday: used + 1,
          remainingToday: staff.dailyLimit - (used + 1),
        }),
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "잘못된 요청" }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
