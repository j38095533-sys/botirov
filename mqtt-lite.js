// Мини-клиент MQTT 3.1.1 поверх WebSocket: подключиться, подписаться, прочитать сохранённое (retained), опубликовать.
// Полноценная библиотека весит ~340 КБ, а визитке нужно только это.
const enc = new TextEncoder(), dec = new TextDecoder();
const str = s => { const b = enc.encode(s); return [b.length >> 8, b.length & 255, ...b]; };
function pkt(head, body) {
  const v = []; let x = body.length;
  do { let d = x % 128; x = Math.floor(x / 128); if (x > 0) d |= 128; v.push(d); } while (x > 0);
  return new Uint8Array([head, ...v, ...body]);
}

// Возвращает объект сессии или null, если брокер не ответил за timeout мс.
export function mqttSession(url, { topic, onMessage, onClose, timeout = 6000 } = {}) {
  return new Promise(resolve => {
    let ws;
    try { ws = new WebSocket(url, 'mqtt'); } catch (e) { resolve(null); return; }
    ws.binaryType = 'arraybuffer';
    let buf = new Uint8Array(0), ready = false, ping = null;
    const api = {
      publish(t, payload, retain = true) {
        if (ws.readyState !== 1) return false;
        ws.send(pkt(0x30 | (retain ? 1 : 0), [...str(t), ...enc.encode(payload)]));
        return true;
      },
      alive: () => ws.readyState === 1,
      close() { clearInterval(ping); try { if (ws.readyState === 1) ws.send(new Uint8Array([0xe0, 0])); ws.close(); } catch (e) { /* уже закрыт */ } },
    };
    const timer = setTimeout(() => { if (!ready) { api.close(); resolve(null); } }, timeout);
    ws.onopen = () => {
      const id = 'bt' + Math.random().toString(16).slice(2, 12);
      ws.send(pkt(0x10, [...str('MQTT'), 4, 0x02, 0, 30, ...str(id)]));
    };
    ws.onmessage = e => {
      const d = new Uint8Array(e.data), nb = new Uint8Array(buf.length + d.length);
      nb.set(buf); nb.set(d, buf.length); buf = nb;
      for (;;) {
        if (buf.length < 2) return;
        let mult = 1, len = 0, i = 1, b;
        do { if (i >= buf.length) return; b = buf[i++]; len += (b & 127) * mult; mult *= 128; } while (b & 128);
        if (buf.length < i + len) return;
        const type = buf[0] >> 4, flags = buf[0] & 15, body = buf.slice(i, i + len);
        buf = buf.slice(i + len);
        if (type === 2) {                                   // CONNACK
          clearTimeout(timer);
          if (body[1] !== 0) { api.close(); resolve(null); return; }
          ready = true;
          if (topic) ws.send(pkt(0x82, [0, 1, ...str(topic), 0]));
          ping = setInterval(() => { if (ws.readyState === 1) ws.send(new Uint8Array([0xc0, 0])); }, 20000);
          resolve(api);
        } else if (type === 3) {                            // PUBLISH
          const tl = (body[0] << 8) | body[1];
          let off = 2 + tl;
          if ((flags >> 1) & 3) off += 2;
          onMessage?.(dec.decode(body.slice(2, 2 + tl)), dec.decode(body.slice(off)), !!(flags & 1));
        }
      }
    };
    ws.onerror = () => {};
    ws.onclose = () => { clearInterval(ping); if (!ready) { clearTimeout(timer); resolve(null); } else onClose?.(); };
  });
}

export const b64e = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
export const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
