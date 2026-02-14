/* script.js */

// ===============================
// DOM REFERENCES
// ===============================
const viewport = document.getElementById("viewport");
const radar = document.getElementById("radar");
const sweep = document.getElementById("sweep");
const ringsContainer = document.getElementById("rings");
const terminalOutput = document.getElementById("terminal-output");
const radarStats = document.getElementById("radar-stats");

// ===============================
// TERMINAL & PLANE SELECTION
// ===============================
let planeList = [];
let selectedPlaneIndex = 0;
let typingTimeout = null;

// ===============================
// WORLD BOUNDS
// ===============================
const WORLD_MIN_X = -60000;
const WORLD_MAX_X = 60000;
const WORLD_MIN_Y = -60000;
const WORLD_MAX_Y = 60000;

const RADAR_SIZE = 1024;

// ===============================
// ZOOM + PAN STATE
// ===============================
let scale = 1;
let translateX = 0;
let translateY = 0;

let cameraTarget = { x: 0, y: 0 };

// ===============================
// RADAR ENGINE STATE
// ===============================
let planeElements = {};
let liveData = {};
let planeAngles = {};
let sweepAngle = -110;

let SWEEP_DURATION = 10000;
const BEAM_WIDTH = 4;
const SWEEP_OFFSET = 75;
let PING_ALIVE_TIME = 0.005;

let lastTime = performance.now();
let lastDetection = 0;

// ===============================
// FETCH DATA
// ===============================

async function fetchPlanes() {
  const response = await fetch("/api/planes");
  return await response.json();
}

function computePlaneAngles() {
  planeAngles = {};

  Object.entries(liveData).forEach(([flightName, data]) => {
    if (!data?.position) return;

    const { x, y } = data.position;
    const { screenX, screenY } = worldToScreen(x, y);

    planeAngles[flightName] = {
      screenX,
      screenY,
      angle: getAngleFromCenter(screenX, screenY),
      data
    };
  });
}

async function updateRadarData() {
  try {
    liveData = await fetchPlanes();
    computePlaneAngles();

    const newPlaneList = Object.keys(liveData).sort();
    const currentFlight = planeList[selectedPlaneIndex];

    planeList = newPlaneList;

    if (planeList.length === 0) {
      selectedPlaneIndex = 0;
      terminalOutput.textContent = "No planes detected";
      cleanupDeadPlanes();
      return;
    }

    const index = planeList.indexOf(currentFlight);
    selectedPlaneIndex = index >= 0 ? index : 0;

    cleanupDeadPlanes();
    highlightSelectedPlane();
    updateRadarStats();

  } catch (err) {
    console.error(err);
  }
}

setInterval(updateRadarData, 5000);
updateRadarData();

// ===============================
// WORLD → SCREEN
// ===============================
function worldToScreen(x, y) {
  const screenX =
    ((x - WORLD_MIN_X) / (WORLD_MAX_X - WORLD_MIN_X)) * RADAR_SIZE;

  const screenY =
    ((y - WORLD_MIN_Y) / (WORLD_MAX_Y - WORLD_MIN_Y)) * RADAR_SIZE;

  return { screenX, screenY };
}

function getAngleFromCenter(x, y) {
  const center = RADAR_SIZE / 2;
  const dx = x - center;
  const dy = y - center;

  let angle = Math.atan2(dy, dx) * (180 / Math.PI);
  return angle < 0 ? angle + 360 : angle;
}

// ===============================
// RANGE RINGS + LINES
// ===============================
function createRings() {
  const ringCount = 7;

  for (let i = 1; i <= ringCount; i++) {
    const ring = document.createElement("div");
    ring.className = "ring";

    const size = (RADAR_SIZE / ringCount) * i;

    ring.style.width = `${size}px`;
    ring.style.height = `${size}px`;
    ring.style.left = `${(RADAR_SIZE - size) / 2}px`;
    ring.style.top = `${(RADAR_SIZE - size) / 2}px`;

    ringsContainer.appendChild(ring);
  }
}
createRings();

