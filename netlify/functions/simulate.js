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

    // base64에서 데이터 부분만 추출
    const beforeBase64 = beforeImage.replace(/^data:image\/\w+;base64,/, "");
    const afterBase64 = afterImage.replace(/^data:image\/\w+;base64,/, "");

    console.log("OpenAI API 호출 시작...");

    // Step 1: 레퍼런스 헤어스타일 분석
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
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${afterBase64}` }
              },
              {
                type: "text",
                text: "이 사진의 헤어스타일을 아주 구체적으로 영어로 설명해줘. 길이, 컬/직모 여부, 색상, 스타일링 방식 등을 포함해서 50단어 이내로."
              }
            ]
          }
        ],
        max_tokens: 150
      })
    });

    const analysisData = await analysisResp.json();
    const hairDescription = analysisData.choices[0].message.content;
    console.log("헤어스타일 분석:", hairDescription);

    // Step 2: DALL-E로 합성 이미지 생성
    const generateResp = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: (() => {
        const formData = new FormData();
        
        // base64를 Blob으로 변환
        const beforeBuffer = Buffer.from(beforeBase64, 'base64');
        const beforeBlob = new Blob([beforeBuffer], { type: 'image/png' });
        
        formData.append('image', beforeBlob, 'before.png');
        formData.append('prompt', `Change only the hairstyle of this person to: ${hairDescription}. Keep the face, skin tone, and everything else exactly the same. Only change the hair. Photorealistic, natural looking.`);
        formData.append('model', 'dall-e-2');
        formData.append('n', '1');
        formData.append('size', '512x512');
        
        return formData;
      })()
    });

    console.log("이미지 생성 응답 상태:", generateResp.status);
    const generateData = await generateResp.json();
    console.log("이미지 생성 결과:", JSON.stringify(generateData).slice(0, 200));

    if (!generateResp.ok) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: generateData.error?.message || "이미지 생성 오류" }) };
    }

    incrementUsage(staffCode);

    const resultUrl = generateData.data[0].url;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        resultUrl,
        staffName: staff.name,
        usedToday: used + 1,
        remainingToday: staff.dailyLimit - (used + 1),
        hairDescription,
      }),
    };

  } catch (err) {
    console.log("오류:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
