const state = {
  roomId: "",
  userId: "",
  watchId: null,
  eventSource: null,
  markers: new Map(),
  participants: new Map(),
  deferredPrompt: null
};

const els = {
  name: document.querySelector("#name"),
  roomCode: document.querySelector("#room-code"),
  color: document.querySelector("#color"),
  status: document.querySelector("#status"),
  roomLabel: document.querySelector("#room-label"),
  participants: document.querySelector("#participants"),
  participantCount: document.querySelector("#participant-count"),
  joinBtn: document.querySelector("#join-btn"),
  stopBtn: document.querySelector("#stop-btn"),
  createRoomBtn: document.querySelector("#create-room-btn"),
  shareLinkBtn: document.querySelector("#share-link-btn"),
  fitBtn: document.querySelector("#fit-btn"),
  installBtn: document.querySelector("#install-btn"),
  networkStatus: document.querySelector("#network-status")
};

const palette = ["#1d4ed8", "#c2410c", "#0f766e", "#9333ea", "#ca8a04"];

const map = L.map("map", { zoomControl: true }).setView([37.5665, 126.978], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.style.color = isError ? "#b91c1c" : "";
}

function persistPreferences() {
  localStorage.setItem(
    "geo-share-preferences",
    JSON.stringify({
      name: els.name.value.trim(),
      color: els.color.value,
      roomCode: els.roomCode.value.trim().toUpperCase()
    })
  );
}

function restorePreferences() {
  try {
    const raw = localStorage.getItem("geo-share-preferences");
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.name) els.name.value = saved.name;
    if (saved.color) els.color.value = saved.color;
    if (saved.roomCode && !els.roomCode.value) {
      els.roomCode.value = saved.roomCode;
    }
  } catch (error) {
    console.error(error);
  }
}

function updateNetworkStatus() {
  const online = navigator.onLine;
  els.networkStatus.textContent = online ? "온라인 상태" : "오프라인 상태";
  els.networkStatus.style.background = online ? "rgba(194, 65, 12, 0.1)" : "rgba(185, 28, 28, 0.12)";
  els.networkStatus.style.color = online ? "#9a3412" : "#b91c1c";
}