function createRadialLines() {
  const center = RADAR_SIZE / 2;
  const radius = RADAR_SIZE / 2 - 30;

  const cardinalMap = { 0: "N", 90: "E", 180: "S", 270: "W" };

  for (let i = 0; i < 12; i++) {
    const angleDeg = i * 30;
    const angleRad = (angleDeg - 90) * (Math.PI / 180);

    const line = document.createElement("div");
    line.className = "radar-line";
    line.style.transform = `rotate(${angleDeg}deg)`;
    radar.appendChild(line);

    const label = document.createElement("div");
    label.className = "radar-angle-label";

    if (cardinalMap[angleDeg] !== undefined) {
      label.innerHTML = `
        <span class="radar-cardinal-letter">${cardinalMap[angleDeg]}</span>
        ${angleDeg}°
      `;
    } else {
      label.textContent = `${angleDeg}°`;
    }

    const x = center + radius * Math.cos(angleRad);
    const y = center + radius * Math.sin(angleRad);

    label.style.left = `${x}px`;
    label.style.top = `${y}px`;

    radar.appendChild(label);
  }
}
createRadialLines();

// ===============================
// CLEANUP
// ===============================
function cleanupDeadPlanes() {
  Object.keys(planeElements).forEach((flightName) => {
    if (!liveData[flightName]) {
      planeElements[flightName].remove();
      delete planeElements[flightName];
    }
  });
}

// ===============================
// DETECTION
// ===============================
function detectHits() {
  Object.entries(planeAngles).forEach(([flightName, obj]) => {
    const { screenX, screenY, angle, data } = obj;

    let diff = Math.abs(angle - sweepAngle);
    if (diff > 180) diff = 360 - diff;

    if (diff >= BEAM_WIDTH) return;

    let plane = planeElements[flightName];

    if (!plane) {
      plane = document.createElement("div");
      plane.className = "plane";
      radar.appendChild(plane);
      planeElements[flightName] = plane;
    }

    plane.style.left = `${screenX}px`;
    plane.style.top = `${screenY}px`;
    plane.style.opacity = 0.75;

    if (data?.isEmergencyOccuring) {
      plane.style.background = "red";
      plane.style.boxShadow = "0 0 10px red";
    } else if (data?.isOnGround) {
      plane.style.background = "#00aaff";
      plane.style.boxShadow = "0 0 10px #00aaff";
    } else {
      plane.style.background = "#ffffff";
      plane.style.boxShadow = "0 0 10px #00ff00";
    }
  });
}

// ===============================
// HIGHLIGHT
// ===============================
let selectedOutline = null;

function updateSelectedOutline(flightName) {
  const angleData = planeAngles[flightName];
  if (!angleData) return;

  const { screenX, screenY } = angleData;

  selectedOutline = document.createElement("div");
  selectedOutline.className = "selected-outline";

  selectedOutline.style.left = `${screenX - 4}px`;
  selectedOutline.style.top  = `${screenY - 4}px`;

  radar.appendChild(selectedOutline);
}

function highlightSelectedPlane() {
  if (!planeList.length) return;

  const selectedFlight = planeList[selectedPlaneIndex];

  if (selectedOutline) {
    selectedOutline.remove();
    selectedOutline = null;
  }

  if (!planeAngles[selectedFlight]) return;

  updateSelectedOutline(selectedFlight);
}


// ===============================
// RADAR ENGINE
// ===============================
function radarEngine(now) {
  const delta = now - lastTime;
  lastTime = now;

  const degreesPerMs = 360 / SWEEP_DURATION;
  sweepAngle += delta * degreesPerMs;
  if (sweepAngle >= 360) sweepAngle -= 360;

  sweep.style.transform = `rotate(${sweepAngle + SWEEP_OFFSET}deg)`;

  Object.values(planeElements).forEach((plane) => {
    let currentOpacity = parseFloat(plane.style.opacity) || 0;
    plane.style.opacity = Math.max(0, currentOpacity - PING_ALIVE_TIME);
  });

  if (now - lastDetection > 50) {
    lastDetection = now;
    detectHits();
    updateClutter();
  }

  requestAnimationFrame(radarEngine);
}
requestAnimationFrame(radarEngine);



