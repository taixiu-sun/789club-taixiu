const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

// Port server HTTP
const PORT = process.env.PORT || 10000;

// Dữ liệu hiện tại để trả về API
let currentData = {
    phien_truoc: null,
    ket_qua: "",
    phien_hien_tai: null,
    du_doan: "Chờ",
    do_tin_cay: "0%",
    cau: "",
    ngay: "",
    Id: "@ghetvietcode - Rinkivana",
    chi_tiet_du_doan: {},
    trang_thai: "Đang kết nối..."
};

// Lịch sử dữ liệu cho các thuật toán
let patternHistory = "";
let totalsHistory = [];
let kqHistory = [];
let diceHistory = [];

// Biến quản lý kết nối
let ws = null;
let reconnectAttempts = 0;
let maxReconnectAttempts = 10;
let isConnected = false;
let heartbeatInterval = null;
let reconnectTimeout = null;

// Hàm phụ trợ: Chuyển tổng điểm sang Tài/Xỉu
function getTaiXiu(total) {
    return (total >= 11 && total <= 18) ? "Tài" : "Xỉu";
}

// ===== CÁC THUẬT TOÁN DỰ ĐOÁN =====
function du_doan_v1(totals_list) {
    if (totals_list.length < 4) {
        return ["Chờ", "Đợi thêm dữ liệu để phân tích cầu."];
    }
    const last_4_tx = totals_list.slice(-4).map(getTaiXiu);
    const last_3_tx = totals_list.slice(-3).map(getTaiXiu);
    const last_result = last_3_tx.at(-1);

    // Cầu đặc biệt A-B-A-A
    if (last_4_tx[0] === last_4_tx[2] && last_4_tx[0] === last_4_tx[3] && last_4_tx[0] !== last_4_tx[1]) {
        return [last_4_tx[0], `Cầu đặc biệt ${last_4_tx.join('-')}. Bắt theo cầu.`];
    }
    // Cầu sandwich A-B-A
    if (last_3_tx[0] === last_3_tx[2] && last_3_tx[0] !== last_3_tx[1]) {
        return [last_3_tx[1], `Cầu sandwich ${last_3_tx.join('-')}. Theo cầu!`];
    }
    // Mặc định bẻ cầu 1-1
    return [last_result === "Tài" ? "Xỉu" : "Tài", "Không có cầu đặc biệt, dự đoán bẻ cầu 1-1."];
}

function du_doan_v2(totals_list) {
    if (totals_list.length < 4) {
        return ["Chờ", 0, "Chưa đủ dữ liệu để dự đoán."];
    }
    const last_3_tx = totals_list.slice(-3).map(getTaiXiu);
    const last_result = last_3_tx.at(-1);

    // Cầu sandwich A-B-A
    if (last_3_tx[0] === last_3_tx[2] && last_3_tx[0] !== last_3_tx[1]) {
        return [last_result === "Tài" ? "Xỉu" : "Tài", 83, `Cầu sandwich ${last_3_tx.join('-')}. Bẻ cầu!`];
    }
    // Cầu lặp lại
    if (last_3_tx[0] === last_3_tx[2] || last_3_tx[1] === last_3_tx[2]) {
        return [last_result === "Tài" ? "Xỉu" : "Tài", 77, `Cầu lặp dạng ${last_3_tx.join('-')}. Bẻ cầu.`];
    }
    return [last_result === "Tài" ? "Xỉu" : "Tài", 71, "Không có cầu đặc biệt nào, bẻ cầu mặc định."];
}

function du_doan_v4(kq_list, tong_list) {
    if (kq_list.length < 3) return ["Chờ", 50];
    const tin_cay = 50;
    if (kq_list.slice(-3).join(',') === 'Tài,Tài,Tài') return ["Xỉu", Math.min(tin_cay + 20, 95)];
    if (kq_list.slice(-3).join(',') === 'Xỉu,Xỉu,Xỉu') return ["Tài", Math.min(tin_cay + 20, 95)];
    if (kq_list.slice(-2).join(',') === 'Tài,Xỉu') return ["Tài", Math.min(tin_cay + 10, 95)];
    if (tong_list.at(-1) >= 15) return ["Xỉu", Math.min(tin_cay + 10, 95)];
    if (tong_list.at(-1) <= 9) return ["Tài", Math.min(tin_cay + 10, 95)];
    return [kq_list.at(-1) === "Tài" ? "Xỉu" : "Tài", tin_cay];
}

