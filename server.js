const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto'); // Cần cho thuật toán hash

// Port server HTTP
const PORT = process.env.PORT || 10000;

// Dữ liệu hiện tại để trả về API (không có chi tiết xúc xắc)
let currentData = {
    phien_truoc: null,
    ket_qua: "",
    phien_hien_tai: null,
    du_doan: "Chờ",
    do_tin_cay: "0%",
    cau: "",
    ngay: "",
    Id: "@ghetvietcode - Rinkivana",
    chi_tiet_du_doan: {} // Thêm chi tiết cho debug
};

// Lịch sử dữ liệu cho các thuật toán
let patternHistory = "";   // Chuỗi cầu T/X để hiển thị
let totalsHistory = [];    // Lịch sử tổng điểm các phiên (totals_list)
let kqHistory = [];        // Lịch sử kết quả Tài/Xỉu (kq_list)
let diceHistory = [];      // Lịch sử xúc xắc từng phiên (dice_list)


// =======================================================================
// ===== BỘ THUẬT TOÁN DỰ ĐOÁN MỚI (ĐÃ DỊCH SANG JAVASCRIPT) =====
// =======================================================================

// Hàm phụ trợ: Chuyển tổng điểm sang Tài/Xỉu
function getTaiXiu(total) {
    return (total >= 11 && total <= 18) ? "Tài" : "Xỉu";
}

// ===== THUẬT TOÁN 1: Phân tích cầu đặc biệt =====
function du_doan_v1(totals_list) {
    if (totals_list.length < 4) {
        return ["Chờ", "Đợi thêm dữ liệu để phân tích cầu."];
    }

    const last_4 = totals_list.slice(-4);
    const last_3 = totals_list.slice(-3);
    const last_total = totals_list.at(-1);
    const last_result = getTaiXiu(last_total);

    // Cầu đặc biệt A-B-A-A
    if (last_4[0] === last_4[2] && last_4[0] === last_4[3] && last_4[0] !== last_4[1]) {
        return ["Tài", `Cầu đặc biệt ${last_4.join('-')}. Bắt Tài theo công thức.`];
    }
    // Cầu sandwich A-B-A
    if (last_3[0] === last_3[2] && last_3[0] !== last_3[1]) {
        return [last_result === "Tài" ? "Xỉu" : "Tài", `Cầu sandwich ${last_3.join('-')}. Bẻ cầu!`];
    }
    // Mặc định bẻ cầu 1-1
    return [last_result === "Tài" ? "Xỉu" : "Tài", "Không có cầu đặc biệt, dự đoán theo cầu 1-1."];
}

// ===== THUẬT TOÁN 2: Phân tích với độ tin cậy =====
function du_doan_v2(totals_list) {
    if (totals_list.length < 4) {
        return ["Chờ", 0, "Chưa đủ dữ liệu để dự đoán."];
    }
    const last_4 = totals_list.slice(-4);
    const last_3 = totals_list.slice(-3);
    const last_6 = totals_list.slice(-6);
    const last_total = totals_list.at(-1);
    const last_result = getTaiXiu(last_total);
    
    // Cầu sandwich A-B-A
    if (last_3[0] === last_3[2] && last_3[0] !== last_3[1]) {
        return [last_result === "Tài" ? "Xỉu" : "Tài", 83, `Cầu sandwich ${last_3.join('-')}. Bẻ cầu!`];
    }
    // Cầu lặp lại
    if (last_3[0] === last_3[2] || last_3[1] === last_3[2]) {
        return [last_result === "Tài" ? "Xỉu" : "Tài", 77, `Cầu lặp dạng ${last_3.join('-')}. Bẻ cầu.`];
    }
    
    return [last_result === "Tài" ? "Xỉu" : "Tài", 71, "Không có cầu đặc biệt nào, bẻ cầu mặc định."];
}

// ===== THUẬT TOÁN 4: Phân tích đơn giản =====
function du_doan_v4(kq_list, tong_list) {
    if (kq_list.length < 3) return ["Chờ", 50];
    const tin_cay = 50;
    if (kq_list.slice(-3).join(',') === 'Tài,Tài,Tài') return ["Xỉu", Math.min(tin_cay + 20, 95)];
    if (kq_list.slice(-3).join(',') === 'Xỉu,Xỉu,Xỉu') return ["Tài", Math.min(tin_cay + 20, 95)];
    if (kq_list.slice(-2).join(',') === 'Tài,Xỉu') return ["Tài", Math.min(tin_cay + 10, 95)];
    if (tong_list.at(-1) >= 15) return ["Xỉu", Math.min(tin_cay + 10, 95)];
    if (tong_list.at(-1) <= 9) return ["Tài", Math.min(tin_cay + 10, 95)];
    return [kq_list.at(-1), tin_cay];
}