// ===============================
// TRANSFORM HANDLING + PANNING
// ===============================
function updateTransform() {
	radar.style.transform = `scale(${scale}) translate(${translateX}px, ${translateY}px)`;
}




function panCameraToWorld(worldX, worldY) {

	cameraTarget.x = worldX;
	cameraTarget.y = worldY;

	const { screenX, screenY } = worldToScreen(worldX, worldY);

	const radarCenter = RADAR_SIZE / 2;

	// remove multiplication by scale
	translateX = radarCenter - screenX;
	translateY = radarCenter - screenY;

	updateTransform();
}





// ===================
// Clutter(funk)
// =================

const clutter = document.getElementById("clutter");

const CLUTTER_COUNT = 128;
const CLUTTER_BEAM = 6;  // degrees
const CLUTTER_COOLDOWN = 300; // ms between each dot activation

let clutterDots = [];

function initClutter() {
  for (let i = 0; i < CLUTTER_COUNT; i++) {
    const dot = document.createElement("div");
    dot.className = "clutter-dot";

    const x = Math.random() * RADAR_SIZE;
    const y = Math.random() * RADAR_SIZE;

    dot.dataset.x = x;
    dot.dataset.y = y;
    dot.dataset.last = 0; // last time it activated

    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
    dot.style.opacity = 0;

    clutter.appendChild(dot);
    clutterDots.push(dot);
  }
}

initClutter(); // ONLY call once


function updateClutter() {
  const now = performance.now();

  clutterDots.forEach((dot) => {
    const x = parseFloat(dot.dataset.x);
    const y = parseFloat(dot.dataset.y);

    const angle = getAngleFromCenter(x, y);

    let diff = Math.abs(angle - sweepAngle);
    if (diff > 180) diff = 360 - diff;

    // only activate when sweep is close
    if (diff < CLUTTER_BEAM) {
      // prevent it from flashing constantly
      if (now - dot.dataset.last > CLUTTER_COOLDOWN) {
        dot.dataset.last = now;
        dot.style.opacity = 1;

        // fade out fast
        setTimeout(() => {
          dot.style.opacity = 0;
        }, 70);
      }
    }
  });
}




// ===============================
// KNOB CONTROL SYSTEM
// ===============================

const sweepPresets = [5000, 10000, 15000, 20000, 25000];
const pingPresets = [0.005, 0.004, 0.003, 0.002, 0.001];
const zoomPresets = [1, 1.5, 2, 2.5, 3, 5];

let sweepIndex = 2;
let pingIndex = 1;
let zoomIndex = 0;

const sweepKnob = document.getElementById("sweepKnob");
const pingKnob = document.getElementById("pingKnob");
const zoomKnob = document.getElementById("zoomKnob");

function updateKnobVisual(knob, index, max) {
  const rotation = (index / (max - 1)) * 270 - 135;
  knob.style.transform = `rotate(${rotation}deg)`;
}

function setupKnob(knobEl, presets, indexVar, applyFn) {
  let index = indexVar;

  function update() {
    applyFn(presets[index]);
    updateKnobVisual(knobEl, index, presets.length);
  }

  // left click → forward
  knobEl.addEventListener("click", (e) => {
    e.preventDefault();
    index = (index + 1) % presets.length;
    update();
  });

  // right click → backward
  knobEl.addEventListener("contextmenu", (e) => {
    e.preventDefault(); // prevent browser menu
    index = (index - 1 + presets.length) % presets.length;
    update();
  });

  // initialize visual
  update();

  // return updated index for reference
  return () => index;
}

// SWEEP knob
let getSweepIndex = setupKnob(
  document.getElementById("sweepKnob"),
  sweepPresets,
  sweepIndex,
  (val) => {
  SWEEP_DURATION = val;
  updateRadarStats();
  }
);

// PING knob
let getPingIndex = setupKnob(
  document.getElementById("pingKnob"),
  pingPresets,
  pingIndex,
  (val) => {
  PING_ALIVE_TIME = val;
  updateRadarStats();
  }
);

// ZOOM knob
let getZoomIndex = setupKnob(
  document.getElementById("zoomKnob"),
  zoomPresets,
  zoomIndex,
  (val) => {
	scale = val;
	panCameraToWorld(cameraTarget.x, cameraTarget.y);
	updateRadarStats();
  }
);


