const http = require('http');
const WebSocket = require('ws');

// Port server HTTP
const PORT = process.env.PORT || 10000;

// Dữ liệu hiện tại
let currentData = {
    phien_truoc: null,
    ket_qua: "",
    Dice: [],
    phien_hien_tai: null,
    du_doan: "",
    do_tin_cay: "N/A",
    cau: "",
    ngay: "",
    Id: "@ghetvietcode - Rinkivana"
};

// Lịch sử pattern T/X (dùng để tạo mẫu cầu và dự đoán)
let patternHistory = "";

function updatePatternHistory(result) {
    if (patternHistory.length >= 20) {
        patternHistory = patternHistory.slice(1);
    }
    patternHistory += result;
    currentData.cau = patternHistory;
}

function predictNextFromPattern(history) {
    if (history.length < 6) return "Chưa đủ dữ liệu";
    const lastChar = history[history.length - 1];
    const predicted = lastChar === 't' ? 'x' : 't';
    return predicted === 't' ? "Tài" : "Xỉu";
}

// Thông tin WebSocket
const WS_URL = "wss://websocket.atpman.net/websocket";
const HEADERS = {
    "Host": "websocket.atpman.net",
    "Origin": "https://play.789club.sx",
    "User-Agent": "Mozilla/5.0",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "vi-VN,vi;q=0.9",
    "Pragma": "no-cache",
    "Cache-Control": "no-cache"
};

let lastEventId = 19;

// Message đăng nhập + subscribe
const LOGIN_MESSAGE = [
    1, "MiniGame", "thatoidimoo11233", "112233",
    {
        info: JSON.stringify({
            ipAddress: "2405:4802:18c2:5990:3f0:c150:861d:5427",
            userId: "6ba5b041-a68d-4468-95d3-0bb2d8674512",
            username: "S8_thatoidimoo11233",
            timestamp: 1752497763866,
            refreshToken: "c6c49a4ff8ca49ac87fcaf2543a96221.6f17553681b74176a4ebeb77f475f443"
        }),
        signature: "5F953D843B438DD810A98D903AD3623CE98AED1745C3925EEAFD2A5BEB4D86A24ED0B97129E6AAB5DA1C3F73C2A236AE06D08EDDD937991260DFEA543E8F1C8818A651BDF4204E97A53F0461B306A95A6D7D56F435326270E9E4CB8084BB93969BFD4DB3CA8E519D079324E47110BCC23AB2139508D9E762407B76DE542D6E68"
    }
];

const SUBSCRIBE_TX_RESULT = [6, "MiniGame", "taixiuUnbalancedPlugin", { cmd: 2000 }];
const SUBSCRIBE_LOBBY = [6, "MiniGame", "lobbyPlugin", { cmd: 10001 }];

// Kết nối và xử lý WebSocket
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
        setInterval(() => ws.send(JSON.stringify(SUBSCRIBE_TX_RESULT)), 30000);
        setInterval(() => ws.send(JSON.stringify([7, "Simms", lastEventId, 0, { id: 0 }])), 15000);
    });

    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);

            if (Array.isArray(data)) {
                if (data[0] === 7 && data[1] === "Simms" && Number.isInteger(data[2])) {
                    lastEventId = data[2];
                }

                if (data[1]?.cmd === 2006) {
                    const { sid, d1, d2, d3 } = data[1];
                    const tong = d1 + d2 + d3;
                    const ketqua = tong >= 11 ? "Tài" : "Xỉu";
                    const diceArray = [d1, d2, d3];

                    currentData.phien_truoc = currentData.phien_hien_tai;
                    currentData.phien_hien_tai = sid;
                    currentData.Dice = diceArray;
                    currentData.ket_qua = ketqua;

                    const resultTX = ketqua === "Tài" ? 't' : 'x';
                    updatePatternHistory(resultTX);

                    const duDoan = predictNextFromPattern(patternHistory);
                    currentData.du_doan = duDoan;
                    currentData.ngay = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });

                    console.log("🎲", currentData);
                }
            }
        } catch (err) {
            console.error("❌ Lỗi message:", err.message);
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

// HTTP server có hỗ trợ CORS cho https://tooltxwanin.site
const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "https://tooltxwanin.site");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === "/taixiu") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(currentData));
    } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Không tìm thấy");
    }
});

// Khởi chạy server
server.listen(PORT, () => {
    console.log(`🌐 Server đang chạy tại http://localhost:${PORT}`);
    connectWebSocket();
});