// ===== THUẬT TOÁN 5: Dự đoán theo hash =====
function du_doan_phan_tram(input_str) {
    const algo1 = parseInt(crypto.createHash('sha256').update(input_str).digest('hex'), 16) % 100;
    const algo2 = input_str.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 100;
    const algo3 = parseInt(crypto.createHash('sha1').update(input_str).digest('hex').slice(-2), 16) % 100;
    return parseFloat(((algo1 + algo2 + algo3) / 3).toFixed(2));
}

// ===== THUẬT TOÁN 6: Dự đoán theo xúc xắc =====
function du_doan_theo_xi_ngau(dice_list) {
    if (!dice_list.length) return "Đợi dữ liệu";
    const [d1, d2, d3] = dice_list.at(-1);
    const total = d1 + d2 + d3;
    const result_list = [d1, d2, d3].map(d => {
        let tmp = d + total;
        if (tmp === 4 || tmp === 5) tmp -= 4;
        else if (tmp >= 6) tmp -= 6;
        return tmp % 2 === 0 ? "Tài" : "Xỉu";
    });
    const tai_count = result_list.filter(r => r === "Tài").length;
    return tai_count >= 2 ? "Tài" : "Xỉu";
}


// ===== HÀM TỔNG HỢP DỰ ĐOÁN =====
function du_doan_tong_hop(totals_list, kq_list, dice_list, ma_phien) {
    if (totals_list.length < 1) {
        return { prediction: "Chờ", tincay: "0%", chi_tiet: {}, ket_luan: "Chưa có dữ liệu." };
    }

    const chi_tiet = {};
    
    const [du1, ly1] = du_doan_v1(totals_list);
    chi_tiet["v1"] = { du_doan: du1, ly_do: ly1 };

    const [du2, tin2, ly2] = du_doan_v2(totals_list);
    chi_tiet["v2"] = { du_doan: du2, tin_cay: `${tin2}%`, ly_do: ly2 };

    const [du4, tin4] = du_doan_v4(kq_list, totals_list);
    chi_tiet["v4"] = { du_doan: du4, tin_cay: `${tin4}%` };

    const tin5 = du_doan_phan_tram(ma_phien);
    chi_tiet["v5"] = { du_doan: tin5 >= 50 ? "Tài" : "Xỉu", tin_cay: `${tin5}%` };

    const du6 = du_doan_theo_xi_ngau(dice_list);
    chi_tiet["v6"] = { du_doan: du6 };
    
    // Tổng hợp kết quả từ các thuật toán đã chọn
    const all_du_doan = Object.values(chi_tiet).map(v => v.du_doan).filter(d => d === "Tài" || d === "Xỉu");
    const tai_count = all_du_doan.filter(d => d === "Tài").length;
    const xiu_count = all_du_doan.filter(d => d === "Xỉu").length;
    const total_algos = all_du_doan.length;

    let ket_luan = "";
    let final_prediction = "Chờ";
    let tincay = "0%";

    if (total_algos > 0) {
        if (tai_count > xiu_count) {
            final_prediction = "Tài";
            ket_luan = `🎯 Nên đánh: TÀI (${tai_count}/${total_algos} thuật toán)`;
            tincay = `${(tai_count / total_algos * 100).toFixed(1)}%`;
        } else if (xiu_count > tai_count) {
            final_prediction = "Xỉu";
            ket_luan = `🎯 Nên đánh: XỈU (${xiu_count}/${total_algos} thuật toán)`;
            tincay = `${(xiu_count / total_algos * 100).toFixed(1)}%`;
        } else {
            ket_luan = "⚖️ Tỉ lệ cân bằng, cân nhắc kỹ!";
            final_prediction = kq_list.at(-1) === "Tài" ? "Xỉu" : "Tài"; // Nếu cân bằng thì bẻ cầu
            tincay = "50.0%";
        }
    }

    return {
        prediction: final_prediction,
        tincay: tincay,
        chi_tiet: chi_tiet,
        ket_luan: ket_luan,
    };
}


// =================================================================
// ===== HỆ THỐNG SERVER VÀ WEBSOCKET (Không thay đổi nhiều) =====
// =================================================================