function du_doan_phan_tram(input_str) {
    const algo1 = parseInt(crypto.createHash('sha256').update(input_str).digest('hex'), 16) % 100;
    const algo2 = input_str.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 100;
    const algo3 = parseInt(crypto.createHash('sha1').update(input_str).digest('hex').slice(-2), 16) % 100;
    return parseFloat(((algo1 + algo2 + algo3) / 3).toFixed(2));
}

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
            final_prediction = kq_list.at(-1) === "Tài" ? "Xỉu" : "Tài";
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

function updatePatternHistory(result) {
    if (patternHistory.length >= 20) {
        patternHistory = patternHistory.slice(1);
    }
    patternHistory += result;
    currentData.cau = patternHistory;
}

// ===== CẢI THIỆN KẾT NỐI WEBSOCKET =====
function clearIntervals() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    heartbeatInterval = null;
    reconnectTimeout = null;
}

function startHeartbeat() {
    clearIntervals();
    heartbeatInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send("2"); // Ping message
            console.log("💓 Heartbeat sent");
        }
    }, 30000);
}

function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log("🔄 WebSocket đã kết nối, bỏ qua kết nối mới");
        return;
    }

    clearIntervals();

    const WS_URL = "wss://websocket.atpman.net/websocket";
    const HEADERS = {
        "Host": "websocket.atpman.net",
        "Origin": "[https://play.789club.sx](https://play.789club.sx)",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    };

    console.log(`🔄 Đang kết nối WebSocket... (Lần thử: ${reconnectAttempts + 1})`);
    currentData.trang_thai = `Đang kết nối (${reconnectAttempts + 1}/${maxReconnectAttempts})`;

    ws = new WebSocket(WS_URL, {
        headers: HEADERS,
        handshakeTimeout: 10000,
    });

    const connectionTimeout = setTimeout(() => {
        if (ws && ws.readyState === WebSocket.CONNECTING) {
            console.log("⏱️ Timeout kết nối WebSocket");
            ws.terminate();
        }
    }, 15000);

    ws.on('open', () => {
        clearTimeout(connectionTimeout);
        console.log("✅ Đã kết nối WebSocket thành công!");
        isConnected = true;
        reconnectAttempts = 0;
        currentData.trang_thai = "Đã kết nối";

        const LOGIN_MESSAGE = [1, "MiniGame", "thatoidimoo11233", "112233", { info: '{"ipAddress":"2405:4802:18c2:5990:3f0:c150:861d:5427","userId":"6ba5b041-a68d-4468-95d3-0bb2d8674512","username":"S8_thatoidimoo11233","timestamp":1752497763866,"refreshToken":"c6c49a4ff8ca49ac87fcaf2543a96221.6f17553681b74176a4ebeb77f475f443"}', signature: "5F953D843B438DD810A98D903AD3623CE98AED1745C3925EEAFD2A5BEB4D86A24ED0B97129E6AAB5DA1C3F73C2A236AE06D08EDDD937991260DFEA543E8F1C8818A651BDF4204E97A53F0461B306A95A6D7D56F435326270E9E4CB8084BB93969BFD4DB3CA8E519D079324E47110BCC23AB2139508D9E762407B76DE542D6E68" }];
        const SUBSCRIBE_TX_RESULT = [6, "MiniGame", "taixiuUnbalancedPlugin", { cmd: 2000 }];
        const SUBSCRIBE_LOBBY = [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }];

        ws.send(JSON.stringify(LOGIN_MESSAGE));
        setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(SUBSCRIBE_TX_RESULT));
                ws.send(JSON.stringify(SUBSCRIBE_LOBBY));
                console.log("📡 Đã gửi các message đăng ký");
            }
        }, 2000);

        startHeartbeat();
    });

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);
            if (Array.isArray(data) && data[1]?.cmd === 2006) {
                const { sid, d1, d2, d3 } = data[1];
                const total = d1 + d2 + d3;
                const ketqua = getTaiXiu(total);

                totalsHistory.push(total);
                kqHistory.push(ketqua);
                diceHistory.push([d1, d2, d3]);

                if (totalsHistory.length > 50) {
                    totalsHistory.shift();
                    kqHistory.shift();
                    diceHistory.shift();
                }

                const ma_phien = `PH_${sid}`;
                const predictionResult = du_doan_tong_hop(totalsHistory, kqHistory, diceHistory, ma_phien);

                currentData.phien_truoc = currentData.phien_hien_tai;
                currentData.phien_hien_tai = sid;
                currentData.ket_qua = `${ketqua} (${total})`;
                currentData.du_doan = predictionResult.prediction;
                currentData.do_tin_cay = predictionResult.tincay;
                currentData.chi_tiet_du_doan = predictionResult.ket_luan;
                currentData.ngay = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
                currentData.trang_thai = "Đang hoạt động";

                updatePatternHistory(ketqua === "Tài" ? 'T' : 'X');

                console.log(`\n🎲 PHIÊN ${sid}: ${ketqua} (${d1}-${d2}-${d3} = ${total})`);
                console.log(`🎯 DỰ ĐOÁN: ${predictionResult.prediction} (${predictionResult.tincay})`);
                console.log(`📜 KẾT LUẬN: ${predictionResult.ket_luan}`);
                console.log(`📊 Cầu hiện tại: ${patternHistory}`);
            }

            if (msg.toString() === "3") {
                console.log("💚 Nhận pong từ server");
            }

        } catch (err) {
            if (msg.toString().length < 50) {
                console.log(`📨 Raw message: ${msg.toString()}`);
            }
        }
    });

    ws.on('close', (code, reason) => {
        clearTimeout(connectionTimeout);
        clearIntervals();
        isConnected = false;

        console.log(`🔌 WebSocket đã đóng. Code: ${code}, Reason: ${reason}`);
        currentData.trang_thai = `Mất kết nối (${code})`;

        if (reconnectAttempts < maxReconnectAttempts) {
            reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
            console.log(`🔄 Kết nối lại sau ${delay / 1000}s... (Lần thử: ${reconnectAttempts}/${maxReconnectAttempts})`);

            reconnectTimeout = setTimeout(() => {
                connectWebSocket();
            }, delay);
        } else {
            console.log(`❌ Đã thử kết nối lại ${maxReconnectAttempts} lần, dừng lại.`);
            currentData.trang_thai = "Lỗi kết nối";
        }
    });

    ws.on('error', (err) => {
        clearTimeout(connectionTimeout);
        console.error("❌ Lỗi WebSocket:", err.message);
        currentData.trang_thai = `Lỗi: ${err.message}`;
        if (ws) ws.terminate();
    });

    ws.on('pong', () => {
        console.log("💚 Nhận pong heartbeat");
    });
} // <--- SỬA LỖI: Dấu } được di chuyển xuống đây để bao bọc toàn bộ logic WebSocket

