export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method === "GET") {
      return new Response(
        JSON.stringify({ status: "ok", message: "Obsidian Sanctuary API v3.32 is running" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    }

    try {
      if (!env.GROQ_API_KEY) {
        return new Response(
          JSON.stringify({ error: { message: "Thiếu biến bí mật GROQ_API_KEY trong Cloudflare Worker." } }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const body = await request.json();
      const rawPrompt =
        body?.contents?.[0]?.parts?.map((p) => p.text || "").join("\n") ||
        body?.prompt ||
        (Array.isArray(body?.messages)
          ? body.messages.map((m) => `${m.role || "user"}: ${m.content || ""}`).join("\n")
          : "");

      const userMessage = String(body?.userMessage || body?.message || "").trim();
      const promptText = userMessage
        ? `${rawPrompt}\n\nTIN NHẮN MỚI NHẤT TỪ NGƯỜI DÙNG: "${userMessage}"`
        : rawPrompt;

      if (!String(promptText).trim()) {
        return new Response(
          JSON.stringify({ error: { message: "Thiếu nội dung prompt gửi lên." } }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let selectedModel = body?.model || "llama-3.1-8b-instant";
      try {
        const modelsRes = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { "Authorization": `Bearer ${env.GROQ_API_KEY}` }
        });
        if (modelsRes.ok) {
          const modelsData = await modelsRes.json();
          const availableIds = (modelsData?.data || [])
            .map((m) => m.id)
            .filter((id) => !/whisper|guard|tts|audio/i.test(id));

          if (availableIds.length > 0 && !availableIds.includes(selectedModel)) {
            const preferred = [
              "llama-3.1-8b-instant",
              "llama-3.3-70b-versatile",
              "openai/gpt-oss-120b",
              "openai/gpt-oss-20b"
            ];
            selectedModel = preferred.find((p) => availableIds.includes(p)) || availableIds[0];
          }
        }
      } catch (_) {}

      const systemInstruction = [
        "Bạn là người bạn đồng hành tâm lý học đường gần gũi, chân thành, xưng hô nhất quán 'mình' (người nghe) và 'bạn' (người chia sẻ), tuyệt đối không nhắc tới AI, model, hệ thống hay thuật ngữ kỹ thuật.",
        "KIẾN TRÚC 2 LUỒNG TÁCH BIỆT — XỬ LÝ THEO THỨ TỰ ƯU TIÊN:",
        "1. LUỒNG 1 (ƯU TIÊN SỐ 1 - TÌNH HUỐNG TỰ HẠI / BẾ TẮC NGUY HIỂM): Đánh giá ngữ cảnh trước tiên. Nếu thuộc tình huống tự hại / tự làm tổn thương bản thân hoặc bế tắc nguy hiểm, đặt stream='luong_1_tu_hai', stage='Luồng 1: Tình huống tự hại (Ưu tiên)', high_risk=true (hoặc false nếu ngữ cảnh chưa tới mức cảnh báo đỏ theo đánh giá của bạn), kèm risk_note ngắn gọn nêu điểm tựa người lớn tin cậy hoặc Tổng đài 111 (miễn phí, 24/7). Biên chỉ số Luồng 1: mi ∈ [88, 100], emp ∈ [0, 12], sup ∈ [0, 12].",
        "2. LUỒNG 2 (KHUNG 7 GIAI ĐOẠN): Chỉ khi KHÔNG thuộc Luồng 1, đặt stream='luong_2_7_giai_doan' và chọn CHÍNH XÁC 1 bước kèm đúng biên chỉ số tương ứng:",
        "- 'Bước 1: Nhận diện tổn thương & căng thẳng ban đầu' -> mi: [80..100], emp: [0..15], sup: [0..10]",
        "- 'Bước 2: Nhận diện hành vi thao túng, nói xấu, cô lập & bắt nạt' -> mi: [65..79], emp: [16..30], sup: [11..24]",
        "- 'Bước 3: Nhận thức quyền và ranh giới cá nhân' -> mi: [50..64], emp: [31..48], sup: [25..40]",
        "- 'Bước 4: Tìm kiếm sự hỗ trợ an toàn' -> mi: [36..49], emp: [49..64], sup: [41..58]",
        "- 'Bước 5: Rèn luyện kỹ năng ứng phó & tự bảo vệ' -> mi: [22..35], emp: [65..78], sup: [59..74]",
        "- 'Bước 6: Củng cố sự tự tin & năng lực tự chủ' -> mi: [10..21], emp: [79..90], sup: [75..86]",
        "- 'Bước 7: Lan tỏa hành vi tích cực & hỗ trợ đồng đẳng an toàn' -> mi: [0..9], emp: [91..100], sup: [87..100]",
        "Tính toán nhất quán theo hệ số tiến triển nội bậc stage_progress ∈ [0.00, 1.00]: MI = round(MI_max - p*(MI_max-MI_min)), emp = round(emp_min + p*(emp_max-emp_min)), sup = round(sup_min + p*(sup_max-sup_min)).",
        "Trả về DUY NHẤT một đối tượng JSON hợp lệ với các khóa: stream, stage, stage_progress, mi, emp, sup, high_risk, risk_note, reply (4 đoạn ngăn cách bằng <br><br>)."
      ].join(" ");

      const upstreamRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: selectedModel,
          temperature: 0.5,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: promptText }
          ]
        })
      });

      const groqData = await upstreamRes.json();

      if (!upstreamRes.ok || groqData.error) {
        return new Response(
          JSON.stringify({
            error: {
              message: groqData?.error?.message || `Groq HTTP ${upstreamRes.status}`
            }
          }),
          {
            status: upstreamRes.status,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          }
        );
      }

      const replyText = groqData?.choices?.[0]?.message?.content || "";

      return new Response(
        JSON.stringify({
          model: selectedModel,
          candidates: [
            {
              content: {
                parts: [{ text: replyText }]
              }
            }
          ]
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    } catch (err) {
      return new Response(JSON.stringify({ error: { message: err.message } }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