function formatTime(isoString) {
  if (!isoString) return "위치 수신 대기 중";

  return new Date(isoString).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function createPopupContent(person) {
  return `
    <strong>${person.name}</strong><br />
    마지막 업데이트: ${formatTime(person.updatedAt)}<br />
    정확도: ${person.accuracy ? `${Math.round(person.accuracy)}m` : "알 수 없음"}
  `;
}

function updateMarker(person) {
  if (typeof person.latitude !== "number" || typeof person.longitude !== "number") return;

  let marker = state.markers.get(person.userId);
  if (!marker) {
    marker = L.circleMarker([person.latitude, person.longitude], {
      radius: 10,
      color: person.color,
      fillColor: person.color,
      fillOpacity: 0.85,
      weight: 3
    }).addTo(map);
    state.markers.set(person.userId, marker);
  }

  marker.setLatLng([person.latitude, person.longitude]);
  marker.setStyle({ color: person.color, fillColor: person.color });
  marker.bindPopup(createPopupContent(person));
}

function removeMarker(userId) {
  const marker = state.markers.get(userId);
  if (marker) {
    marker.remove();
    state.markers.delete(userId);
  }
}

function renderParticipants() {
  const items = Array.from(state.participants.values());
  els.participantCount.textContent = `${items.length}명`;

  if (!items.length) {
    els.participants.innerHTML = `<div class="empty-state">아직 참여자가 없습니다.</div>`;
    return;
  }

  els.participants.innerHTML = items
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .map((person) => {
      const coords =
        typeof person.latitude === "number" && typeof person.longitude === "number"
          ? `${person.latitude.toFixed(5)}, ${person.longitude.toFixed(5)}`
          : "위치 수신 대기";

      return `
        <article class="participant">
          <span class="swatch" style="background:${person.color}"></span>
          <div>
            <div class="participant-meta">
              <div>
                <strong>${person.name}${person.userId === state.userId ? " (나)" : ""}</strong>
                <small>${coords}</small>
              </div>
              <small>${formatTime(person.updatedAt)}</small>
            </div>
            <p>정확도: ${person.accuracy ? `${Math.round(person.accuracy)}m` : "알 수 없음"}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

function upsertParticipant(person) {
  state.participants.set(person.userId, person);
  updateMarker(person);
  renderParticipants();
}

function fitMapToParticipants() {
  const points = Array.from(state.participants.values())
    .filter((person) => typeof person.latitude === "number" && typeof person.longitude === "number")
    .map((person) => [person.latitude, person.longitude]);

  if (!points.length) return;
  map.fitBounds(points, { padding: [48, 48], maxZoom: 16 });
}

function connectStream(roomId) {
  if (state.eventSource) {
    state.eventSource.close();
  }

  state.eventSource = new EventSource(`/api/stream?roomId=${encodeURIComponent(roomId)}`);
  state.eventSource.addEventListener("snapshot", (event) => {
    const payload = JSON.parse(event.data);
    state.participants.clear();
    for (const marker of state.markers.values()) {
      marker.remove();
    }
    state.markers.clear();
    payload.participants.forEach(upsertParticipant);
    fitMapToParticipants();
  });

  state.eventSource.addEventListener("participant-joined", (event) => {
    upsertParticipant(JSON.parse(event.data));
  });

  state.eventSource.addEventListener("location-updated", (event) => {
    upsertParticipant(JSON.parse(event.data));
  });

  state.eventSource.addEventListener("participant-left", (event) => {
    const { userId } = JSON.parse(event.data);
    state.participants.delete(userId);
    removeMarker(userId);
    renderParticipants();
  });
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "요청 실패");
  }

  return data;
}

async function sendLocation(position) {
  const { latitude, longitude, accuracy } = position.coords;
  await postJson(`/api/rooms/${state.roomId}/location`, {
    userId: state.userId,
    latitude,
    longitude,
    accuracy
  });
}

function startWatchingLocation() {
  if (!navigator.geolocation) {
    setStatus("이 브라우저는 위치 공유를 지원하지 않습니다.", true);
    return;
  }

  state.watchId = navigator.geolocation.watchPosition(
    async (position) => {
      try {
        await sendLocation(position);
      } catch (error) {
        setStatus(error.message, true);
      }
    },
    (error) => {
      setStatus(`위치 권한이 필요합니다: ${error.message}`, true);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 10000
    }
  );
}

async function createRoom() {
  try {
    const { roomId } = await postJson("/api/rooms", {});
    els.roomCode.value = roomId;
    persistPreferences();
    setStatus(`새 방 ${roomId} 이(가) 준비되었습니다.`);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function joinRoom() {
  const roomId = els.roomCode.value.trim().toUpperCase();
  const name = els.name.value.trim() || "익명";
  const color = els.color.value || palette[Math.floor(Math.random() * palette.length)];

  if (!roomId) {
    setStatus("먼저 방 코드를 입력하거나 새 방을 만드세요.", true);
    return;
  }

  try {
    const joinResult = await postJson(`/api/rooms/${roomId}/join`, {
      userId: state.userId || undefined,
      name,
      color
    });

    state.roomId = roomId;
    state.userId = joinResult.user.userId;
    els.roomLabel.textContent = `방 코드: ${roomId}`;
    persistPreferences();
    connectStream(roomId);
    startWatchingLocation();
    els.joinBtn.disabled = true;
    els.stopBtn.disabled = false;
    setStatus("위치 공유가 시작되었습니다. 브라우저 위치 권한을 허용해 주세요.");

    const shareUrl = `${window.location.origin}?room=${encodeURIComponent(roomId)}`;
    history.replaceState({}, "", shareUrl);
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function stopSharing() {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }

  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }

  if (state.roomId && state.userId) {
    try {
      await postJson(`/api/rooms/${state.roomId}/leave`, {
        userId: state.userId
      });
    } catch (error) {
      console.error(error);
    }
  }

  state.participants.clear();
  for (const marker of state.markers.values()) {
    marker.remove();
  }
  state.markers.clear();
  renderParticipants();
  state.roomId = "";
  els.roomLabel.textContent = "방 코드: 없음";
  els.joinBtn.disabled = false;
  els.stopBtn.disabled = true;
  history.replaceState({}, "", window.location.pathname);
  setStatus("위치 공유를 중지했습니다.");
}

async function copyInviteLink() {
  const roomId = els.roomCode.value.trim().toUpperCase();
  if (!roomId) {
    setStatus("초대 링크를 만들려면 방 코드가 필요합니다.", true);
    return;
  }

  const shareUrl = `${window.location.origin}?room=${encodeURIComponent(roomId)}`;
  await navigator.clipboard.writeText(shareUrl);
  setStatus("초대 링크를 클립보드에 복사했습니다.");
}

async function installApp() {
  if (!state.deferredPrompt) return;

  state.deferredPrompt.prompt();
  const { outcome } = await state.deferredPrompt.userChoice;
  if (outcome === "accepted") {
    setStatus("홈화면 설치가 시작되었습니다.");
  }
  state.deferredPrompt = null;
  els.installBtn.hidden = true;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch (error) {
    console.error("Service worker registration failed", error);
  }
}

function bootstrapFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get("room");
  if (room) {
    els.roomCode.value = room.toUpperCase();
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.deferredPrompt = event;
  els.installBtn.hidden = false;
});

window.addEventListener("appinstalled", () => {
  state.deferredPrompt = null;
  els.installBtn.hidden = true;
  setStatus("앱이 홈화면에 설치되었습니다.");
});

window.addEventListener("online", updateNetworkStatus);
window.addEventListener("offline", updateNetworkStatus);

els.name.addEventListener("input", persistPreferences);
els.roomCode.addEventListener("input", persistPreferences);
els.color.addEventListener("input", persistPreferences);
els.createRoomBtn.addEventListener("click", createRoom);
els.joinBtn.addEventListener("click", joinRoom);
els.stopBtn.addEventListener("click", stopSharing);
els.fitBtn.addEventListener("click", fitMapToParticipants);
els.installBtn.addEventListener("click", () => {
  installApp().catch((error) => setStatus(error.message, true));
});
els.shareLinkBtn.addEventListener("click", () => {
  copyInviteLink().catch((error) => setStatus(error.message, true));
});

window.addEventListener("beforeunload", () => {
  if (state.roomId && state.userId) {
    navigator.sendBeacon(
      `/api/rooms/${state.roomId}/leave`,
      new Blob([JSON.stringify({ userId: state.userId })], { type: "application/json" })
    );
  }
});

renderParticipants();
bootstrapFromQuery();
restorePreferences();
updateNetworkStatus();
registerServiceWorker();
