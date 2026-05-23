const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

// HTTP sunucusu — Render health check + uyku önleme pingleri için
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: httpServer });

// channelCode -> Set<ws>
const channels = new Map();

function broadcast(channel, message, exclude = null) {
  const members = channels.get(channel);
  if (!members) return;
  const data = JSON.stringify(message);
  for (const client of members) {
    if (client !== exclude && client.readyState === 1) {
      client.send(data);
    }
  }
}

wss.on('connection', (ws) => {
  ws.channelCode = null;
  ws.username = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'join': {
        const { code, username, intent } = msg;
        if (!code || !username) return;

        // 'join' niyetinde kanal yoksa hata döndür
        if (intent === 'join' && !channels.has(code)) {
          ws.send(JSON.stringify({ type: 'error', code: 'CHANNEL_NOT_FOUND' }));
          return;
        }

        if (!channels.has(code)) channels.set(code, new Set());
        const members = channels.get(code);

        const nameTaken = [...members].some(m => m.username === username);
        if (nameTaken) {
          ws.send(JSON.stringify({ type: 'error', code: 'USERNAME_TAKEN' }));
          return;
        }

        ws.channelCode = code;
        ws.username = username;

        const peers = [];
        for (const m of members) peers.push({ username: m.username });
        ws.send(JSON.stringify({ type: 'peers', peers }));

        members.add(ws);
        broadcast(code, { type: 'peer-joined', username }, ws);
        console.log(`[${code}] ${username} joined (${members.size} in channel)`);
        break;
      }

      case 'signal': {
        const { to, data } = msg;
        const members = channels.get(ws.channelCode);
        if (!members) return;
        for (const m of members) {
          if (m.username === to) {
            m.send(JSON.stringify({ type: 'signal', from: ws.username, data }));
            break;
          }
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    const { channelCode, username } = ws;
    if (!channelCode) return;

    const members = channels.get(channelCode);
    if (!members) return;

    members.delete(ws);
    console.log(`[${channelCode}] ${username} left (${members.size} remaining)`);

    if (members.size === 0) {
      channels.delete(channelCode);
      console.log(`[${channelCode}] Channel destroyed`);
    } else {
      broadcast(channelCode, { type: 'peer-left', username });
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`StorMIC signaling server running on port ${PORT}`);
});