// ===== HTTP SERVER =====
const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === "/taixiu" || req.url === "/") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(currentData, null, 2));
    } else if (req.url === "/status") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
            status: isConnected ? "connected" : "disconnected",
            reconnectAttempts: reconnectAttempts,
            dataCount: totalsHistory.length,
            lastUpdate: currentData.ngay
        }));
    } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 Not Found");
    }
});

server.listen(PORT, () => {
    console.log(`🌐 Server đang chạy tại http://localhost:${PORT}`);
    console.log(`📊 API endpoint: http://localhost:${PORT}/taixiu`);
    console.log(`🔍 Status endpoint: http://localhost:${PORT}/status`);

    connectWebSocket(); // Bắt đầu kết nối WebSocket

    setInterval(() => {
        if (!isConnected && reconnectAttempts < maxReconnectAttempts) {
            console.log("🔄 Kiểm tra kết nối định kỳ...");
            connectWebSocket();
        }
    }, 60000); // Kiểm tra mỗi 60 giây
});

// Xử lý tín hiệu thoát
process.on('SIGINT', () => {
    console.log('\n🛑 Đang thoát server…');
    clearIntervals();
    if (ws) ws.close();
    server.close(() => {
        console.log('✅ Server đã thoát');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Nhận SIGTERM, đang thoát…');
    clearIntervals();
    if (ws) ws.close();
    server.close(() => {
        process.exit(0);
    });
});
