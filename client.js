const compose = document.querySelector(".compose input");
const stat = document.querySelector(".status");
const url = new URLSearchParams(location.search).get("s") || location.hostname;
const ws = new WebSocket(`ws://${url}:3434`);
let buffers = {};
const id = Math.random();
let users = 0;
let unread = 0;

function coloredName(name) {
  let deg = 0;
  for (const c of name) deg = (223 * deg + c.charCodeAt(0)) % 360;
  deg = 110 + 0.85 * deg; // avoid ugly yellows
  const span = document.createElement("span");
  span.append(name);
  span.style.color = `oklch(75% 0.15 ${deg})`;
  return span;
}

oscs = {};
mods = {};
const ctx = new (window.AudioContext || window.webkitAudioContext)();
const flt = ctx.createBiquadFilter();
flt.type = "highshelf";
flt.frequency.value = 1200;
flt.gain.value = -10;
flt.connect(ctx.destination);
function beep(i, c) {
  const time = ctx.currentTime;
  oscs[i] = ctx.createOscillator();
  oscs[i].type = ["sawtooth", "triangle", "square", "sine"][i*999%4|0];
  const gain = ctx.createGain();
  gain.connect(flt);
  const freq = (i + 0.6) * 300 * (Math.random() * 0.15 + 1);
  const mul = c === '!' ? 1.4 : /\w/u.test(c) ? 1 : 0.6;
  oscs[i].frequency.setValueAtTime(freq*mul, time);
  oscs[i].connect(gain);
  oscs[i].start(time);

  if (oscs[i].type === "sine") {
  const modgain = ctx.createGain();
  modgain.gain.value = 800;
  mods[i] = ctx.createOscillator();
  modgain.connect(oscs[i].detune);
  mods[i].connect(modgain);
  mods[i].frequency.setValueAtTime(freq, time);
  mods[i].start(time); mods[i].stop(time + 0.09);
  }

  gain.gain.setValueAtTime(0.1, time);
  const decay = (c === '?' || c === '!') ? 0.05 : 0.03;
  gain.gain.linearRampToValueAtTime(0, time + decay);
  oscs[i].detune.setValueAtTime(0, time);
  if (c === '?') oscs[i].detune.linearRampToValueAtTime(600, ctx.currentTime + 0.03);
  if (c === '!') oscs[i].detune.linearRampToValueAtTime(-600, ctx.currentTime + 0.03);
  oscs[i].stop(time + 0.09);
}

ws.onopen = () => {
  stat.innerHTML = "Connected";
  stat.className = "status connected";
  ws.send(JSON.stringify({ login: id }));
};
ws.onclose = () => {
  stat.innerHTML = "Closed";
  stat.className = "status disconnected";
};
ws.onerror = () => {
  stat.innerHTML = "Error";
  stat.className = "status disconnected";
};
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log(msg);
  if (msg.submit) {
    const li = document.createElement("li");
    if (document.hidden) document.title = `(${++unread}) Typing room`;
    li.append("<", coloredName(msg.name), "> " + msg.text);
    document.querySelector(".message-list").appendChild(li);
    buffers[msg.id] = null;
    renderBuffers();
  } else if (msg.users) {
    document.querySelector(".user-count").innerText = msg.users === 1 ? "(nobody else here)" : `(${msg.users} users)`;
  } else if ("insert" in msg) {
    buffers[msg.id] ??= { id: msg.id, name: msg.name, start: msg.at+1, end: msg.at+1, text: "" };
    if (/\S/u.test(msg.insert)) beep(Math.max(0, Math.min(1, msg.id)), msg.insert);
    const old = buffers[msg.id].text;
    buffers[msg.id].text = old.slice(0, msg.at) + msg.insert + old.slice(msg.at);
    buffers[msg.id].start = msg.at + 1;
    buffers[msg.id].end = msg.at + 1;
    if (document.hidden && !document.title.includes("(")) document.title = `(*) Typing room`;
    renderBuffers();
  } else if ("text" in msg) {
    // beep(Math.max(0, Math.min(1, msg.id)));
    buffers[msg.id] = msg;
    if (document.hidden && !document.title.includes("(")) document.title = `(*) Typing room`;
    renderBuffers();
  } else if ("start" in msg) {
    const buffer = buffers[msg.id];
    if (buffer) { buffer.start = msg.start; buffer.end = msg.end; }
    renderBuffers();
  } else {
    console.warn("unrecognized", msg);
  }
};
function renderBuffers() {
  const presenceList = document.querySelector(".presence-list");
  const children = [];
  for (const msg of Object.values(buffers).sort()) {
    if (msg && msg.name && msg.text) {
      const start = msg.start;
      const end = msg.end;
      const li = document.createElement("li");
      li.append("<", coloredName(msg.name), "> " + msg.text.slice(0, start));
      const span = document.createElement("span");
      if (start === end) {
        span.innerText = msg.text.slice(start); span.className = "cursor";
        li.append(span);
      } else {
        span.innerText = msg.text.slice(start, end); span.className = "selected";
        const after = document.createElement("span");
        after.innerText = msg.text.slice(end);
        li.append(span, after);
      }
      children.push(li);
    }
  }
  presenceList.replaceChildren(...children);
  document.querySelector(".messages").scrollTo(0, 999999);
}
function changeName() {
  const name = document.querySelector(".name-input").value;
  localStorage.setItem("name", name);
  compose.disabled = name === "";
  send(false);
}

lastName = '';
lastText = '';
lastStart = 0;
lastEnd = 0;
function sendPos(start, end) {
  if (lastStart === start && lastEnd === end) return;
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ id, name, start, end }));
    lastStart = start; lastEnd = end;
  }
}
function send(submit) {
  if (ws.readyState === 1) {
    const name = document.querySelector(".name-input").value;
    const start = compose.selectionStart;
    const end = compose.selectionEnd;
    const text = compose.value;
    if (!submit && lastName === name && lastText === text && lastStart === start && lastEnd === end) return;
    if (start === end && !submit && text.slice(0, start-1) + text.slice(start) === lastText) {
      // this is an insertion
      const c = text[start-1];
      ws.send(JSON.stringify({ id, name, at: start-1, insert: c }));
      console.log("yeah!", text, c);
    } else {
      ws.send(JSON.stringify({ id, name, start, end, text, submit: text && submit }));
    }
    lastName = name;
    lastText = text;
    lastStart = start;
    lastEnd = end;
    if (text && submit) {
      compose.value = "";
      compose.focus();
    }
  }
}

compose.addEventListener("keyup", (e) => {
  sendPos(compose.selectionStart, compose.selectionEnd);
  if (e.key === "Enter") send(true);
});
compose.addEventListener("mouseup", (e) => {
  setTimeout(() => sendPos(compose.selectionStart, compose.selectionEnd), 50);
});
compose.addEventListener("input", (e) => {
  send(false);
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { unread = 0; document.title = "Typing room"; }
});