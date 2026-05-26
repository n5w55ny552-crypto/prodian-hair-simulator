// netlify/functions/simulate.js
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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
    const { staffCode, beforeImage, afterImage } = body;

    console.log("요청 수신 - 코드:", staffCode);
    console.log("OpenAI 키 존재:", !!OPENAI_API_KEY);

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

    console.log("GPT-4o로 분석 시작...");

    // Step 1: GPT-4o로 두 사진 동시 분석
    const analysisResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "첫 번째 사진의 사람 얼굴 특징(피부톤, 얼굴형, 눈, 코, 입 등)을 자세히 설명하고, 두 번째 사진의 헤어스타일(길이, 질감, 색상, 스타일)을 자세히 설명해줘. 영어로 답해줘." },
              { type: "image_url", image_url: { url: beforeImage } },
              { type: "image_url", image_url: { url: afterImage } },
            ]
          }
        ],
        max_tokens: 300
      })
    });

    const analysisData = await analysisResp.json();
    const description = analysisData.choices[0].message.content;
    console.log("분석 완료:", description.slice(0, 100));

    // Step 2: gpt-image-1로 이미지 생성
    const prompt = `A photorealistic portrait photo of a person with these exact facial features: ${description}. 
    The person should have the hairstyle from the second image description above. 
    Keep the face identical to the first image. Only change the hairstyle. 
    Natural lighting, high quality photo, realistic.`;

    console.log("이미지 생성 시작...");

    const generateResp = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: prompt,
        n: 1,
        size: "1024x1024",
        quality: "medium",
      }),
    });

    console.log("이미지 생성 응답 상태:", generateResp.status);
    const generateData = await generateResp.json();
    console.log("이미지 생성 결과:", JSON.stringify(generateData).slice(0, 300));

    if (!generateResp.ok) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: generateData.error?.message || "이미지 생성 오류" }) };
    }

    incrementUsage(staffCode);

    // gpt-image-1은 base64로 반환
    const imageBase64 = generateData.data[0].b64_json;
    const resultUrl = `data:image/png;base64,${imageBase64}`;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        resultUrl,
        staffName: staff.name,
        usedToday: used + 1,
        remainingToday: staff.dailyLimit - (used + 1),
      }),
    };

  } catch (err) {
    console.log("오류:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