function updatePatternHistory(result) {
    if (patternHistory.length >= 20) {
        patternHistory = patternHistory.slice(1);
    }
    patternHistory += result;
    currentData.cau = patternHistory;
}

const WS_URL = "wss://websocket.atpman.net/websocket";
const HEADERS = {
    "Host": "websocket.atpman.net",
    "Origin": "https://play.789club.sx",
    "User-Agent": "Mozilla/5.0",
};
let lastEventId = 19;
const LOGIN_MESSAGE = [1,"MiniGame","thatoidimoo11233","112233",{info:'{"ipAddress":"2405:4802:18c2:5990:3f0:c150:861d:5427","userId":"6ba5b041-a68d-4468-95d3-0bb2d8674512","username":"S8_thatoidimoo11233","timestamp":1752497763866,"refreshToken":"c6c49a4ff8ca49ac87fcaf2543a96221.6f17553681b74176a4ebeb77f475f443"}',signature:"5F953D843B438DD810A98D903AD3623CE98AED1745C3925EEAFD2A5BEB4D86A24ED0B97129E6AAB5DA1C3F73C2A236AE06D08EDDD937991260DFEA543E8F1C8818A651BDF4204E97A53F0461B306A95A6D7D56F435326270E9E4CB8084BB93969BFD4DB3CA8E519D079324E47110BCC23AB2139508D9E762407B76DE542D6E68"}];
const SUBSCRIBE_TX_RESULT = [6, "MiniGame", "taixiuUnbalancedPlugin", { cmd: 2000 }];
const SUBSCRIBE_LOBBY = [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }];

function connectWebSocket() {
    const ws = new WebSocket(WS_URL, { headers: HEADERS });

    ws.on('open', () => {
        console.log("✅ Đã kết nối WebSocket");
        ws.send(JSON.stringify(LOGIN_MESSAGE));
        setTimeout(() => {
            ws.send(JSON.stringify(SUBSCRIBE_TX_RESULT));
            ws.send(JSON.stringify(SUBSCRIBE_LOBBY));
        }, 1000);
        setInterval(() => ws.send("2"), 10000);
    });

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            if (Array.isArray(data) && data[1]?.cmd === 2006) {
                const { sid, d1, d2, d3 } = data[1];
                const total = d1 + d2 + d3;
                const ketqua = getTaiXiu(total);

                // Cập nhật lịch sử cho các thuật toán
                totalsHistory.push(total);
                kqHistory.push(ketqua);
                diceHistory.push([d1, d2, d3]);

                // Giới hạn lịch sử để không tràn bộ nhớ
                if (totalsHistory.length > 50) {
                    totalsHistory.shift();
                    kqHistory.shift();
                    diceHistory.shift();
                }

                // Gọi hàm tổng hợp dự đoán
                const ma_phien = `PH_${sid}`;
                const predictionResult = du_doan_tong_hop(totalsHistory, kqHistory, diceHistory, ma_phien);

                // Cập nhật dữ liệu để trả về API
                currentData.phien_truoc = currentData.phien_hien_tai;
                currentData.phien_hien_tai = sid;
                currentData.ket_qua = ketqua;
                currentData.du_doan = predictionResult.prediction;
                currentData.do_tin_cay = predictionResult.tincay;
                currentData.chi_tiet_du_doan = predictionResult.ket_luan; // Gửi về lý do tóm tắt
                currentData.ngay = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
                
                updatePatternHistory(ketqua === "Tài" ? 'T' : 'X');

                console.log(`\n🎲 PHIÊN ${sid}: ${ketqua} (${total})`);
                console.log(`🎯 DỰ ĐOÁN: ${predictionResult.prediction} (Độ tin cậy: ${predictionResult.tincay})`);
                console.log(`📜 KẾT LUẬN: ${predictionResult.ket_luan}`);
            }
        } catch (err) {
            // Lỗi không quan trọng, bỏ qua
        }
    });

    ws.on('close', () => {
        console.log("🔌 WebSocket bị đóng. Kết nối lại sau 5s…");
        setTimeout(connectWebSocket, 5000);
    });

    ws.on('error', (err) => {
        console.error("❌ Lỗi WebSocket:", err.message);
    });
}

const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*"); // Cho phép mọi nguồn
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }
    if (req.url === "/taixiu") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(currentData));
    } else {
        res.writeHead(404);
        res.end("Not Found");
    }
});

server.listen(PORT, () => {
    console.log(`🌐 Server đang chạy tại http://localhost:${PORT}`);
    connectWebSocket();
});
