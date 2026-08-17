// OpenAI-compatible shim over the box's Claude Code CLI, running as a sidecar
// on the compose network. Backend/celery reach it at http://claude_shim:8788/v1
// (custom provider). No host firewall involved; no API key.
const http = require('http');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 8788;
const CLAUDE = process.env.CLAUDE_BIN || '/opt/cc/bin/claude.exe';
let chain = Promise.resolve(); // serialize CLI calls (campaigns are rate-limited)

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    execFile(
      CLAUDE,
      ['-p', prompt, '--output-format', 'text'],
      { timeout: 300000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(String(stderr || err.message).slice(0, 500)));
        resolve(String(stdout).trim());
      }
    );
  });
}

const server = http.createServer((req, res) => {
  const send = (code, obj) => {
    const b = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) });
    res.end(b);
  };

  if (req.method === 'GET' && /\/health$/.test(req.url)) {
    return send(200, { status: 'ok', backend: 'claude-cli' });
  }

  if (req.method === 'POST' && /\/chat\/completions$/.test(req.url)) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); } catch (e) { return send(400, { error: 'bad json' }); }
      const msgs = payload.messages || [];
      const prompt = msgs
        .map((m) => {
          let c = m.content;
          if (Array.isArray(c)) c = c.map((x) => (x && x.text) || '').join(' ');
          return m.role === 'user' ? c : `[${m.role}] ${c}`;
        })
        .filter(Boolean)
        .join('\n\n')
        .trim();
      if (!prompt) return send(400, { error: 'empty prompt' });

      chain = chain
        .then(() => runClaude(prompt))
        .then((text) =>
          send(200, {
            id: 'claudecli-' + Date.now(),
            object: 'chat.completion',
            model: payload.model || 'claude-cli',
            choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          })
        )
        .catch((e) => send(500, { error: String(e.message || e).slice(0, 500) }));
    });
    return;
  }

  send(404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => console.log('claude-shim listening on ' + PORT));