// Initialize knob visuals
updateKnobVisual(sweepKnob, sweepIndex, sweepPresets.length);
updateKnobVisual(pingKnob, pingIndex, pingPresets.length);
updateKnobVisual(zoomKnob, zoomIndex, zoomPresets.length);

const btnCENTER = document.getElementById("btnCENTER");
const btnIRFD = document.getElementById("btnIRFD");
const btnITKO = document.getElementById("btnITKO");
const btnIZOL = document.getElementById("btnIZOL");
const btnILAR = document.getElementById("btnILAR");
const btnIPPH = document.getElementById("btnIPPH");
const btnIBTH = document.getElementById("btnIBTH");
const btnIGRV = document.getElementById("btnIGRV");
const btnISAU = document.getElementById("btnISAU");


// Buttons


const prevBtn = document.getElementById("prevPlane");
const nextBtn = document.getElementById("nextPlane");
const printBtn = document.getElementById("printPlaneInfo");

prevBtn.addEventListener("click", () => {
  selectedPlaneIndex =
    (selectedPlaneIndex - 1 + planeList.length) % planeList.length;
  highlightSelectedPlane();
  displaySelectedPlaneInfo();
});

nextBtn.addEventListener("click", () => {
  selectedPlaneIndex = (selectedPlaneIndex + 1) % planeList.length;
  highlightSelectedPlane();
  displaySelectedPlaneInfo();
});

printBtn.addEventListener("click", () => {
  // Print the currently selected plane info
  displaySelectedPlaneInfo();
});





btnCENTER.addEventListener("click", () => {
  panCameraToWorld(0, 0);
});

btnIRFD.addEventListener("click", () => {
  panCameraToWorld(-2977, 21047);
});

btnITKO.addEventListener("click", () => {
  panCameraToWorld(-8607, -32277);
});


btnIZOL.addEventListener("click", () => {
  panCameraToWorld(44645, 3861);
});


btnILAR.addEventListener("click", () => {
  panCameraToWorld(21255, 32905);
});


btnIPPH.addEventListener("click", () => {
  panCameraToWorld(17806, -19660);
});


btnIBTH.addEventListener("click", () => {
  panCameraToWorld(5725, -4334);
});


btnIGRV.addEventListener("click", () => {
  panCameraToWorld(-43276, -2408);
});


btnISAU.addEventListener("click", () => {
  panCameraToWorld(-46040, 27767);
});








// ===============================
// TERMINAL
// ===============================
function displaySelectedPlaneInfo() {
  if (!planeList.length) return;
  if (typingTimeout) clearTimeout(typingTimeout);

  const flightName = planeList[selectedPlaneIndex];
  const data = liveData[flightName];
  if (!data) return;

  const fieldsPerLine = 3;
  const allFields = [];

  // Add flight name at the very top
  const lines = [`Flight: ${flightName}`];

  // Add other fields
  for (const key in data) {
    let value = data[key];
    if (typeof value === "object" && value !== null) {
      value = Object.entries(value)
        .map(([k,v]) => `${k}:${v}`)
        .join(", ");
    }
    allFields.push(`${key}:${value}`);
  }

  // group fields per line
  for (let i = 0; i < allFields.length; i += fieldsPerLine) {
    lines.push(allFields.slice(i, i + fieldsPerLine).join(" | "));
  }

  // type it into the terminal
  typeTerminal(lines.join("\n"), 16);
}


function typeTerminal(text, speed = 64) {
  terminalOutput.textContent = "";
  let i = 0;

  function step() {
    if (i < text.length) {
      terminalOutput.textContent += text[i];
      i++;
      typingTimeout = setTimeout(step, speed);
    }
  }
  step();
}

// ===============================
// RADAR STATS
// ===============================
function updateRadarStats() {
  if (!radarStats) return;

  radarStats.innerHTML = `
    SWEEP: ${(SWEEP_DURATION / 1000).toFixed(1)}s<br>
    PING: ${PING_ALIVE_TIME.toFixed(3)}<br>
    ZOOM: ${scale.toFixed(1)}x
  `;
}
